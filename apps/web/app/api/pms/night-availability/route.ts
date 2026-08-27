import {
  createTtlCache,
  getNightAvailabilityWindow,
  isPmsBacked,
  LOBBY_DEFAULT_BASE_URL,
  nightsOfMonth,
  type NightAvailabilityRow,
} from "@hifago/domain";
import { createServiceRoleClient } from "@hifago/supabase/service";

// Spec 21 §13 (gap comblé) — alimente le calendrier de sélection de dates de LodgingReservationForm.tsx
// pour un logement PMS-backed (Casa Kayam). Précédent direct : apps/web/app/api/pms/reserve-nights/
// route.ts (service_role, relit AUTORITATIVEMENT product/establishment par id, jamais un champ
// métier envoyé par le client). Différences volontaires par rapport à ce précédent : cette route est
// un GET public (fiche produit visible par un visiteur anonyme, même niveau d'exposition que
// product_availability déjà public pour un produit non-PMS — aucune auth.getUser() nécessaire), et
// remonte un vrai code d'erreur HTTP (jamais "toujours 200" comme reserve-nights, dont l'invariant
// "un échec PMS ne défait jamais la commande" ne s'applique pas ici : rien n'est encore réservé, la
// page doit pouvoir dégrader son affichage proprement en cas d'échec Lobby).
//
// Ne lit QUE la disponibilité (available_rooms), jamais un prix : Lobby n'est jamais la source du
// prix côté hifago (cf. packages/domain/src/pms/buildEvenRatesPerDay.ts) — product_date_rates/
// price_tiers restent la seule source de prix, y compris pour un produit PMS-backed.
export const runtime = "nodejs";

interface ProductRow {
  id: string;
  type: string;
  lobby_category_id: number | null;
  establishment_id: string;
}

interface EstablishmentRow {
  id: string;
  lobby_connector_active: boolean;
  lobby_api_token: string | null;
}

const MONTH_PATTERN = /^\d{4}-\d{2}$/;

// Cache 60s en mémoire, une seule instance par process serverless (spec 21 §0 : "cache 60s autorisé
// uniquement pour l'affichage" — jamais au moment de réserver, reserve-nights relit toujours à
// chaud). Best-effort, non partagé entre instances Vercel concurrentes — acceptable, ce cache n'a
// qu'une valeur de réduction de charge sur Lobby, jamais de correction.
const cache = createTtlCache<NightAvailabilityRow[]>(60_000);

export async function GET(request: Request) {
  const url = new URL(request.url);
  const productId = url.searchParams.get("productId");
  const month = url.searchParams.get("month");

  if (!productId || !month || !MONTH_PATTERN.test(month)) {
    return Response.json({ ok: false, reason: "invalid_params" }, { status: 400 });
  }

  const service = createServiceRoleClient();

  const { data: product } = await service
    .from("products")
    .select("id, type, lobby_category_id, establishment_id")
    .eq("id", productId)
    .maybeSingle<ProductRow>();

  if (!product) {
    return Response.json({ ok: false, reason: "product_not_found" }, { status: 404 });
  }
  if (!isPmsBacked({ type: product.type, lobbyCategoryId: product.lobby_category_id })) {
    return Response.json({ ok: false, reason: "not_pms_backed" }, { status: 404 });
  }

  const { data: establishment } = await service
    .from("establishments")
    .select("id, lobby_connector_active, lobby_api_token")
    .eq("id", product.establishment_id)
    .maybeSingle<EstablishmentRow>();

  if (!establishment?.lobby_connector_active || !establishment.lobby_api_token) {
    // État anticipé (connecteur désactivé/pas encore configuré), pas une panne — 200, pas 4xx/5xx.
    return Response.json({ ok: false, reason: "connector_inactive" });
  }

  try {
    const today = new Date().toISOString().slice(0, 10);
    const nights = nightsOfMonth(month, today);
    const baseUrl = process.env.LOBBY_API_BASE_URL || LOBBY_DEFAULT_BASE_URL;
    const relaySecret = process.env.LOBBY_RELAY_SECRET;
    const categoryId = product.lobby_category_id as number;
    const apiToken = establishment.lobby_api_token;

    const rows = await cache.getOrFetch(`${categoryId}:${month}`, () =>
      getNightAvailabilityWindow(baseUrl, apiToken, categoryId, nights, relaySecret)
    );

    return Response.json({ ok: true, nights: rows });
  } catch (error) {
    console.error(`GET /api/pms/night-availability a échoué (product ${productId}, month ${month})`, error);
    return Response.json({ ok: false, reason: "lobby_unreachable" }, { status: 502 });
  }
}
