import { getLobbyRooms, parseLobbyRooms, type LobbyRoomCategory } from "@hifago/domain";
import { collectLobbyPages, resolveLobbyEstablishment } from "@/lib/pms/lobbyEstablishment";
import { toRoomOption } from "@/lib/pms/lobbyOptions";

// Alimente LobbyOptionPicker pour un logement (`lobby_category_id`). Jamais de saisie libre côté
// socio (spec 21 refonte, frontière de confiance §C) : ce endpoint ne renvoie qu'une liste propre,
// jamais le token ni le corps brut Lobby.
//
// Renvoie toute la charge utile de GET /rooms (type/capacity/quantity/descriptions[]/photos[]) —
// c'est la MÊME requête qu'avant, simplement plus rien n'est jeté. Ce qui permet à l'écran de
// montrer ce qu'il a choisi, et de préremplir la fiche au lieu de la laisser vide.
//
// La garde d'accès et la pagination vivent dans @/lib/pms/lobbyEstablishment, partagées avec les
// deux autres routes `api/pms` (/simplify du 2026-08-26 : elles en portaient chacune une copie, et
// la copie était plus faible que la garde de la base — cf. le commentaire de tête du helper).
export const runtime = "nodejs";

export async function GET(request: Request) {
  const access = await resolveLobbyEstablishment(
    new URL(request.url).searchParams.get("establishmentId"),
  );
  if (!access.ok) return access.response;

  try {
    const collected = await collectLobbyPages<LobbyRoomCategory>(
      (page) => getLobbyRooms(access.baseUrl, access.apiToken, page, access.relaySecret),
      parseLobbyRooms,
      (category) => category.categoryId,
    );
    if (!collected.ok) {
      // Jamais logger l'URL de requête (elle porte api_token en query) — seulement le statut.
      console.error(
        `GET /api/pms/lobby-rooms : réponse non-200 (establishment ${access.establishmentId})`,
        { status: collected.status },
      );
      return Response.json(
        { ok: false, reason: collected.reason, status: collected.status },
        { status: 502 },
      );
    }

    return Response.json({ ok: true, items: collected.items.map(toRoomOption) });
  } catch (error) {
    console.error(
      `GET /api/pms/lobby-rooms a échoué (establishment ${access.establishmentId})`,
      error,
    );
    return Response.json({ ok: false, reason: "lobby_unreachable" }, { status: 502 });
  }
}
