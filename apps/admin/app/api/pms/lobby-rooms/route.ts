import {
  getLobbyRooms,
  LOBBY_DEFAULT_BASE_URL,
  parseLobbyPageMeta,
  parseLobbyRooms,
  type LobbyRoomCategory,
} from "@hifago/domain";
import { createClient } from "@hifago/supabase/server";
import { createServiceRoleClient } from "@hifago/supabase/service";

// Refonte parcours partenaire ↔ LobbyPMS (2026-08-25) — alimente LobbyOptionPicker côté
// product-type-fields.tsx pour un logement (`lobby_category_id`). Jamais de saisie libre côté
// socio (spec 21 refonte, frontière de confiance §C) : ce endpoint ne renvoie qu'une liste propre,
// jamais le token ni le corps brut Lobby. Précédent direct :
// apps/admin/app/api/pms/test-connection/route.ts (même garde admin, étendue ici à "l'operator
// propriétaire de l'établissement" puisque ce endpoint sert aussi le formulaire socio).
//
// Enrichi le 2026-08-26 : la charge utile de GET /rooms était intégralement jetée (seuls {id, name}
// en ressortaient) alors qu'elle porte déjà type/capacity/quantity/descriptions[]/photos[]. Rien
// n'est ajouté côté réseau — c'est la MÊME requête, simplement plus rien n'est jeté. Ce qui permet
// à l'écran de montrer ce qu'il a choisi, et de préremplir la fiche au lieu de la laisser vide.
// Le parsing vit dans packages/domain/src/pms/parseLobbyRooms.ts (défensif : aucun champ supposé
// présent), jamais ici.
export const runtime = "nodejs";

const MAX_PAGES = 20;

// Forme exposée au navigateur. `id`/`name` sont conservés à l'identique — LobbyOptionPicker les
// consomme déjà — le reste est purement additif, donc aucun appelant existant n'est cassé.
export type LobbyRoomOption = {
  id: number;
  name: string;
  kind: LobbyRoomCategory["kind"];
  rawType: string | null;
  capacity: number | null;
  quantity: number | null;
  descriptions: LobbyRoomCategory["descriptions"];
  unsupportedLangs: string[];
  photoUrls: string[];
  roomLabels: string[];
};

function toRoomOption(category: LobbyRoomCategory): LobbyRoomOption {
  return {
    id: category.categoryId,
    name: category.name,
    kind: category.kind,
    rawType: category.rawType,
    capacity: category.capacity,
    quantity: category.quantity,
    descriptions: category.descriptions,
    unsupportedLangs: category.unsupportedLangs,
    // Seules les URLs sont exposées (jamais photo_id, dont l'écran n'a aucun usage).
    photoUrls: category.photos.map((photo) => photo.url),
    roomLabels: category.roomLabels,
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

    const items: LobbyRoomOption[] = [];
    let totalPages: number | null = null;
    for (let page = 1; page <= MAX_PAGES; page++) {
      const response = await getLobbyRooms(baseUrl, apiToken, page, relaySecret);
      if (response.status !== 200) {
        // Diagnostic temporaire (2026-08-25) — jamais logger apiToken/relaySecret, seulement le
        // statut et un extrait du corps de réponse (Lobby/le relais ne renvoient pas de secret
        // dans leurs corps d'erreur, contrairement à l'URL de requête qui, elle, porte api_token).
        console.error(
          `GET /api/pms/lobby-rooms : réponse non-200 (establishment ${establishmentId}, page ${page})`,
          { status: response.status, body: JSON.stringify(response.body).slice(0, 500) },
        );
        return Response.json({ ok: false, reason: "lobby_rejected", status: response.status }, { status: 502 });
      }
      const categories = parseLobbyRooms(response.body);
      if (categories.length === 0) break;
      for (const category of categories) items.push(toRoomOption(category));

      // S'arrêter à la dernière page annoncée par Lobby plutôt que de taper jusqu'au plafond de
      // sécurité : un compte qui tient sur une page ne doit pas coûter 20 requêtes chez eux à
      // chaque ouverture du sélecteur (et MAX_PAGES reste le garde-fou si `meta` est illisible).
      totalPages = parseLobbyPageMeta(response.body).totalPages ?? totalPages;
      if (totalPages !== null && page >= totalPages) break;
    }

    return Response.json({ ok: true, items });
  } catch (error) {
    console.error(`GET /api/pms/lobby-rooms a échoué (establishment ${establishmentId})`, error);
    return Response.json({ ok: false, reason: "lobby_unreachable" }, { status: 502 });
  }
}
