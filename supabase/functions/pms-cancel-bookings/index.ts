// C2 (spec 25) — draine la file `pms_cancellation_queue` et annule chez LobbyPMS les bookings dont
// plus aucune ligne hifago n'est réservée. Jumelle de pms-poll-bookings : même patron de claim en
// lot, même lecture du jeton PAR LA BASE (jamais par une variable d'environnement), même principe
// de non-blocage — une annulation hifago n'attend jamais Lobby pour être effective.
//
// Le sens de circulation est important : hifago fait foi sur l'annulation, Lobby la reçoit. Le sens
// inverse (annulation faite par le partenaire dans son PMS) est observé par pms-poll-bookings et
// n'est PAS traité ici — sa règle métier n'est pas écrite (spec 25 §4).
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  cancelLobbyBooking,
  LOBBY_DEFAULT_BASE_URL,
} from "../../../packages/domain/src/pms/lobbyClient.ts";

interface CancellationRow {
  entry_id: string;
  pms_booking_id: string;
  establishment_id: string;
  lobby_api_token: string;
  hifago_status: string | null;
  // Retourné par claim_pms_cancellation_batch depuis 20260827260000 — déjà incrémenté par le claim.
  attempts: number;
}

// LobbyPMS n'accepte PAS un motif libre : `cancellation_reason` est un CODE pris dans une liste
// fermée (docs/3-integrations/lobby_pms_api.md § Cancel Booking). Envoyer du texte donne
// `422 {"error_code":"INPUT_PARAMETERS","error":"The selected cancellation reason is invalid."}` —
// constaté en conditions réelles le 2026-08-27, contre le compte de Casa Kayam. Le texte humain va
// dans `description`, qui est le champ prévu pour ça.
//
//   NS  no show · RC room change · RE registration errors
//   TTC timely customer cancellation · CC customer without communication · OTH other
function lobbyReasonCode(hifagoStatus: string | null): string {
  switch (hifagoStatus) {
    case "cancelled_by_client":
      return "TTC";
    // Annulation par l'établissement, commande jamais payée, ligne remplacée : aucun code Lobby ne
    // correspond exactement, et en inventer un fausserait leurs statistiques d'annulation. `OTH` est
    // le code prévu pour ça — `description` porte le détail.
    default:
      return "OTH";
  }
}

// LE SUCCÈS SE LIT DANS LE CORPS, PAS DANS LE STATUT. La réponse documentée d'une annulation
// réussie est `{"cancel_booking": <id>}` (docs/3-integrations/lobby_pms_api.md), et LobbyPMS ne la
// renvoie PAS avec un 200 — constaté en conditions réelles le 2026-08-27 : la première version
// testait `status === 200`, a donc classé en échec une annulation qui avait parfaitement réussi, et
// l'aurait retentée trois fois avant d'alerter pour rien.
//
// Même leçon que le 422 juste en dessous, et que le `{"raw":"forbidden"}` du job nocturne le même
// jour : chez LobbyPMS, le statut HTTP n'est jamais le contrat — le corps l'est.
function isCancellationAccepted(body: unknown): boolean {
  if (typeof body !== "object" || body === null) return false;
  return "cancel_booking" in (body as Record<string, unknown>);
}

function lobbyErrorCode(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const code = (body as { error_code?: unknown }).error_code;
  return typeof code === "string" ? code : null;
}

// Les 422 dont hifago ne peut RIEN faire : l'entrée est close, il n'y a pas d'action possible.
// À distinguer absolument d'INPUT_PARAMETERS, qui signale un bug de NOTRE côté (cf. plus bas).
const TERMINAL_LOBBY_ERRORS = new Set([
  "RESTRICTED_RESERVATION",   // le booking porte déjà une charge — spec 21 §0
  "BOOKING_CHECK_IN_COMPLETE", // le client est arrivé, la réservation ne s'annule plus
  "RECORD_NOT_FOUND",          // déjà annulé chez Lobby : objectif atteint
]);

// Au-delà, l'entrée est close en 'failed' plutôt que réessayée indéfiniment. Trois passages du cron
// suffisent à absorber une indisponibilité passagère du relais ou de Lobby ; au-delà c'est une
// panne qui demande un humain, et la retenter en boucle ne fait qu'ajouter du bruit.
const MAX_ATTEMPTS = 3;

// Motif envoyé à Lobby. En espagnol : il s'affiche tel quel dans le logiciel du partenaire, qui
// n'est pas francophone.
const CANCELLATION_DESCRIPTION = "Cancelado desde hifago";

