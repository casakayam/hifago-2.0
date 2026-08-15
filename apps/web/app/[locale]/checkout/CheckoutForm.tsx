"use client";

import { useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { Link } from "@/i18n/navigation";
import { createClient } from "@hifago/supabase/client";
import { useCart } from "@/lib/cart/CartContext";
import { Button, Checkbox, Input, Label, TextField, cn } from "@hifago/ui";
import { formatCop } from "@hifago/domain";

const LINE_SCOPED_REASONS = [
  "product_not_found",
  "not_sellable",
  "date_closed",
  "slot_not_found",
  "full",
  "resource_unavailable",
] as const;

// Toutes les raisons mappées côté écran — une raison inattendue (jamais censée arriver, mais la
// RPC reste la seule autorité) retombe sur "unknown" plutôt que de faire échouer next-intl sur
// une clé manquante. not_authenticated n'apparaît plus ici : le correctif réservation invité a
// retiré ce garde-fou de create_order, la RPC ne renvoie plus jamais cette raison.
// resource_unavailable (feature 20) : la ressource partagée d'un camp est insuffisante sur au
// moins un jour de la plage — même geste que 'full', un refus clair plutôt qu'un "unknown" générique.
const KNOWN_REASONS = [
  "empty_cart",
  "product_not_found",
  "not_sellable",
  "date_closed",
  "slot_not_found",
  "full",
  "resource_unavailable",
  "lodging_cap_exceeded",
  "prestation_cap_exceeded",
  "qty_cap_exceeded",
] as const;

type CreateOrderResult = {
  ok: boolean;
  reason?: string;
  order_id?: string;
  line?: { product_id?: string; date?: string; qty?: number };
};

export function CheckoutForm({
  isAuthenticated,
  attributionCode,
}: {
  isAuthenticated: boolean;
  attributionCode?: string;
}) {
  const t = useTranslations("CheckoutPage");
  const tCommon = useTranslations("Common");
  const locale = useLocale();
  const { lines, removeLine, clear } = useCart();

  const [holderName, setHolderName] = useState("");
  const [holderPhone, setHolderPhone] = useState("");
  const [holderEmail, setHolderEmail] = useState("");
  const [marketingConsent, setMarketingConsent] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [failedLineKey, setFailedLineKey] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [success, setSuccess] = useState<{ orderId: string } | null>(null);

  const formatCurrency = (value: number) => formatCop(value, locale);

  const total = lines.reduce((sum, line) => sum + line.priceCop * line.qty, 0);

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
      })),
      p_holder_name: holderName.trim(),
      p_holder_email: holderEmail.trim() || undefined,
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
      const rawReason = result?.reason ?? "unknown";
      const reason = (KNOWN_REASONS as readonly string[]).includes(rawReason)
        ? rawReason
        : "unknown";
      if (
        result?.line &&
        (LINE_SCOPED_REASONS as readonly string[]).includes(reason)
      ) {
        setFailedLineKey(`${result.line.product_id}-${result.line.date}`);
      }
      setError(t(`errors.${reason}`));
      return;
    }

    clear();
    setSuccess({ orderId: result.order_id ?? "" });
  }

  if (success) {
    return (
      <div className="flex flex-col gap-2">
        <p role="status" data-testid="order-success" className="text-lg font-medium">
          {t("orderSuccess")} ({success.orderId})
        </p>
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
                <span className="font-medium">{line.productName}</span>
                <span className="text-muted">
                  {line.establishmentName} · {line.date} · {t("lineQty", { count: line.qty })}
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
        <TextField name="holder-email" value={holderEmail} onChange={setHolderEmail}>
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
