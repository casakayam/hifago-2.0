// Spec 21 — Connecteur LobbyPMS, Phase 6. Première Edge Function de ce dépôt (aucun précédent
// local à imiter — cf. spec 21 §6, expire_stale_payment_orders n'a besoin d'aucun appel réseau).
// Déclenchée toutes les 15 min par pg_cron/pg_net (migration 20260819140000_pms_jobs_cron.sql),
// réclame un lot de 20 bookings dus au poll (claim_pms_poll_batch, migration 20260819120000) et
// relit chacun côté Lobby pour détecter une annulation ou un traslado fait par le staff PMS
// directement dans son logiciel — jamais de notification en temps réel côté Lobby (pas de webhook,
// client cahier des charges §5), d'où le poll.
//
// Import relatif du module domain (aucun bare-specifier npm dans packages/domain/src/pms/ à ce
// jour → résoluble directement par Deno). Point à vérifier UNE FOIS avant un déploiement réel
// (supabase functions deploy) : certaines versions du CLI ne bundlent pas un import relatif situé
// hors du dossier de la fonction — sans impact sur le développement local, seul périmètre de cette
// spec (Tranche 1, §2).
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  getLobbyBookingDetail,
  LOBBY_DEFAULT_BASE_URL,
} from "../../../packages/domain/src/pms/lobbyClient.ts";
import { isPossibleTraslado, isRealized } from "../../../packages/domain/src/pms/detectTraslado.ts";

interface PollBatchRow {
  order_line_id: string;
  pms_booking_id: string;
  establishment_id: string;
  lobby_api_token: string;
}

Deno.serve(async () => {
  // SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY sont injectées automatiquement par le runtime Edge
  // Functions — jamais à définir manuellement, contrairement à LOBBY_API_BASE_URL (spécifique à ce
  // connecteur, cf. supabase/functions/.env en local).
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );
  const baseUrl = Deno.env.get("LOBBY_API_BASE_URL") || LOBBY_DEFAULT_BASE_URL;

  const { data: batch, error } = await supabase.rpc("claim_pms_poll_batch", { p_limit: 20 });
  if (error) {
    console.error("claim_pms_poll_batch a échoué", error);
    return new Response(JSON.stringify({ ok: false, reason: "claim_failed" }), { status: 500 });
  }

  const rows = (batch ?? []) as PollBatchRow[];
  const summary = { polled: 0, cancelled: 0, fulfilled: 0, flagged: 0, errors: 0 };

  for (const row of rows) {
    summary.polled++;
    try {
      const detail = await getLobbyBookingDetail(baseUrl, row.lobby_api_token, Number(row.pms_booking_id));

      if (detail.status === 404) {
        // Cas limite spec 21 §0 : un booking annulé par API n'est plus retourné du tout —
        // c'est ainsi qu'on détecte l'annulation (piège empirique confirmé v1), jamais via un
        // champ deleted_at.
        await supabase
          .from("order_lines")
          .update({ status: "cancelled_by_provider" })
          .eq("id", row.order_line_id)
          .eq("status", "reserved");
        await supabase.from("pms_reconciliation_entries").insert({ order_line_id: row.order_line_id });
        summary.cancelled++;
        continue;
      }

      if (detail.status !== 200) {
        // Erreur isolée par booking (401 jeton révoqué, 5xx Lobby...) — ne bloque jamais le reste
        // du lot (cas limite spec 21 §0).
        await supabase.from("pms_reconciliation_entries").insert({ order_line_id: row.order_line_id });
        summary.errors++;
        continue;
      }

      const data = (detail.body as { data?: Record<string, unknown> })?.data;
      if (!data) {
        await supabase.from("pms_reconciliation_entries").insert({ order_line_id: row.order_line_id });
        summary.errors++;
        continue;
      }

      const detailData = {
        checkin_realizado: (data.checkin_realizado as number | null) ?? null,
        checkout_realizado: (data.checkout_realizado as number | null) ?? null,
        total_alojamiento: String(data.total_alojamiento ?? "0"),
        descuentos: (data.descuentos as unknown[] | null) ?? null,
        deleted_at: (data.deleted_at as string | null) ?? null,
      };

      if (isRealized(detailData)) {
        await supabase
          .from("order_lines")
          .update({ status: "fulfilled" })
          .eq("id", row.order_line_id)
          .eq("status", "reserved");
        summary.fulfilled++;
      }
      if (isPossibleTraslado(detailData)) {
        await supabase.from("pms_reconciliation_entries").insert({ order_line_id: row.order_line_id });
        summary.flagged++;
      }
    } catch (err) {
      console.error(`établissement ${row.establishment_id} : poll échoué pour ${row.order_line_id}`, err);
      await supabase.from("pms_reconciliation_entries").insert({ order_line_id: row.order_line_id });
      summary.errors++;
    }
  }

  return new Response(JSON.stringify({ ok: true, ...summary }), {
    headers: { "Content-Type": "application/json" },
  });
});