Deno.serve(async () => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );
  const baseUrl = Deno.env.get("LOBBY_API_BASE_URL") || LOBBY_DEFAULT_BASE_URL;
  const relaySecret = Deno.env.get("LOBBY_RELAY_SECRET");

  const { data: batch, error } = await supabase.rpc("claim_pms_cancellation_batch", { p_limit: 20 });
  if (error) {
    console.error("claim_pms_cancellation_batch a échoué", error);
    return new Response(JSON.stringify({ ok: false, reason: "claim_failed" }), { status: 500 });
  }

  const rows = (batch ?? []) as CancellationRow[];
  const summary = { claimed: rows.length, cancelled: 0, already_gone: 0, restricted: 0, retried: 0, failed: 0 };

  for (const row of rows) {
    try {
      const response = await cancelLobbyBooking(
        baseUrl,
        row.lobby_api_token,
        Number(row.pms_booking_id),
        lobbyReasonCode(row.hifago_status),
        CANCELLATION_DESCRIPTION,
        relaySecret
      );

      // Annulé — cas nominal, reconnu au CORPS et non au statut (cf. isCancellationAccepted).
      if (isCancellationAccepted(response.body)) {
        summary.cancelled++;
        await supabase.rpc("resolve_pms_cancellation", {
          p_entry_id: row.entry_id, p_outcome: "done", p_lobby_status_code: response.status,
        });
        continue;
      }

      // 404 — le booking n'existe plus chez Lobby : déjà annulé, par nous lors d'un passage
      // précédent ou par le partenaire dans son logiciel. L'objectif est atteint, donc c'est un
      // SUCCÈS. C'est ce qui rend le job rejouable à volonté (spec 25 §3.5).
      if (response.status === 404) {
        summary.already_gone++;
        await supabase.rpc("resolve_pms_cancellation", {
          p_entry_id: row.entry_id, p_outcome: "done", p_lobby_status_code: 404,
        });
        continue;
      }

      // 422 — et surtout PAS « tout 422 est attendu », ce qui était le défaut de la première
      // version : elle classait en succès un `INPUT_PARAMETERS` qui signalait NOTRE propre bug, et
      // laissait le booking ouvert sans que personne ne le sache. C'est le corps qui tranche, pas
      // le statut. Trouvé en conditions réelles le 2026-08-27, jamais par un test local.
      //
      // Les cas terminaux sont ceux où hifago ne peut RIEN faire : charge déjà attachée, client
      // arrivé, booking déjà disparu. L'entrée est close avec le corps conservé. Les traiter comme
      // des incidents déclencherait notify_all_admins sans dédup, soit un e-mail à chaque admin à
      // chaque annulation — le défaut C9, corrigé le 2026-08-26 sur le chemin jumeau.
      if (response.status === 422 && TERMINAL_LOBBY_ERRORS.has(lobbyErrorCode(response.body) ?? "")) {
        summary.restricted++;
        console.warn(
          `pms-cancel-bookings : booking ${row.pms_booking_id} non annulable par API (422 ${lobbyErrorCode(response.body)})`
        );
        await supabase.rpc("resolve_pms_cancellation", {
          p_entry_id: row.entry_id, p_outcome: "done", p_lobby_status_code: 422,
          p_error: JSON.stringify(response.body),
        });
        continue;
      }

      // Tout le reste est une vraie panne : réessai borné, puis clôture en échec. Le statut est
      // recopié DANS le message : `requeue_pms_cancellation` ne conserve que `last_error`, et sans
      // ça un réessai perd l'information la plus utile au diagnostic (constaté le 2026-08-27 —
      // `lobby_status_code` restait null sur une entrée requeue, il a fallu deviner).
      await recordFailure(
        supabase, row, summary, response.status,
        `HTTP ${response.status} — ${JSON.stringify(response.body)}`
      );
    } catch (err) {
      await recordFailure(supabase, row, summary, null, String(err));
    }
  }

  // Jamais l'URL de la requête dans un log : elle porte `api_token` en query string
  // (hifago/CLAUDE.md §8). Seuls le booking et le corps de réponse apparaissent.
  console.info("pms-cancel-bookings", summary);
  return new Response(JSON.stringify({ ok: true, ...summary }), {
    headers: { "Content-Type": "application/json" },
  });
});

async function recordFailure(
  supabase: ReturnType<typeof createClient>,
  row: CancellationRow,
  summary: { retried: number; failed: number },
  statusCode: number | null,
  error: string
) {
  // `attempts` vient du claim, qui l'a incrémenté dans son propre UPDATE et le RETOURNE depuis
  // 20260827260000 : plus de relecture de la table ici — elle est RPC-only, et cette lecture
  // directe était le seul endroit du job qui l'ignorait. On compare donc au nombre de passages
  // effectués, pas à celui d'avant l'appel.
  const attempts = row.attempts;

  if (attempts >= MAX_ATTEMPTS) {
    summary.failed++;
    console.error(
      `pms-cancel-bookings : booking ${row.pms_booking_id} abandonné après ${attempts} tentatives — ${error}`
    );
    await supabase.rpc("resolve_pms_cancellation", {
      p_entry_id: row.entry_id, p_outcome: "failed", p_lobby_status_code: statusCode, p_error: error,
    });
    return;
  }

  summary.retried++;
  await supabase.rpc("requeue_pms_cancellation", { p_entry_id: row.entry_id, p_error: error });
}
