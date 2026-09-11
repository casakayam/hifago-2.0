"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { createClient } from "@hifago/supabase/client";
import { Button, cn } from "@hifago/ui";
// ⚠️ `useRouter` d'`@/i18n/navigation`, jamais de `next/navigation` (scripts/check-i18n-links.sh).
// Ici seul `refresh()` est utilisé — que next-intl conserve tel quel (il ne surcharge que
// push/replace/prefetch) — mais la règle ne souffre pas d'exception au cas par cas : un jour
// quelqu'un ajoutera un `push` dans ce fichier, et il perdrait le préfixe de langue en silence.
import { Link, useRouter } from "@/i18n/navigation";
import { Price } from "@/components/atoms/Price";
import { Title } from "@/components/atoms/Title";
import { formatLineSchedule } from "@/lib/orders/formatLineSchedule";
import type { OrderForDisplay } from "@/lib/orders/getOrderByToken";
import type { Locale } from "@/messages";

// Spec 33 — l'écran de résultat, et la fermeture du tunnel.
//
// Colocalisé avec sa route, jamais dans `components/organisms/` : il ne sert qu'ici, et
// `components/README.md` réserve `components/` à ce qui est prouvé consommé par au moins deux
// endroits (`CartSummary` y est parce qu'il sert `/carrito` ET `/pago`). Mêmes précédents :
// `pago/CheckoutForm.tsx`, `cuenta/reservas/OrdersList.tsx`.
//
// ⚠️ CE N'EST PAS `CartSummary`, et la tentation de fusionner est réelle : mêmes lignes, même mise
// en forme. Les deux divergent sur le FOND — `CartSummary` lit `products.price_cop` VIVANT et sait
// retirer une ligne ; celui-ci lit `order_lines.total_cop`/`acompte_cop` FIGÉS au moment de la
// commande. Les fusionner ferait afficher un prix courant sur une commande passée (spec 32
// invariant 3). Seule la mise en forme commune est partagée, via `formatLineSchedule`.
//
// ⚠️ `startPayment` vit ICI et non dans `CheckoutForm` : l'état de paiement doit survivre au
// retour de Mercado Pago, donc vivre sur une adresse rechargeable plutôt que dans un `useState`
// (le récit complet est dans `packages/e2e-support/src/payments.ts`).

// Vocabulaire propre à `create_payment_intent`, repris tel quel de `CheckoutForm` — un motif
// inattendu retombe sur "unknown" plutôt que de faire échouer next-intl sur une clé manquante.
const PAYMENT_ERROR_REASONS = [
  "payment_already_pending",
  "already_paid",
  "nothing_to_pay",
  "order_not_found",
  "mercadopago_unavailable",
] as const;

type PaymentIntentResult = { ok: boolean; reason?: string; payment_id?: string };

/** Cadence et plafond du rafraîchissement pendant l'attente du webhook (≈ 1 minute au total). */
const REFRESH_INTERVAL_MS = 3000;
const MAX_REFRESH_TICKS = 20;

/** Lignes qui ne comptent plus — même liste que la RPC, qui exclut les mêmes des totaux. */
const DEAD_LINE_STATUSES = ["cancelled_by_client", "cancelled_by_provider", "expired", "superseded"];

export type OrderResultProps = {
  order: OrderForDisplay;
  locale: Locale;
  /** Un compte RÉEL, jamais une identité anonyme (spec 33 invariant 8, résolu par la page). */
  isRealAccount: boolean;
};

