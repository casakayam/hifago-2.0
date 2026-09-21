// Spec 39 (Lot B) — réconciliation Mercado Pago qui PILOTE l'expiration des commandes.
// Déclenchée toutes les 2 min par pg_cron/pg_net (migration 20260921100000, `invoke_payments_
// reconcile`). Remplace `expire_stale_payment_orders`, qui annulait une commande de plus de 30 min
// SANS demander à Mercado Pago si l'argent était encaissé (incident HFG-000013 du 2026-09-20).
//
// Ce que fait cette fonction, et rien d'autre : elle POSE LES QUESTIONS à Mercado Pago (identité du
// token, recherche par external_reference, annulation d'un paiement en attente) et transmet les
// réponses aux RPC, qui DÉCIDENT sous verrou (`reconcile_order`, `expire_payment_order`,
// `record_mp_payment_status`). Aucune décision ici. Échec fermé partout : MP injoignable, identité
// du token douteuse, budget d'appels épuisé ⇒ ce qui n'a pas pu être vérifié attend le tick suivant,
// rien n'expire, et le heartbeat le dit (`job_heartbeats`, watchdog SQL à 15 min).
//
// Même squelette que pms-poll-bookings/index.ts. Points propres à ce job :
//   - le bearer est comparé à SUPABASE_SERVICE_ROLE_KEY (le `verify_jwt` par défaut accepte la clé
//     anon publique — un job qui modifie des paiements ne doit pas être déclenchable par un visiteur) ;
//   - MERCADOPAGO_ACCESS_TOKEN doit appartenir au MÊME compte MP que celui d'apps/web (piège 19) :
//     `GET /users/me` le prouve à chaque run, `reconcile_order` refuse tout si l'id diverge ;
//   - MERCADOPAGO_API_BASE_URL est surchargeable (fixture HTTP des tests d'intégration) ;
//   - aucun `new Date()` (scripts/check-timezone.sh) : l'horodatage de contrôle est `claimed_at`,
//     rendu par la base au moment du claim ; les deltas se calculent sur des instants ISO.
import { createClient } from "npm:@supabase/supabase-js@2";

const MP_DEFAULT_BASE_URL = "https://api.mercadopago.com";
/** Appels MP par run, toutes routes confondues : au-delà, le reste attend le tick suivant (2 min). */
const MAX_MP_CALLS = 60;
/** Une préférence Checkout Pro meurt 28 min après orders.created_at (create/route.ts) : un paiement
 *  `rejected`/`cancelled` dont MP a déjà dit le dernier mot n'a plus rien à révéler après ça. */
const PREFERENCE_LIFETIME_MS = 28 * 60_000;
const TERMINAL_MP_STATUSES = new Set(["approved", "rejected", "cancelled", "refunded", "charged_back"]);

interface LocalPayment {
  id: string;
  status: string;
  amount_cop: number;
  mp_payment_id: string | null;
  mp_collector_id: string | null;
  mp_last_status: string | null;
  created_at: string;
  mp_cancel_attempts: number;
}
interface ClaimedOrder {
  order_id: string;
  created_at: string;
  claimed_at: string;
  payment_status: string;
  payments: LocalPayment[];
}
interface WatchedPayment {
  payment_id: string;
  order_id: string;
  claimed_at: string;
}
interface MpPayment {
  id: number | string;
  status: string;
  status_detail?: string;
  transaction_amount?: number;
  external_reference?: string;
  date_created?: string;
  date_approved?: string | null;
  collector_id?: number | string;
}
/** La forme que `reconcile_order`/`record_mp_payment_status` attendent dans p_mp_payments. */
interface MpItem {
  payment_id: string;
  mp_payment_id: string;
  status: string;
  status_detail: string | null;
  transaction_amount: number | null;
  date_created: string | null;
  date_approved: string | null;
  collector_id: string | null;
}
interface Decision {
  action: string;
  mp_cancel_ids?: string[];
}
interface ClaimedRefund {
  refund_id: string;
  mp_payment_id: string;
  amount_cop: number;
  attempts: number;
  claimed_at: string;
}

class MpBudgetExceeded extends Error {}

