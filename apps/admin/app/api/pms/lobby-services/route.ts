import {
  getLobbyProducts,
  LOBBY_DEFAULT_BASE_URL,
  parseLobbyPageMeta,
  parseLobbyServices,
  type LobbyService,
} from "@hifago/domain";
import { createClient } from "@hifago/supabase/server";
import { createServiceRoleClient } from "@hifago/supabase/service";

// Refonte parcours partenaire ↔ LobbyPMS (2026-08-25) — alimente LobbyOptionPicker côté
// product-type-fields.tsx pour une activité ou un transport (`lobby_product_id`). Miroir exact de
// lobby-rooms/route.ts, seule différence : endpoint Lobby (getLobbyProducts, GET /api/v1/products)
// et champ id source (service_id côté Lobby, mappé vers lobby_product_id côté hifago — cf.
// commentaire de lobbyClient.ts).
//
// Enrichi le 2026-08-26, comme son jumeau : `value`, `infinite_inventory` et `stock` étaient jetés.
// `value` est le prix configuré CHEZ LOBBY — exposé à titre INDICATIF seulement, pour que l'écran
// puisse le montrer au moment de lier. hifago reste la source du prix de vente (règle actée).
export const runtime = "nodejs";

const MAX_PAGES = 20;

// Forme exposée au navigateur — `id`/`name` inchangés (LobbyOptionPicker les consomme déjà), le
// reste est additif.
export type LobbyServiceOption = {
  id: number;
  name: string;
  /** Prix Lobby, indicatif : jamais le prix de vente hifago. */
  valueCop: number | null;
  infiniteInventory: boolean | null;
  stock: number | null;
};

function toServiceOption(service: LobbyService): LobbyServiceOption {
  return {
    id: service.serviceId,
    name: service.name,
    valueCop: service.valueCop,
    infiniteInventory: service.infiniteInventory,
    stock: service.stock,
  };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const establishmentId = url.searchParams.get("establishmentId");
  if (!establishmentId) {
    return Response.json({ ok: false, reason: "invalid_params" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ ok: false, reason: "not_authenticated" }, { status: 401 });
  }

  const [{ data: isAdmin }, { data: partnerId }] = await Promise.all([
    supabase.rpc("is_admin", { uid: user.id }),
    supabase.rpc("partner_id_for_account", { uid: user.id }),
  ]);

  const service = createServiceRoleClient();
  const { data: establishment } = await service
    .from("establishments")
    .select("id, partner_id, lobby_api_token, lobby_connector_active, lobby_has_token")
    .eq("id", establishmentId)
    .maybeSingle();

  if (!establishment) {
    return Response.json({ ok: false, reason: "establishment_not_found" }, { status: 404 });
  }
  if (!isAdmin && establishment.partner_id !== partnerId) {
    return Response.json({ ok: false, reason: "not_authorized" }, { status: 403 });
  }
  if (!establishment.lobby_connector_active || !establishment.lobby_has_token) {
    return Response.json({ ok: false, reason: "pms_not_connected" }, { status: 409 });
  }

  try {
    const baseUrl = process.env.LOBBY_API_BASE_URL || LOBBY_DEFAULT_BASE_URL;
    const relaySecret = process.env.LOBBY_RELAY_SECRET;
    const apiToken = establishment.lobby_api_token as string;

    const items: LobbyServiceOption[] = [];
    let totalPages: number | null = null;
    for (let page = 1; page <= MAX_PAGES; page++) {
      const response = await getLobbyProducts(baseUrl, apiToken, page, relaySecret);
      if (response.status !== 200) {
        // Diagnostic temporaire (2026-08-25) — cf. commentaire jumeau dans lobby-rooms/route.ts.
        console.error(
          `GET /api/pms/lobby-services : réponse non-200 (establishment ${establishmentId}, page ${page})`,
          { status: response.status, body: JSON.stringify(response.body).slice(0, 500) },
        );
        return Response.json({ ok: false, reason: "lobby_rejected", status: response.status }, { status: 502 });
      }
      const services = parseLobbyServices(response.body);
      if (services.length === 0) break;
      for (const service of services) items.push(toServiceOption(service));

      // Même garde-fou de pagination que lobby-rooms : s'arrêter à la dernière page réelle.
      totalPages = parseLobbyPageMeta(response.body).totalPages ?? totalPages;
      if (totalPages !== null && page >= totalPages) break;
    }

    return Response.json({ ok: true, items });
  } catch (error) {
    console.error(`GET /api/pms/lobby-services a échoué (establishment ${establishmentId})`, error);
    return Response.json({ ok: false, reason: "lobby_unreachable" }, { status: 502 });
  }
}
