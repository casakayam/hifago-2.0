import {
  addLobbyProductService,
  buildEvenRatesPerDay,
  buildLobbyBookingNote,
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
// ⚠️ INVARIANT RETOURNÉ LE 2026-08-29, ET C'EST TOUT L'OBJET DE CE LOT. Cette route était
// fire-and-forget APRÈS confirmation, et répondait donc toujours `200 {ok:true}` : « un échec PMS
// ne défait jamais une réservation déjà confirmée ». Cette phrase reste vraie — mais elle ne
// s'applique plus, parce qu'il n'y a plus de réservation confirmée à ce moment-là. Elle est
// désormais ATTENDUE, avant confirmation visible et avant tout encaissement (spec 21 §8 : « échec
// fermé uniquement AVANT confirmation »), et elle rend un VERDICT.
//
// LE FAIT QUI A DÉCIDÉ (spec 24 §11.2) : deux catégories du compte réel (49823, 18013) refusent
// `POST /bookings` en 422 tout en affichant une disponibilité NON NULLE, et C1 est RÉFUTÉ —
// `available-rooms` les cote comme les autres. Aucune lecture ne peut prédire le refus : seul
// l'appel d'écriture le révèle. Le client payait donc ses 17 %, hifago confirmait, et le partenaire
// ne recevait rien — sans même une annulation à compenser, puisque rien n'avait été créé.
//
// CE QUI DÉCLENCHE UN RELÂCHEMENT, et ce qui n'en déclenche pas :
//   - une NUIT qui n'obtient pas son booking → la commande entière est défaite
//     (release_order_after_pms_refusal), rien n'est encaissé, les places non-PMS sont rendues ;
//   - une ACTIVITÉ refusée alors que sa nuit est bien réservée → surtout PAS de relâchement : la
//     nuit existe chez le partenaire, l'annuler pour un extra serait pire que le défaut. On garde
//     l'ancien chemin (pms_reconciliation_entries), qui est exactement fait pour ça.
//   - une activité SANS aucune nuit dans cette commande pour cet établissement → ni l'un ni
//     l'autre : Lobby n'accepte pas de vente de service isolée, c'est une limite connue, pas un
//     incident (cf. plus bas).
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
  holder_email: string | null;
  holder_phone: string | null;
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

// `detail` répond à « pourquoi », que cette entrée ne disait pas jusqu'au 2026-08-27 : elle ne
// portait que l'order_line, donc l'e-mail envoyé à chaque admin (notify_all_admins) et l'écran de
// réconciliation disaient « quelque chose a échoué » sans plus. Une création de booking a échoué en
// préprod ce jour-là et il a fallu changer une variable à l'aveugle pour comprendre — la réponse de
// Lobby n'était nulle part.
//
// ⚠️ SEULEMENT des corps de réponse, jamais l'URL de la requête : elle porte `api_token` en query
// string (hifago/CLAUDE.md §8). Tronqué à 300 caractères — un motif utile tient en deux lignes, et
// une page d'erreur HTML d'un proxy amont n'a pas à remplir la colonne.
async function recordFailure(
  service: ReturnType<typeof createServiceRoleClient>,
  orderLineId: string,
  detail: string
) {
  console.error(`reserve-nights : échec PMS (order_line ${orderLineId}) — ${detail}`);
  await service.from("pms_reconciliation_entries").insert({
    order_line_id: orderLineId,
    detail: detail.length > 300 ? `${detail.slice(0, 300)}…` : detail,
  });
}

function describeLobbyResponse(status: number, body: unknown): string {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return `HTTP ${status} — ${text || "corps vide"}`;
}

interface LodgingFailure {
  lineId: string;
  detail: string;
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

  // `pms_booking_id is null` : la route est NON authentifiée, et son unicité d'appel ne tenait
  // qu'au `void fetch(...)` unique de CheckoutForm. Un second POST recréait un booking chez Lobby.
  // C'était bénin ; ça ne l'est plus depuis la file d'annulation (spec 25) : elle remonte les
  // bookings à annuler DEPUIS `order_lines`, donc un booking doublon qu'aucune ligne ne référence
  // ne serait jamais annulé et resterait bloqué chez le partenaire. L'idempotence appartient à
  // l'appelé, pas à la discipline de l'appelant.
  const { data: lines } = await service
    .from("order_lines")
    .select("id, product_id, date, end_date, qty, holder_name, holder_email, holder_phone, price_cop, total_cop")
    .eq("order_id", orderId)
    .eq("status", "reserved")
    .is("pms_booking_id", null)
    .returns<OrderLineRow[]>();

  if (!lines || lines.length === 0) {
    // Rien à faire (commande sans lignes actives, ou déjà toute prestations non-lodging) — pas
    // une erreur, réponse identique au cas nominal.
    return Response.json({ ok: true });
  }

  // Attribution de la commande — le code promo et la source ne vivent que sur `orders`. Lus ici
  // pour la note du booking (cf. buildLobbyBookingNote) : Lobby n'ayant aucun champ dédié, la note
  // est le seul endroit où l'hôte peut voir d'où vient la réservation et qui contacter.
  const { data: order } = await service
    .from("orders")
    .select("attribution_code, attribution_source")
    .eq("id", orderId)
    .maybeSingle();

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
    // Élargi le 2026-08-26 de "activity" seul à ("activity", "transport") — cf. commentaire de tête
    // de product-type-fields.tsx pour le raisonnement complet (evento/camp restent exclus,
    // incompatibilité structurelle avec ce mécanisme, pas un simple oubli).
    const activityEligible =
      (product.type === "activity" || product.type === "transport") && product.lobby_product_id != null;
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
  const relaySecret = process.env.LOBBY_RELAY_SECRET;

  // Les échecs de NUIT sont collectés, pas enregistrés au fil de l'eau : si la commande est
  // relâchée juste après, insérer dans pms_reconciliation_entries déclencherait notify_all_admins
  // (sans dédup) pour un incident déjà défait — un e-mail « à traiter » sur quelque chose que
  // personne ne peut ni ne doit traiter. Le même piège avait déjà produit une salve d'e-mails le
  // 2026-08-26 (activité sans nuit), et c'est la raison d'être du garde juste en dessous.
  const lodgingFailures: LodgingFailure[] = [];

  for (const group of groups.values()) {
    let primaryBookingId: number | null = null;

    for (const line of group.lodgingLines) {
      const product = productsById.get(line.product_id)!;
      if (!line.end_date || product.lobby_category_id == null) {
        lodgingFailures.push({
          lineId: line.id,
          detail: `ligne inexploitable : end_date=${line.end_date ?? "null"}, lobby_category_id=${product.lobby_category_id ?? "null"}`,
        });
        continue;
      }
      try {
        const response = await createLobbyBooking(
          baseUrl,
          group.apiToken,
          {
            categoryId: product.lobby_category_id,
            startDate: line.date,
            endDate: line.end_date,
            totalAdults: line.qty,
            holderName: line.holder_name,
            ratesPerDay: buildEvenRatesPerDay(line.date, line.end_date, line.total_cop),
            note: buildLobbyBookingNote({
              orderLineId: line.id,
              promoCode: order?.attribution_code ?? null,
              phone: line.holder_phone,
              email: line.holder_email,
              source: order?.attribution_source ?? null,
            }),
          },
          relaySecret
        );
        const parsed = parseLobbyBookingResponse(response.body);
        if (!parsed) {
          // LE cas qui a coûté une heure de diagnostic le 2026-08-27 : la réponse n'est pas
          // exploitable et rien ne disait laquelle. C'est ici que le motif de refus de Lobby
          // (catégorie non réservable par API, paramètre invalide…) devient visible.
          // LE cas du 422 : Lobby cote la catégorie comme disponible et refuse de la réserver.
          lodgingFailures.push({
            lineId: line.id,
            detail: `POST /bookings sans booking_id exploitable — ${describeLobbyResponse(response.status, response.body)}`,
          });
          continue;
        }
        await service.from("order_lines").update({ pms_booking_id: String(parsed.bookingId) }).eq("id", line.id);
        primaryBookingId ??= parsed.bookingId;
      } catch (error) {
        lodgingFailures.push({ lineId: line.id, detail: `createLobbyBooking a levé — ${String(error)}` });
      }
    }

    for (const { line, lobbyProductId } of group.activityLines) {
      if (primaryBookingId === null) {
        // Deux situations très différentes se cachaient derrière ce seul test, et elles étaient
        // traitées pareil (corrigé le 2026-08-26) :
        //
        // (a) la commande ne contient AUCUNE nuit pour cet établissement — vendre un service Lobby
        //     seul est structurellement impossible (add-product-service exige un vrai booking :
        //     422 "The booking doesnt exits", piège empirique confirmé v1), et il a été décidé de
        //     ne jamais inventer de booking coquille. Ce n'est donc pas un incident, c'est une
        //     limite connue de Lobby. Or `recordFailure` insère dans pms_reconciliation_entries,
        //     dont le trigger notify_all_admins (20260824060000) envoie un e-mail À CHAQUE ADMIN,
        //     sans dédup : une activité liée à Lobby vendue sans nuit produisait donc une salve
        //     d'e-mails à chaque vente, pour une situation que personne ne peut « résoudre ».
        //
        // (b) il Y AVAIT des nuits, mais toutes leurs créations de booking ont échoué — là c'est
        //     une vraie panne, et l'entrée de réconciliation est exactement ce qu'il faut.
        if (group.lodgingLines.length === 0) {
          console.warn(
            `reserve-nights : service Lobby non reflété (order_line ${line.id}) — aucune nuit dans la commande pour cet établissement, Lobby n'accepte pas de vente de service isolée`
          );
          continue;
        }
        // Les nuits de cet établissement ont toutes échoué : la commande va être relâchée, et
        // c'est l'échec des NUITS qui le décide. Rien à enregistrer ici — ce serait un second
        // e-mail pour la même cause.
        continue;
      }
      try {
        const response = await addLobbyProductService(
          baseUrl,
          group.apiToken,
          primaryBookingId,
          [{ productId: lobbyProductId, qty: line.qty }],
          relaySecret
        );
        if (response.status !== 200) {
          await recordFailure(
            service, line.id,
            `add-product-service refusé — ${describeLobbyResponse(response.status, response.body)}`
          );
          continue;
        }
        await service.from("order_lines").update({ pms_booking_id: String(primaryBookingId) }).eq("id", line.id);
      } catch (error) {
        await recordFailure(service, line.id, `addLobbyProductService a levé — ${String(error)}`);
      }
    }
  }

  if (lodgingFailures.length === 0) {
    return Response.json({ ok: true });
  }

  // ── REFUS : on défait, on n'encaisse pas ────────────────────────────────────────────────────
  console.error(
    `reserve-nights : ${lodgingFailures.length} nuit(s) refusée(s) par LobbyPMS (order ${orderId}) — relâchement`,
    lodgingFailures.map((failure) => failure.detail)
  );

  const { data: released, error: releaseError } = await service.rpc("release_order_after_pms_refusal", {
    p_order_id: orderId,
    p_reason: lodgingFailures[0].detail.slice(0, 300),
  });

  const releaseOk = !releaseError && (released as { ok?: boolean } | null)?.ok === true;
  if (!releaseOk) {
    // ⚠️ LE SEUL CAS QUI LAISSE UNE COMMANDE PENDANTE, et il a besoin d'un humain : Lobby a refusé
    // ET on n'a pas su défaire. C'est exactement ce pour quoi pms_reconciliation_entries existe,
    // donc ici — et seulement ici — on l'alimente. Le filet de sécurité reste
    // expire_stale_payment_orders, qui expirera la commande dans les 30 minutes et déclenchera au
    // passage l'annulation des bookings frères déjà créés.
    console.error(`reserve-nights : relâchement IMPOSSIBLE (order ${orderId})`, releaseError);
    // En parallèle : ces inserts visent des `order_line_id` distincts, aucun n'attend l'autre. On
    // est déjà sur un chemin doublement dégradé (refus PMS PUIS échec du relâchement) — c'est le
    // moment où faire attendre le client N latences réseau au lieu d'une est le plus superflu.
    await Promise.all(
      lodgingFailures.map((failure) =>
        recordFailure(service, failure.lineId, `${failure.detail} — relâchement impossible`)
      )
    );
  }

  // 409 et non 200 : c'est un refus du prestataire, pas une panne de hifago, et il doit se voir
  // dans la supervision comme dans le front. `released` dit au front que rien ne subsiste.
  return Response.json(
    { ok: false, reason: "pms_refused", released: releaseOk, failedLines: lodgingFailures.length },
    { status: 409 }
  );
}