export function OrderResult({ order, locale, isRealAccount }: OrderResultProps) {
  const t = useTranslations("OrderResultPage");
  const router = useRouter();
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [isPaying, setIsPaying] = useState(false);

  // L'état de la COMMANDE et l'incident de PAIEMENT sont deux choses distinctes : les mélanger
  // faisait réécrire trois fois les mêmes conditions (et rendait `isPayable` vrai sur une commande
  // déjà payée dont un paiement de trop avait échoué).
  const isAwaiting = order.paymentStatus === "pending";
  const orderState =
    order.paymentStatus === "paid"
      ? "paid"
      : isAwaiting
        ? "awaiting"
        : order.lines.some((line) => !DEAD_LINE_STATUSES.includes(line.status))
          ? "unpaid"
          : order.lines.some((line) => line.status === "expired")
            ? "expired"
            : "cancelled";

  const state = paymentError ? "failed" : orderState;
  const isPayable = orderState === "unpaid";

  // Le webhook Mercado Pago peut arriver APRÈS la redirection du client : tant que la commande est
  // 'pending', on relit l'écran pour qu'il se mette à jour tout seul.
  //
  // ⚠️ `router.refresh()` et NON un appel à `GET /api/payments/[orderId]/status`. Cette route lit
  // `orders` en `service_role` sur la seule possession de l'`order_id` — c'est-à-dire l'autre
  // modèle d'autorisation, celui que la spec 33 a justement écarté (§3 décision ② : l'identifiant
  // et le secret ne doivent pas être le même objet). La faire sonder d'ici aurait donné DEUX
  // modèles d'accès au même écran, et rendu faux l'invariant 2 (« l'écran ne fait ni `.from` ni
  // appel `service_role` »). Un refresh relit `get_order_by_token` — même jeton, même garde.
  //
  // ⚠️ BORNÉ. Sans plafond, un paiement abandonné ferait sonder toutes les 3 s jusqu'à ce que
  // `expire_stale_payment_orders` reprenne la commande, ~30 minutes plus tard : ~600 rendus serveur
  // pour une information qui arrive en quelques secondes. On s'arrête après MAX_TICKS, et on ne
  // sonde pas un onglet que personne ne regarde.
  //
  // ⚠️ Le corps est écrit INLINE dans l'effet, jamais délégué à une fonction nommée : la règle
  // `react-hooks/set-state-in-effect` (eslint-plugin-react-hooks 7.1.1) trace statiquement qu'un
  // identifiant appelé dans un effet pose de l'état. Même patron que `CoquillaVitrine`.
  useEffect(() => {
    if (!isAwaiting) return;
    let ticks = 0;
    const timer = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      ticks += 1;
      if (ticks > MAX_REFRESH_TICKS) {
        clearInterval(timer);
        return;
      }
      router.refresh();
    }, REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [isAwaiting, router]);

  async function startPayment() {
    setPaymentError(null);
    setIsPaying(true);

    const supabase = createClient();
    const { data, error: intentError } = await supabase.rpc("create_payment_intent", {
      p_order_id: order.id,
    });
    const intentResult = data as PaymentIntentResult | null;
    if (intentError || !intentResult?.ok) {
      setIsPaying(false);
      const raw = intentResult?.reason;
      const reason =
        raw !== undefined && (PAYMENT_ERROR_REASONS as readonly string[]).includes(raw)
          ? raw
          : "unknown";
      setPaymentError(t(`errors.${reason}`));
      return;
    }

    let createResponse: Response;
    try {
      createResponse = await fetch("/api/payments/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentId: intentResult.payment_id }),
      });
    } catch {
      setIsPaying(false);
      setPaymentError(t("errors.mercadopago_unavailable"));
      return;
    }
    const createResult = (await createResponse.json().catch(() => null)) as
      | { ok: boolean; init_point?: string }
      | null;
    if (!createResponse.ok || !createResult?.ok || !createResult.init_point) {
      setIsPaying(false);
      setPaymentError(t("errors.mercadopago_unavailable"));
      return;
    }

    // Redirection réelle vers Checkout Pro — la page se démonte ici, `isPaying` volontairement
    // jamais remis à false (rien à afficher après un unmount). Mercado Pago renverra sur CETTE
    // adresse, quelle que soit l'issue.
    window.location.href = createResult.init_point;
  }

  const remainderCop = order.totalCop - order.acompteCop;

  return (
    <div className="flex flex-col gap-6" data-testid="order-result">
      <div
        role="status"
        data-testid={`order-state-${state}`}
        className={cn(
          "flex flex-col gap-1 rounded-lg border p-4",
          state === "paid"
            ? "border-success bg-success/10"
            : state === "failed" || state === "expired" || state === "cancelled"
              ? "border-danger bg-danger/10"
              : "border"
        )}
      >
        <p className="font-medium">{t(`status.${state}`)}</p>
        <p className="text-sm text-muted">{t(`status.${state}Detail`)}</p>
        {paymentError ? (
          <p role="alert" data-testid="payment-error" className="text-sm text-danger">
            {paymentError}
          </p>
        ) : null}
      </div>

      {isPayable ? (
        <Button
          type="button"
          onPress={startPayment}
          isDisabled={isPaying}
          data-testid={paymentError ? "retry-payment-button" : "pay-button"}
          className="w-fit"
        >
          {isPaying ? t("paying") : paymentError ? t("retryPayment") : t("pay")}
        </Button>
      ) : null}

      <section className="flex flex-col gap-3">
        <Title as="h2">{t("summary")}</Title>
        <ul className="flex flex-col gap-3">
          {order.lines.map((line) => {
            const isDead = DEAD_LINE_STATUSES.includes(line.status);
            return (
              <li
                key={line.id}
                data-testid={`order-line-${line.id}`}
                data-status={line.status}
                className={cn(
                  "flex items-center justify-between gap-4 rounded-lg border p-3 text-sm",
                  isDead ? "border-default-200 text-muted" : "border"
                )}
              >
                <div className="flex flex-col">
                  <span className={cn("font-medium", isDead && "line-through")}>
                    {line.productName}
                  </span>
                  <span className="text-muted">
                    {line.establishmentName} · {formatLineSchedule(line)} ·{" "}
                    {t("lineQty", { count: line.qty })}
                  </span>
                  <span className="text-xs text-muted">{t(`lineStatus.${line.status}`)}</span>
                </div>
                <Price amountCop={line.totalCop} locale={locale} />
              </li>
            );
          })}
        </ul>

        <dl className="flex flex-col gap-1 border-t pt-3 text-sm">
          <div className="flex justify-between font-medium">
            <dt>{t("total")}</dt>
            <dd>
              <Price amountCop={order.totalCop} locale={locale} testId="order-total" />
            </dd>
          </div>
          <div className="flex justify-between text-muted">
            <dt>{t("acompte")}</dt>
            <dd>
              <Price amountCop={order.acompteCop} locale={locale} testId="order-acompte" />
            </dd>
          </div>
          {/* Le client paie 17 % en ligne, le reste à l'établissement (cahier §2b.8) — le dire ici
              évite qu'il croie avoir tout réglé, ou n'avoir rien réglé. */}
          <div className="flex justify-between text-muted">
            <dt>{t("remainder")}</dt>
            <dd>
              <Price amountCop={remainderCop} locale={locale} testId="order-remainder" />
            </dd>
          </div>
        </dl>
      </section>

      <section className="flex flex-col gap-1 text-sm">
        <Title as="h2">{t("holder")}</Title>
        <p>
          <span className="text-muted">{t("holderName")} : </span>
          {order.holderName}
        </p>
        {order.holderPhone ? (
          <p>
            <span className="text-muted">{t("holderPhone")} : </span>
            {order.holderPhone}
          </p>
        ) : null}
        <p>
          <span className="text-muted">{t("holderEmail")} : </span>
          {order.holderEmail}
        </p>
      </section>

      <p className="text-xs text-muted" data-testid="keep-link">
        {t("keepLink")}
      </p>

      {isRealAccount ? (
        <Link href="/cuenta/reservas" data-testid="view-orders-link" className="text-sm hover:underline">
          {t("viewOrders")}
        </Link>
      ) : (
        // Le rattachement des commandes par email est fait par `attach_orders_to_account`, appelée
        // depuis /auth/callback une fois l'email VÉRIFIÉ (spec 33 Tranche 3). L'email est pré-rempli
        // pour que le client ne rattache pas par erreur une adresse différente de sa commande.
        <Link
          href={`/registro?next=/cuenta/reservas&email=${encodeURIComponent(order.holderEmail)}`}
          data-testid="create-account-link"
          className="text-sm hover:underline"
        >
          {t("createAccount")}
        </Link>
      )}
    </div>
  );
}