function json(payload: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function toItem(paymentId: string, p: MpPayment): MpItem {
  return {
    payment_id: paymentId,
    mp_payment_id: String(p.id),
    status: String(p.status),
    status_detail: p.status_detail ?? null,
    transaction_amount: typeof p.transaction_amount === "number" ? p.transaction_amount : null,
    date_created: p.date_created ?? null,
    date_approved: p.date_approved ?? null,
    collector_id: p.collector_id === undefined ? null : String(p.collector_id),
  };
}

Deno.serve(async (req) => {
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!serviceKey || req.headers.get("authorization") !== `Bearer ${serviceKey}`) {
    return json({ ok: false, reason: "unauthorized" }, 401);
  }
  const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", serviceKey);

  const body = await req.json().catch(() => ({}));
  const limit = Number((body as { limit?: number })?.limit ?? 25);
  const token = Deno.env.get("MERCADOPAGO_ACCESS_TOKEN");
  const baseUrl = Deno.env.get("MERCADOPAGO_API_BASE_URL") || MP_DEFAULT_BASE_URL;

  const stats = {
    claimed: 0,
    applied: 0,
    expired: 0,
    kept: 0,
    kept_pending: 0,
    closed: 0,
    cancel_attempts: 0,
    identity_mismatch: 0,
    watched: 0,
    refunds_claimed: 0,
    refunds_approved: 0,
    refunds_rejected: 0,
    refunds_retry: 0,
    errors: 0,
    mp_calls: 0,
    budget_hit: false,
    /** Écart max (ms) entre `date_approved` chez MP et l'instant où ce job l'a vu : la mesure du
     *  délai d'indexation de /v1/payments/search, non documenté par MP — sert à caler la marge. */
    index_delay_ms_max: 0,
  };

  async function heartbeat(ok: boolean, error: string | null) {
    const { error: hbError } = await supabase.rpc("heartbeat_job", {
      p_job: "payments-reconcile",
      p_ok: ok,
      p_stats: stats,
      p_error: error,
    });
    if (hbError) console.error("heartbeat_job a échoué", hbError);
  }

  // Sans token, on ne réclame RIEN (patron send-notification-emails) : un claim poserait
  // reconcile_claimed_at pour rien. 200 volontaire — état de configuration, pas une panne.
  if (!token) {
    await heartbeat(false, "MERCADOPAGO_ACCESS_TOKEN manquant (supabase secrets set / functions/.env)");
    return json({ ok: false, reason: "secret_missing", ...stats });
  }

  async function mp(path: string, init?: RequestInit): Promise<{ status: number; body: Record<string, unknown> | null }> {
    if (stats.mp_calls >= MAX_MP_CALLS) throw new MpBudgetExceeded("budget d'appels MP épuisé pour ce run");
    stats.mp_calls++;
    const res = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...((init?.headers as Record<string, string>) ?? {}),
      },
    });
    const parsed = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    return { status: res.status, body: parsed };
  }

  // Identité du token : une recherche VIDE avec le token d'un autre compte MP est exactement
  // l'incident du 2026-09-20 (deux comptes, piège 19). Sans preuve d'identité, rien ne se décide.
  let collectorId: string;
  try {
    const me = await mp("/users/me");
    if (me.status !== 200 || me.body?.id === undefined) {
      throw new Error(`GET /users/me → ${me.status}`);
    }
    collectorId = String(me.body.id);
  } catch (err) {
    await heartbeat(false, `mp_unreachable: ${errorMessage(err)}`);
    return json({ ok: false, reason: "mp_unreachable", ...stats });
  }

  async function searchByReference(paymentId: string): Promise<MpItem[]> {
    const params = new URLSearchParams({
      external_reference: paymentId,
      sort: "date_created",
      criteria: "desc",
      limit: "50",
    });
    const res = await mp(`/v1/payments/search?${params}`);
    if (res.status !== 200) throw new Error(`search ${paymentId} → ${res.status}`);
    const results = ((res.body?.results as MpPayment[] | undefined) ?? []).filter(
      (p) => (p.external_reference ?? paymentId) === paymentId
    );
    return results.map((p) => toItem(paymentId, p));
  }

  function trackIndexDelay(items: MpItem[], seenAt: string) {
    for (const item of items) {
      if (item.status !== "approved" || !item.date_approved) continue;
      const delay = Date.parse(seenAt) - Date.parse(item.date_approved);
      if (Number.isFinite(delay) && delay > stats.index_delay_ms_max) stats.index_delay_ms_max = delay;
    }
  }

  let identityMismatch = false;

  // ---- 1. Commandes candidates -------------------------------------------------------------
  const { data: batch, error: claimError } = await supabase.rpc("claim_orders_to_reconcile", { p_limit: limit });
  if (claimError) {
    await heartbeat(false, `claim_failed: ${claimError.message}`);
    return json({ ok: false, reason: "claim_failed" }, 500);
  }
  const orders = (batch ?? []) as ClaimedOrder[];
  stats.claimed = orders.length;

  for (const order of orders) {
    try {
      const preferenceDead =
        Date.parse(order.created_at) + PREFERENCE_LIFETIME_MS < Date.parse(order.claimed_at);
      // Un paiement local déjà terminal chez MP, dont la préférence est morte, ne peut plus rien
      // révéler : pas de recherche pour lui (budget). Tous les autres sont demandés — y compris un
      // `rejected` dont la préférence vit encore (carte retentée dans la même session).
      const useful = order.payments.filter(
        (p) =>
          !(
            (p.status === "rejected" || p.status === "cancelled") &&
            p.mp_last_status !== null &&
            TERMINAL_MP_STATUSES.has(p.mp_last_status) &&
            preferenceDead
          )
      );
      const items: MpItem[] = [];
      for (const p of useful) items.push(...(await searchByReference(p.id)));

      const { data, error: rpcError } = await supabase.rpc("reconcile_order", {
        p_order_id: order.order_id,
        p_mp_payments: items,
        p_checked_at: order.claimed_at,
        p_collector_id: collectorId,
      });
      if (rpcError) throw rpcError;
      const decision = (data ?? { action: "kept" }) as Decision;

      switch (decision.action) {
        case "applied":
          stats.applied++;
          trackIndexDelay(items, order.claimed_at);
          break;
        case "expired":
          stats.expired++;
          break;
        case "kept_pending":
          stats.kept_pending++;
          break;
        case "closed":
          stats.closed++;
          break;
        case "identity_mismatch":
          stats.identity_mismatch++;
          identityMismatch = true;
          break;
        case "cancel_at_mp":
          break;
        default:
          stats.kept++;
      }

      // D2 — annulation chez MP en meilleur effort : PUT, puis re-GET pour lire ce que MP a
      // RÉELLEMENT fait (un PUT refusé sur un virement approuvé entre-temps doit devenir une
      // confirmation, jamais une expiration). La borne (3 tentatives / 2 h 30) vit dans
      // expire_payment_order, pas ici.
      const cancelIds = decision.mp_cancel_ids ?? [];
      if (cancelIds.length > 0) {
        let approvedSeen = false;
        for (const mpId of cancelIds) {
          const item = items.find((i) => i.mp_payment_id === mpId);
          if (!item) continue;
          stats.cancel_attempts++;
          const put = await mp(`/v1/payments/${encodeURIComponent(mpId)}`, {
            method: "PUT",
            body: JSON.stringify({ status: "cancelled" }),
          });
          const get = await mp(`/v1/payments/${encodeURIComponent(mpId)}`);
          const statusAfter =
            get.status === 200 && typeof get.body?.status === "string"
              ? (get.body.status as string)
              : put.status === 200
                ? "cancelled"
                : null;
          await supabase.rpc("mark_mp_cancel_attempt", {
            p_payment_id: item.payment_id,
            p_mp_status_after: statusAfter,
          });
          if (statusAfter === "approved") {
            approvedSeen = true;
            await supabase.rpc("apply_payment_webhook_checked", {
              p_mp_payment_id: mpId,
              p_external_reference: item.payment_id,
              p_status: "approved",
              p_transaction_amount:
                typeof get.body?.transaction_amount === "number"
                  ? (get.body.transaction_amount as number)
                  : item.transaction_amount,
              p_raw_event: get.body ?? item,
            });
            stats.applied++;
          }
        }
        if (decision.action === "cancel_at_mp" && !approvedSeen) {
          const { data: expired } = await supabase.rpc("expire_payment_order", {
            p_order_id: order.order_id,
            p_checked_at: order.claimed_at,
          });
          if ((expired as { ok?: boolean } | null)?.ok) stats.expired++;
          else stats.kept_pending++;
        }
      }
    } catch (err) {
      if (err instanceof MpBudgetExceeded) {
        stats.budget_hit = true;
        break;
      }
      stats.errors++;
      console.error(`payments-reconcile: commande ${order.order_id} en échec — ${errorMessage(err)}`);
    }
  }

  // ---- 2. Surveillance après expiration/annulation (48 h) ----------------------------------
  // Un virement PSE qui aboutit après l'expiration, une approbation indexée tard : l'argent doit
  // rester visible même si le webhook est mort — la garde du Lot A en fait une entrée refund_required.
  if (!stats.budget_hit) {
    const { data: watched, error: watchError } = await supabase.rpc("claim_payments_to_watch", { p_limit: limit });
    if (watchError) {
      stats.errors++;
      console.error("claim_payments_to_watch a échoué", watchError);
    }
    for (const w of (watched ?? []) as WatchedPayment[]) {
      try {
        const items = await searchByReference(w.payment_id);
        const { error: recError } = await supabase.rpc("record_mp_payment_status", {
          p_payment_id: w.payment_id,
          p_mp_payments: items,
          p_checked_at: w.claimed_at,
        });
        if (recError) throw recError;
        stats.watched++;
      } catch (err) {
        if (err instanceof MpBudgetExceeded) {
          stats.budget_hit = true;
          break;
        }
        stats.errors++;
        console.error(`payments-reconcile: surveillance ${w.payment_id} en échec — ${errorMessage(err)}`);
      }
    }
  }

  // ---- 3. Remboursements demandés par l'admin (spec 39 D3, migration 20260922100000) -------
  // Un seul appel MP par remboursement, X-Idempotency-Key = payment_refunds.id : un run mort entre
  // l'appel et finalize rejoue la même clé au bail suivant, MP ne rembourse pas deux fois. Le corps
  // d'erreur est conservé tel quel (raw_response) — le mapping « déjà remboursé » / « trop vieux »
  // s'écrit sur des corps CAPTURÉS en préprod, jamais devinés (spec 39 §10.5).
  if (!stats.budget_hit) {
    const { data: refunds, error: refundClaimError } = await supabase.rpc("claim_payment_refunds", { p_limit: 10 });
    if (refundClaimError) {
      stats.errors++;
      console.error("claim_payment_refunds a échoué", refundClaimError);
    }
    for (const refund of (refunds ?? []) as ClaimedRefund[]) {
      stats.refunds_claimed++;
      try {
        const res = await mp(`/v1/payments/${encodeURIComponent(refund.mp_payment_id)}/refunds`, {
          method: "POST",
          headers: { "X-Idempotency-Key": refund.refund_id },
          body: JSON.stringify({}),
        });
        const message = String(res.body?.message ?? "");
        if (res.status === 200 || res.status === 201) {
          await supabase.rpc("finalize_payment_refund", {
            p_refund_id: refund.refund_id,
            p_outcome: "approved",
            p_mp_refund_id: res.body?.id === undefined ? null : String(res.body.id),
            p_raw: res.body,
          });
          stats.refunds_approved++;
        } else if (res.status >= 500 || res.status === 429) {
          await supabase.rpc("fail_payment_refund", {
            p_refund_id: refund.refund_id,
            p_error: `HTTP ${res.status} ${message}`.trim(),
          });
          stats.refunds_retry++;
        } else {
          // 4xx métier : refus définitif, l'admin reprend la main avec le corps exact sous les yeux.
          await supabase.rpc("finalize_payment_refund", {
            p_refund_id: refund.refund_id,
            p_outcome: "rejected",
            p_mp_refund_id: null,
            p_raw: res.body,
            p_error: `HTTP ${res.status} ${message}`.trim(),
          });
          stats.refunds_rejected++;
        }
      } catch (err) {
        if (err instanceof MpBudgetExceeded) {
          stats.budget_hit = true;
          break;
        }
        stats.errors++;
        await supabase.rpc("fail_payment_refund", { p_refund_id: refund.refund_id, p_error: errorMessage(err) });
        stats.refunds_retry++;
      }
    }
  }

  const ok = !identityMismatch;
  await heartbeat(
    ok,
    identityMismatch
      ? "identity_mismatch: MERCADOPAGO_ACCESS_TOKEN n'appartient pas au compte MP qui a créé les préférences (piège 19)"
      : null
  );
  console.info("payments-reconcile", JSON.stringify(stats));
  return json({ ok, ...stats });
});
