import {
  addLobbyProductService,
  buildEvenRatesPerDay,
  createLobbyBooking,
  isPmsBacked,
  LOBBY_DEFAULT_BASE_URL,
  parseLobbyBookingResponse,
} from "@hifago/domain";
import { createServiceRoleClient } from "@hifago/supabase/service";

// Spec 21 §0/§7 — appelé fire-and-forget par CheckoutForm.tsx juste après un create_order réussi
// (précédent exact : apps/web/app/api/payments/create/route.ts). service_role, relit
// AUTORITATIVEMENT order_lines/products/establishments par orderId (le seul input de confiance,
// jamais un champ envoyé par le client) — aucune vérification auth.getUser() ici, create_order a
// déjà entièrement statué sur l'autorisation de la réservation elle-même, même discipline que
// /api/payments/create pour create_payment_intent.
//
// Invariant central : un échec PMS à n'importe quelle étape ne défait JAMAIS une réservation déjà
// confirmée (client cahier des charges §5 — statut d'intégration séparé du statut métier, jamais
// un blocage de la réservation). Toujours 200 { ok: true } côté HTTP — l'échec vit uniquement dans
// pms_reconciliation_entries, jamais renvoyé comme une erreur au front.
//
// Chaque établissement PMS-backed de la commande est traité INDÉPENDAMMENT (une commande peut
// contenir des nuits dans plusieurs propriétés, dont certaines PMS-backed et d'autres non, cahier
// des charges client §5 — généralisation explicitement demandée, absente du code v1) : sa propre
// disponibilité (déjà validée par create_order, jamais relue ici), son propre booking, ses propres
// activités rattachées.
export const runtime = "nodejs";

interface OrderLineRow {
  id: string;
  product_id: string;
  date: string;
  end_date: string | null;
  qty: number;
  holder_name: string;
  price_cop: number;
  total_cop: number;
}

interface ProductRow {
  id: string;
  type: string;
  lobby_category_id: number | null;
  lobby_product_id: number | null;
  establishment_id: string;
}

interface EstablishmentRow {
  id: string;
  lobby_connector_active: boolean;
  lobby_api_token: string | null;
}

async function recordFailure(
  service: ReturnType<typeof createServiceRoleClient>,
  orderLineId: string
) {
  await service.from("pms_reconciliation_entries").insert({ order_line_id: orderLineId });
}

export async function POST(request: Request) {
  let body: { orderId?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, reason: "invalid_body" }, { status: 400 });
  }

  const orderId = body.orderId;
  if (typeof orderId !== "string" || orderId.length === 0) {
    return Response.json({ ok: false, reason: "invalid_body" }, { status: 400 });
  }

  const service = createServiceRoleClient();

  const { data: lines } = await service
    .from("order_lines")
    .select("id, product_id, date, end_date, qty, holder_name, price_cop, total_cop")
    .eq("order_id", orderId)
    .eq("status", "reserved")
    .returns<OrderLineRow[]>();

  if (!lines || lines.length === 0) {
    // Rien à faire (commande sans lignes actives, ou déjà toute prestations non-lodging) — pas
    // une erreur, réponse identique au cas nominal.
    return Response.json({ ok: true });
  }

  const productIds = [...new Set(lines.map((line) => line.product_id))];
  const { data: products } = await service
    .from("products")
    .select("id, type, lobby_category_id, lobby_product_id, establishment_id")
    .in("id", productIds)
    .returns<ProductRow[]>();
  const productsById = new Map((products ?? []).map((product) => [product.id, product]));

  const establishmentIds = [...new Set((products ?? []).map((product) => product.establishment_id))];
  const { data: establishments } = await service
    .from("establishments")
    .select("id, lobby_connector_active, lobby_api_token")
    .in("id", establishmentIds)
    .eq("lobby_connector_active", true)
    .not("lobby_api_token", "is", null)
    .returns<EstablishmentRow[]>();
  const establishmentsById = new Map((establishments ?? []).map((establishment) => [establishment.id, establishment]));

  // Regroupe par établissement PMS-backed actif — chaque groupe traité indépendamment.
  const groups = new Map<
    string,
    { apiToken: string; lodgingLines: OrderLineRow[]; activityLines: { line: OrderLineRow; lobbyProductId: number }[] }
  >();

  for (const line of lines) {
    const product = productsById.get(line.product_id);
    if (!product) continue;
    const establishment = establishmentsById.get(product.establishment_id);
    if (!establishment) continue;

    const lodging = isPmsBacked({ type: product.type, lobbyCategoryId: product.lobby_category_id });
    const activityEligible = product.type === "activity" && product.lobby_product_id != null;
    if (!lodging && !activityEligible) continue;

    let group = groups.get(establishment.id);
    if (!group) {
      group = { apiToken: establishment.lobby_api_token as string, lodgingLines: [], activityLines: [] };
      groups.set(establishment.id, group);
    }
    if (lodging) {
      group.lodgingLines.push(line);
    } else if (product.lobby_product_id != null) {
      group.activityLines.push({ line, lobbyProductId: product.lobby_product_id });
    }
  }

  if (groups.size === 0) {
    return Response.json({ ok: true });
  }

  const baseUrl = process.env.LOBBY_API_BASE_URL || LOBBY_DEFAULT_BASE_URL;

  for (const group of groups.values()) {
    let primaryBookingId: number | null = null;

    for (const line of group.lodgingLines) {
      const product = productsById.get(line.product_id)!;
      if (!line.end_date || product.lobby_category_id == null) {
        await recordFailure(service, line.id);
        continue;
      }
      try {
        const response = await createLobbyBooking(baseUrl, group.apiToken, {
          categoryId: product.lobby_category_id,
          startDate: line.date,
          endDate: line.end_date,
          totalAdults: line.qty,
          holderName: line.holder_name,
          ratesPerDay: buildEvenRatesPerDay(line.date, line.end_date, line.total_cop),
          note: `hifago order_line ${line.id}`,
        });
        const parsed = parseLobbyBookingResponse(response.body);
        if (!parsed) {
          await recordFailure(service, line.id);
          continue;
        }
        await service.from("order_lines").update({ pms_booking_id: String(parsed.bookingId) }).eq("id", line.id);
        primaryBookingId ??= parsed.bookingId;
      } catch (error) {
        console.error(`createLobbyBooking a échoué (order_line ${line.id})`, error);
        await recordFailure(service, line.id);
      }
    }

    for (const { line, lobbyProductId } of group.activityLines) {
      if (primaryBookingId === null) {
        // Aucun booking de nuit primaire dans cette commande pour cet établissement — pas de vente
        // d'activité standalone dans Lobby (add-product-service exige un vrai booking, piège
        // empirique confirmé v1). Jamais de coquille inventée.
        await recordFailure(service, line.id);
        continue;
      }
      try {
        const response = await addLobbyProductService(baseUrl, group.apiToken, primaryBookingId, [
          { productId: lobbyProductId, qty: line.qty },
        ]);
        if (response.status !== 200) {
          await recordFailure(service, line.id);
          continue;
        }
        await service.from("order_lines").update({ pms_booking_id: String(primaryBookingId) }).eq("id", line.id);
      } catch (error) {
        console.error(`addLobbyProductService a échoué (order_line ${line.id})`, error);
        await recordFailure(service, line.id);
      }
    }
  }

  return Response.json({ ok: true });
}
