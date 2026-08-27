import { getLobbyProducts, parseLobbyServices, type LobbyService } from "@hifago/domain";
import { collectLobbyPages, resolveLobbyEstablishment } from "@/lib/pms/lobbyEstablishment";
import { toServiceOption } from "@/lib/pms/lobbyOptions";

// Jumeau de lobby-rooms pour une activité ou un transport (`lobby_product_id`). Seule différence :
// l'endpoint Lobby (GET /api/v1/products) et le champ identifiant (service_id côté Lobby, mappé
// vers lobby_product_id côté hifago — cf. commentaire de lobbyClient.ts).
//
// `value` est le prix configuré CHEZ LOBBY, exposé à titre INDICATIF seulement : hifago reste la
// source du prix de vente (règle actée), c'est pourquoi l'écran n'offre aucun bouton pour le
// recopier. Rappel utile pour la suite : un service Lobby ne porte NI photo, NI description, NI
// capacité — ces champs n'existent pas sur cette ressource (observé le 2026-08-26, spec 24 §11.3).
export const runtime = "nodejs";

export async function GET(request: Request) {
  const access = await resolveLobbyEstablishment(
    new URL(request.url).searchParams.get("establishmentId"),
  );
  if (!access.ok) return access.response;

  try {
    const collected = await collectLobbyPages<LobbyService>(
      (page) => getLobbyProducts(access.baseUrl, access.apiToken, page, access.relaySecret),
      parseLobbyServices,
      (service) => service.serviceId,
    );
    if (!collected.ok) {
      console.error(
        `GET /api/pms/lobby-services : réponse non-200 (establishment ${access.establishmentId})`,
        { status: collected.status },
      );
      return Response.json(
        { ok: false, reason: collected.reason, status: collected.status },
        { status: 502 },
      );
    }

    return Response.json({ ok: true, items: collected.items.map(toServiceOption) });
  } catch (error) {
    console.error(
      `GET /api/pms/lobby-services a échoué (establishment ${access.establishmentId})`,
      error,
    );
    return Response.json({ ok: false, reason: "lobby_unreachable" }, { status: 502 });
  }
}
