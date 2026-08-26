// Spec 23 Tranche 1 — dispatch de la file notification_emails vers Resend. Squelette calqué sur
// supabase/functions/pms-poll-bookings/index.ts (première Edge Function du dépôt) : réclame un
// lot via une RPC service_role-only, traite chaque ligne isolément (une erreur n'empêche jamais le
// reste du lot), jamais de vrai envoi en CI (RESEND_API_BASE_URL overridable, même pattern que
// LOBBY_API_BASE_URL, pour interception par un serveur de fixtures local).
//
// Réponse HTTP volontairement agrégée (spec 23 §8.6) : jamais recipient_email/subject/body_html
// d'une ligne individuelle — supabase/config.toml n'a aucune section [functions.*], donc cette
// fonction hérite du défaut verify_jwt=true, qui accepte n'importe quel JWT valide (y compris la
// clé publique anon, pas seulement service_role) — gap pré-existant du projet (déjà vrai pour
// pms-poll-bookings), pas introduit ici, signalé mais non corrigé sans accord de Jérôme (spec 23
// §10 point 16).
import { createClient } from "npm:@supabase/supabase-js@2";

interface NotificationEmailRow {
  id: string;
  recipient_email: string;
  subject: string;
  body_html: string;
}

Deno.serve(async () => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );
  const baseUrl = Deno.env.get("RESEND_API_BASE_URL") || "https://api.resend.com";
  const apiKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("NOTIFICATION_EMAIL_FROM") || "notificaciones@hifago.test";

  const { data: batch, error } = await supabase.rpc("claim_notification_email_batch", { p_limit: 20 });
  if (error) {
    console.error("claim_notification_email_batch a échoué", error);
    return new Response(JSON.stringify({ ok: false, reason: "claim_failed" }), { status: 500 });
  }

  const rows = (batch ?? []) as NotificationEmailRow[];
  const summary = { claimed: rows.length, sent: 0, failed: 0 };

  if (!apiKey) {
    // Cas attendu en dev local sans clé Resend réelle (spec 23 §2, hors périmètre du code) —
    // chaque ligne réclamée est marquée failed/retry plutôt que de rester bloquée à 'sending'
    // indéfiniment (mark_notification_email_failed gère déjà le passage à 'pending' pour retry).
    for (const row of rows) {
      await supabase.rpc("mark_notification_email_failed", {
        p_id: row.id,
        p_error: "RESEND_API_KEY manquante — voir supabase/functions/.env",
      });
      summary.failed++;
    }
    return new Response(JSON.stringify({ ok: true, ...summary }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  for (const row of rows) {
    try {
      const res = await fetch(`${baseUrl}/emails`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          // Idempotency-Key (spec 23 §8.4) : protège contre un envoi physique en double si cette
          // ligne est reprise par claim_notification_email_batch après un crash survenu APRÈS un
          // envoi Resend déjà réussi mais AVANT mark_notification_email_sent.
          "Idempotency-Key": row.id,
        },
        body: JSON.stringify({
          from,
          to: row.recipient_email,
          subject: row.subject,
          html: row.body_html,
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        await supabase.rpc("mark_notification_email_failed", {
          p_id: row.id,
          p_error: `Resend ${res.status}: ${text.slice(0, 500)}`,
        });
        summary.failed++;
        continue;
      }

      const body = (await res.json()) as { id?: string };
      await supabase.rpc("mark_notification_email_sent", {
        p_id: row.id,
        p_provider_message_id: body.id ?? null,
      });
      summary.sent++;
    } catch (err) {
      console.error(`notification_emails ${row.id} : envoi échoué`, err);
      await supabase.rpc("mark_notification_email_failed", {
        p_id: row.id,
        p_error: String(err).slice(0, 500),
      });
      summary.failed++;
    }
  }

  return new Response(JSON.stringify({ ok: true, ...summary }), {
    headers: { "Content-Type": "application/json" },
  });
});
