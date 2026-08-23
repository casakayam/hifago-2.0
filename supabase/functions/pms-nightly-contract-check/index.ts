// Spec 21 — Connecteur LobbyPMS, Phase 6. Job nocturne SÉPARÉ, non bloquant, LECTURE SEULE
// uniquement (jamais un POST/PUT/DELETE) — détecte une dérive de la forme des réponses LobbyPMS
// par rapport à ce que le connecteur suppose (docs/3-integrations/lobby_pms_api.md, racine du
// dépôt), avant que ça ne casse silencieusement une vraie réservation.
//
// Correction factuelle par rapport à l'architecture cible initiale (hifago/docs/04-architecture-
// cible.md § Tests et CI/CD, qui évoquait « le vrai sandbox LobbyPMS ») : AUCUN sandbox LobbyPMS
// n'existe (confirmé, spec 21 §10 point 1) — ce job frappe donc le(s) compte(s) réel(s) des
// établissements dont le connecteur est actif (Casa Kayam aujourd'hui, seul cas réel), jamais un
// environnement de test dédié. Décision explicite de Jérôme (spec 21) : lecture seule stricte,
// jamais en CI/en test (aucun test automatisé de ce fichier ne doit jamais l'invoquer contre le
// vrai baseUrl — seulement contre un serveur de fixtures via LOBBY_API_BASE_URL).
import { createClient } from "npm:@supabase/supabase-js@2";
import { getLobbyRooms, LOBBY_DEFAULT_BASE_URL } from "../../../packages/domain/src/pms/lobbyClient.ts";

interface EstablishmentRow {
  id: string;
  lobby_api_token: string | null;
}

function hasExpectedRoomsShape(body: unknown): boolean {
  if (typeof body !== "object" || body === null) return false;
  const data = (body as { data?: unknown }).data;
  return Array.isArray(data);
}

Deno.serve(async () => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );
  const baseUrl = Deno.env.get("LOBBY_API_BASE_URL") || LOBBY_DEFAULT_BASE_URL;
  const relaySecret = Deno.env.get("LOBBY_RELAY_SECRET");

  const { data: establishments, error } = await supabase
    .from("establishments")
    .select("id, lobby_api_token")
    .eq("lobby_connector_active", true)
    .returns<EstablishmentRow[]>();

  if (error) {
    console.error("pms-nightly-contract-check : lecture establishments a échoué", error);
    return new Response(JSON.stringify({ ok: false, reason: "read_failed" }), { status: 500 });
  }

  const drifts: string[] = [];
  for (const establishment of establishments ?? []) {
    if (!establishment.lobby_api_token) continue;
    try {
      const rooms = await getLobbyRooms(baseUrl, establishment.lobby_api_token, undefined, relaySecret);
      if (rooms.status !== 200 || !hasExpectedRoomsShape(rooms.body)) {
        drifts.push(`établissement ${establishment.id} : GET /rooms forme inattendue (status ${rooms.status})`);
      }
    } catch (err) {
      drifts.push(`établissement ${establishment.id} : GET /rooms injoignable (${err})`);
    }
  }

  // Jamais bloquant (non-CI, non-test) — une alerte console est le seul effet de bord voulu ici,
  // à brancher sur une vraie supervision (ex. log drain → alerte) hors périmètre code de cette spec.
  if (drifts.length > 0) {
    console.warn("pms-nightly-contract-check : dérive de contrat détectée", drifts);
  }

  return new Response(
    JSON.stringify({ ok: true, checked: (establishments ?? []).length, drifts }),
    { headers: { "Content-Type": "application/json" } }
  );
});
