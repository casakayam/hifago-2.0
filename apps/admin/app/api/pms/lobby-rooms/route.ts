import {
  fetchLobbyRoomsCached,
  LobbyRejectedError,
  resolveLobbyEstablishment,
} from "@/lib/pms/lobbyEstablishment";
import { toRoomOption } from "@/lib/pms/lobbyOptions";

// Alimente LobbyOptionPicker pour un logement (`lobby_category_id`). Jamais de saisie libre côté
// socio (spec 21 refonte, frontière de confiance §C) : ce endpoint ne renvoie qu'une liste propre,
// jamais le token ni le corps brut Lobby.
//
// Renvoie toute la charge utile de GET /rooms (type/capacity/quantity/descriptions[]/photos[]) —
// c'est la MÊME requête qu'avant, simplement plus rien n'est jeté. Ce qui permet à l'écran de
// montrer ce qu'il a choisi, et de préremplir la fiche au lieu de la laisser vide.
//
// Garde d'accès, pagination et cache 60 s vivent dans @/lib/pms/lobbyEstablishment, partagés avec
// les deux autres routes `api/pms` — le cache est le MÊME que celui d'import-room-photos, si bien
// que « ouvrir le sélecteur puis cliquer Usar estos datos » ne coûte qu'un seul balayage chez Lobby.
export const runtime = "nodejs";

export async function GET(request: Request) {
  const access = await resolveLobbyEstablishment(
    new URL(request.url).searchParams.get("establishmentId"),
  );
  if (!access.ok) return access.response;

  try {
    const categories = await fetchLobbyRoomsCached(access.establishmentId, access);
    return Response.json({ ok: true, items: categories.map(toRoomOption) });
  } catch (error) {
    if (error instanceof LobbyRejectedError) {
      // Jamais logger l'URL de requête (elle porte api_token en query) — seulement le statut.
      console.error(
        `GET /api/pms/lobby-rooms : réponse non-200 (establishment ${access.establishmentId})`,
        { status: error.status },
      );
      return Response.json(
        { ok: false, reason: "lobby_rejected", status: error.status },
        { status: 502 },
      );
    }
    console.error(
      `GET /api/pms/lobby-rooms a échoué (establishment ${access.establishmentId})`,
      error,
    );
    return Response.json({ ok: false, reason: "lobby_unreachable" }, { status: 502 });
  }
}
