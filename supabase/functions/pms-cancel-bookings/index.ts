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
}

// Au-delà, l'entrée est close en 'failed' plutôt que réessayée indéfiniment. Trois passages du cron
// suffisent à absorber une indisponibilité passagère du relais ou de Lobby ; au-delà c'est une
// panne qui demande un humain, et la retenter en boucle ne fait qu'ajouter du bruit.
const MAX_ATTEMPTS = 3;

// Motif envoyé à Lobby. En espagnol : il s'affiche tel quel dans le logiciel du partenaire, qui
// n'est pas francophone.
const CANCELLATION_REASON = "Cancelado desde hifago";

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
        CANCELLATION_REASON,
        undefined,
        relaySecret
      );

      // 200 — annulé. C'est le cas nominal.
      if (response.status === 200) {
        summary.cancelled++;
        await supabase.rpc("resolve_pms_cancellation", {
          p_entry_id: row.entry_id, p_outcome: "done", p_lobby_status_code: 200,
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

      // 422 — cas ATTENDU et documenté (spec 21 §0) : le booking porte déjà une charge côté
      // partenaire, Lobby refuse de l'annuler par API. Ce n'est pas une panne, et personne côté
      // hifago ne peut le « résoudre » : l'entrée est close, avec le corps conservé pour qu'on
      // sache pourquoi. La traiter comme un incident déclencherait notify_all_admins sans dédup,
      // soit un e-mail à chaque admin à chaque annulation — le défaut C9, corrigé le 2026-08-26
      // sur le chemin jumeau.
      if (response.status === 422) {
        summary.restricted++;
        console.warn(
          `pms-cancel-bookings : booking ${row.pms_booking_id} non annulable par API (422) — ${JSON.stringify(response.body)}`
        );
        await supabase.rpc("resolve_pms_cancellation", {
          p_entry_id: row.entry_id, p_outcome: "done", p_lobby_status_code: 422,
          p_error: JSON.stringify(response.body),
        });
        continue;
      }

      // Tout le reste est une vraie panne : réessai borné, puis clôture en échec.
      await recordFailure(supabase, row, summary, response.status, JSON.stringify(response.body));
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
  // `attempts` a déjà été incrémenté par claim_pms_cancellation_batch : on compare donc au nombre
  // de passages effectués, pas à celui d'avant l'appel.
  const { data: entry } = await supabase
    .from("pms_cancellation_queue")
    .select("attempts")
    .eq("id", row.entry_id)
    .maybeSingle();
  const attempts = (entry as { attempts?: number } | null)?.attempts ?? MAX_ATTEMPTS;

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
