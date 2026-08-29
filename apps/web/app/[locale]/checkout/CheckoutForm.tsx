"use client";

import { useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { Link } from "@/i18n/navigation";
import { createClient } from "@hifago/supabase/client";
import { useCart } from "@/lib/cart/CartContext";
import { Button, Checkbox, Input, Label, TextField, cn } from "@hifago/ui";
import { formatCop } from "@hifago/domain";

// Raisons qui renvoient `line` (product_id/date de LA ligne fautive) — toujours un sous-ensemble
// de KNOWN_REASONS ci-dessous (composé à partir de celui-ci, jamais recopié à la main : chaque
// littéral n'existe qu'à un seul endroit du fichier). Spec 17 §0 Tranche 2 (alojamiento par
// plage) : invalid_date_range/unsupported_date_range, jamais censées surgir via l'écran réel, mais
// mappées en défense en profondeur si la RPC est appelée directement avec un panier malformé.
// Spec 18 §0 Tranche 1 (produit à créneaux horaires) : slot_required/unsupported_slot_combination,
// même traitement — défense en profondeur, l'écran réel (SlotReservationForm) empêche déjà
// l'absence de slot_start_time ou une combinaison incohérente.
//
// room_type_required/room_type_mismatch/room_type_not_found/end_date_required ont disparu avec
// l'étage hôtel (T3 étape 2, 20260827220000) : create_order ne les produit plus. Les garder ici
// aurait promis une traduction pour une réponse impossible.
const LINE_SCOPED_REASONS = [
  "product_not_found",
  "not_sellable",
  "date_closed",
  "slot_not_found",
  "full",
  "resource_unavailable",
  "invalid_date_range",
  "unsupported_date_range",
  "slot_required",
  "unsupported_slot_combination",
] as const;

// Raisons de create_order qui ne visent PAS une ligne précise (visibles seulement au niveau de la
// commande entière) — jamais dans LINE_SCOPED_REASONS ci-dessus, sans quoi une raison order-scopée
// pointerait à tort sur une ligne du panier. not_authenticated n'apparaît nulle part ici : le
// correctif réservation invité a retiré ce garde-fou de create_order, la RPC ne renvoie plus
// jamais cette raison. resource_unavailable (feature 20, ligne-scopée) reste dans
// LINE_SCOPED_REASONS ci-dessus, pas ici. Cahier des charges client §3e, révisé 2026-08-17 :
// email_required/email_invalid — le champ HTML `isRequired` bloque déjà la soumission vide côté
// front, ces deux raisons restent le filet côté serveur (RPC appelée directement, format invalide
// échappé au front).
const ORDER_SCOPED_REASONS = [
  "empty_cart",
  "lodging_cap_exceeded",
  "prestation_cap_exceeded",
  "qty_cap_exceeded",
  "email_required",
  "email_invalid",
] as const;

// Toutes les raisons mappées côté écran (union des deux listes ci-dessus, jamais un 3e jeu de
// littéraux recopiés) — une raison inattendue (jamais censée arriver, mais la RPC reste la seule
// autorité) retombe sur "unknown" plutôt que de faire échouer next-intl sur une clé manquante.
const KNOWN_REASONS = [...LINE_SCOPED_REASONS, ...ORDER_SCOPED_REASONS] as const;

// (raw éventuellement absent, ex. reason non renvoyée par la RPC) → une des valeurs de `list`, ou
// "unknown" par repli — factorise l'idiome dupliqué aux deux sites d'appel ci-dessous
// (create_payment_intent/PAYMENT_ERROR_REASONS et create_order/KNOWN_REASONS).
function resolveKnownReason<T extends readonly string[]>(
  list: T,
  raw: string | undefined
): T[number] | "unknown" {
  return raw !== undefined && (list as readonly string[]).includes(raw) ? (raw as T[number]) : "unknown";
}

type CreateOrderResult = {
  ok: boolean;
  reason?: string;
  order_id?: string;
  line?: { product_id?: string; date?: string; qty?: number };
};

// Spec 19 §0 Tranche 1 — le paiement de l'acompte est désormais obligatoire pour confirmer une
// réservation : create_order réussi enchaîne automatiquement create_payment_intent (RPC réelle)
// puis POST /api/payments/create (appel SDK Mercado Pago réel) puis une redirection réelle du
// navigateur vers Checkout Pro. Raisons mappées séparément de KNOWN_REASONS (vocabulaire distinct,
// propre à create_payment_intent) — un motif inattendu retombe sur "unknown", même discipline.
const PAYMENT_ERROR_REASONS = [
  "payment_already_pending",
  "already_paid",
  "nothing_to_pay",
  "order_not_found",
  "mercadopago_unavailable",
] as const;

type PaymentIntentResult = {
  ok: boolean;
  reason?: string;
  payment_id?: string;
};

export function CheckoutForm({
  isAuthenticated,
  attributionCode,
  initialHolderName = "",
  initialHolderPhone = "",
  initialHolderEmail = "",
}: {
  isAuthenticated: boolean;
  attributionCode?: string;
  // Feature 32 — pré-remplissage pour un client connecté (page.tsx, depuis auth.users.email et sa
  // commande la plus récente). Défaut "" : comportement invité inchangé. Les champs restent
  // éditables — un pré-remplissage, jamais un verrou.
  initialHolderName?: string;
  initialHolderPhone?: string;
  initialHolderEmail?: string;
}) {
  const t = useTranslations("CheckoutPage");
  const tCommon = useTranslations("Common");
  const locale = useLocale();
  const { lines, removeLine, clear } = useCart();

  const [holderName, setHolderName] = useState(initialHolderName);
  const [holderPhone, setHolderPhone] = useState(initialHolderPhone);
  const [holderEmail, setHolderEmail] = useState(initialHolderEmail);
  const [marketingConsent, setMarketingConsent] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [failedLineKey, setFailedLineKey] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // La commande a réussi dès que pendingOrderId est posé (jamais remis à null ensuite) — le
  // paiement qui suit peut échouer/être retenté sans jamais revenir à l'écran panier.
  const [pendingOrderId, setPendingOrderId] = useState<string | null>(null);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [isPaying, setIsPaying] = useState(false);

  const formatCurrency = (value: number) => formatCop(value, locale);

  const total = lines.reduce((sum, line) => sum + line.priceCop * line.qty, 0);

  async function startPayment(orderId: string) {
    setPaymentError(null);
    setIsPaying(true);

    const supabase = createClient();
    const { data, error: intentError } = await supabase.rpc("create_payment_intent", {
      p_order_id: orderId,
    });
    const intentResult = data as PaymentIntentResult | null;
    if (intentError || !intentResult?.ok) {
      setIsPaying(false);
      const reason = resolveKnownReason(PAYMENT_ERROR_REASONS, intentResult?.reason);
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

    // Redirection réelle vers Checkout Pro — la page se démonte ici, isPaying volontairement
    // jamais remis à false (rien à afficher après un unmount).
    window.location.href = createResult.init_point;
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setFailedLineKey(null);

    // Pas de blocage invité (correctif réservation invité) : le compte n'apporte qu'un confort en
    // plus, jamais une obligation — create_order accepte account_id null tel quel.
    if (lines.length === 0) return;

    setIsSubmitting(true);

    const supabase = createClient();
    const { data, error: rpcError } = await supabase.rpc("create_order", {
      p_lines: lines.map((line) => ({
        product_id: line.productId,
        date: line.date,
        qty: line.qty,
        // Absents pour toute ligne à date unique (comportement inchangé) — présents uniquement
        // pour une ligne par plage (chambre d'hôtel/alojamiento, spec 17 §0 Tranche 2).
        ...(line.endDate ? { end_date: line.endDate } : {}),
        ...(line.slotStartTime ? { slot_start_time: line.slotStartTime } : {}),
      })),
      p_holder_name: holderName.trim(),
      p_holder_email: holderEmail.trim(),
      p_holder_phone: holderPhone.trim(),
      p_marketing_consent: marketingConsent,
      // Aucun champ de saisie de code nulle part dans l'interface (cahier des charges client
      // §3c/§3h) : attributionCode vient uniquement du cookie ?ref= posé par proxy.ts, jamais
      // d'une entrée utilisateur. Source figée à "link" pour cette feature (la distinction "qr"
      // reviendra avec la feature 18, cf. plan).
      p_attribution_code: attributionCode || undefined,
      p_attribution_source: attributionCode ? "link" : undefined,
    });

    setIsSubmitting(false);

    const result = data as CreateOrderResult | null;
    if (rpcError || !result?.ok) {
      const reason = resolveKnownReason(KNOWN_REASONS, result?.reason);
      if (result?.line && (LINE_SCOPED_REASONS as readonly string[]).includes(reason)) {
        setFailedLineKey(`${result.line.product_id}-${result.line.date}`);
      }
      setError(t(`errors.${reason}`));
      return;
    }

    const orderId = result.order_id ?? "";

    // ⚠️ LOBBY D'ABORD — RÉORDONNÉ LE 2026-08-29, et ce n'est pas « un await de plus ».
    //
    // Séquence précédente : create_order (qui CONFIRME) → `void reserve-nights` → `void
    // startPayment`. Les deux `void` étaient délibérés et documentés (« un échec PMS ne défait
    // jamais une réservation déjà confirmée »), mais la prémisse était fausse : sur le compte réel,
    // deux catégories refusent `POST /bookings` en 422 TOUT EN affichant une disponibilité non
    // nulle (spec 24 §11.2, C1 réfuté — rien dans `available-rooms` ne distingue une catégorie
    // réservable). Le client payait donc son acompte, l'écran disait « réservé », et le partenaire
    // ne recevait rien — sans même une annulation à compenser, puisque rien n'avait été créé.
    //
    // Désormais : Lobby → confirmation visible → encaissement. C'est ce qu'exige la spec 21 §8
    // (« échec fermé uniquement AVANT confirmation »), que le code violait en silence. Le succès
    // n'est affiché QU'APRÈS l'accord de Lobby, et `startPayment` n'est jamais atteint sans lui.
    //
    // ⚠️ `setPendingOrderId` a été DÉPLACÉ après cet appel, et c'est le geste central : c'est lui
    // qui bascule l'écran sur « commande confirmée ». Le remonter au-dessus rendrait tout le reste
    // décoratif.
    let pmsResponse: Response;
    try {
      pmsResponse = await fetch("/api/pms/reserve-nights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId }),
      });
    } catch {
      // Réseau coupé pendant l'appel : on ne sait pas si Lobby a réservé. Échec fermé — rien n'est
      // encaissé, et expire_stale_payment_orders reprendra la commande dans les 30 minutes (avec,
      // au passage, l'annulation d'un booking qui aurait malgré tout été créé).
      setError(t("errors.pms_unreachable"));
      return;
    }

    if (!pmsResponse.ok) {
      const pmsResult = (await pmsResponse.json().catch(() => null)) as
        | { reason?: string; released?: boolean }
        | null;
      // La commande a été défaite côté serveur (places rendues, lignes annulées, bookings frères mis
      // en file d'annulation). Le panier est VOLONTAIREMENT conservé — `clear()` n'a pas encore été
      // appelé : le client peut changer de dates sans tout ressaisir, ce qui est le seul geste utile
      // face à une catégorie que Lobby refuse.
      setError(t(pmsResult?.released === false ? "errors.pms_refused_pending" : "errors.pms_refused"));
      return;
    }

    clear();
    setPendingOrderId(orderId);
    void startPayment(orderId);
  }

  if (pendingOrderId) {
    return (
      <div className="flex flex-col gap-3">
        <p role="status" data-testid="order-success" className="text-lg font-medium">
          {t("orderSuccess")} ({pendingOrderId})
        </p>
        {paymentError ? (
          <>
            <p role="alert" data-testid="payment-error" className="text-sm text-danger">
              {paymentError}
            </p>
            <Button
              type="button"
              onPress={() => startPayment(pendingOrderId)}
              isDisabled={isPaying}
              data-testid="retry-payment-button"
              className="w-fit"
            >
              {isPaying ? t("submitting") : t("retryPayment")}
            </Button>
          </>
        ) : (
          <p data-testid="payment-processing" className="text-sm text-muted">
            {t("paymentProcessing")}
          </p>
        )}
        {/* Feature 8 : lien discret vers /account/orders pour un client connecté — cohérence de
            parcours à coût nul, jamais montré à un invité (rien à lister sans session). */}
        {isAuthenticated ? (
          <Link
            href="/account/orders"
            data-testid="view-orders-link"
            className="text-sm text-muted hover:underline"
          >
            {t("viewOrdersLink")}
          </Link>
        ) : null}
      </div>
    );
  }

  if (lines.length === 0) {
    return (
      <p data-testid="empty-cart" className="text-sm text-muted">
        {t("emptyCart")}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <ul className="flex flex-col gap-3">
        {lines.map((line) => {
          const lineKey = `${line.productId}-${line.date}`;
          const isFailed = failedLineKey === lineKey;
          return (
            <li
              key={line.id}
              data-testid={`cart-line-${line.id}`}
              data-failed={isFailed}
              className={cn(
                "flex items-center justify-between gap-4 rounded-lg border p-3 text-sm",
                isFailed ? "border-danger bg-danger/10" : "border",
              )}
            >
              <div className="flex flex-col">
                <span className="font-medium">
                  {line.productName}
                </span>
                <span className="text-muted">
                  {line.establishmentName} ·{" "}
                  {line.endDate
                    ? `${line.date} → ${line.endDate}`
                    : line.slotStartTime
                      ? `${line.date} · ${line.slotStartTime}`
                      : line.date}{" "}
                  ·{" "}
                  {t("lineQty", { count: line.qty })}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <span className="font-medium">{formatCurrency(line.priceCop * line.qty)}</span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onPress={() => removeLine(line.id)}
                  data-testid={`remove-line-${line.id}`}
                >
                  {t("removeLine")}
                </Button>
              </div>
            </li>
          );
        })}
      </ul>

      <p className="text-lg font-medium" data-testid="cart-total">
        {t("total")}: {formatCurrency(total)}
      </p>

      <form onSubmit={handleSubmit} className="flex max-w-md flex-col gap-4">
        <TextField name="holder-name" value={holderName} onChange={setHolderName} isRequired>
          <Label>{t("holderName")}</Label>
          <Input />
        </TextField>
        <TextField name="holder-phone" value={holderPhone} onChange={setHolderPhone} isRequired>
          <Label>{t("holderPhone")}</Label>
          <Input type="tel" />
        </TextField>
        <TextField name="holder-email" value={holderEmail} onChange={setHolderEmail} isRequired>
          <Label>{t("holderEmail")}</Label>
          <Input type="email" />
        </TextField>

        <Checkbox
          data-testid="marketing-consent-checkbox"
          isSelected={marketingConsent}
          onChange={setMarketingConsent}
        >
          <Checkbox.Content>
            <Checkbox.Control>
              <Checkbox.Indicator />
            </Checkbox.Control>
            {t("marketingConsent")}
          </Checkbox.Content>
        </Checkbox>

        <p className="text-xs text-muted">{tCommon("cancellationPolicy")}</p>

        {error ? (
          <p role="alert" data-testid="checkout-error" className="text-sm text-danger">
            {error}
          </p>
        ) : null}

        <Button type="submit" isDisabled={isSubmitting} data-testid="submit-order-button">
          {isSubmitting ? t("submitting") : t("submit")}
        </Button>

        {/* Discret, jamais devant le formulaire : le compte n'apporte qu'un confort en plus,
            jamais une obligation (correctif réservation invité). */}
        {!isAuthenticated ? (
          <Link
            href="/login?next=/checkout"
            data-testid="login-link"
            className="text-center text-sm text-muted hover:underline"
          >
            {t("loginLink")}
          </Link>
        ) : null}
      </form>
    </div>
  );
}
