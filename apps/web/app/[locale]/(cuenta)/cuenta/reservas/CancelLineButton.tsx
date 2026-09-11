"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { createClient } from "@hifago/supabase/client";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/atoms/Button";

// Spec 34 décisions ⑤ et ⑧ — annuler UNE prestation, après une confirmation qui dit ce qu'elle coûte.
//
// ⚠️ POURQUOI UNE CONFIRMATION INLINE ET PAS UNE MODALE. Aucun `Modal` HeroUI n'est monté dans
// `apps/web` à ce jour ; en introduire un pour ce bouton ferait entrer un composant de coquille par
// la petite porte, sans que personne n'ait tranché son apparence. Le bloc remplace le bouton à sa
// place exacte : il est annoncé (`role="alert"`), il reçoit le focus, et il ne déplace rien d'autre.
//
// ⚠️ LA CONFIRMATION NE CHIFFRE AUCUN MONTANT (décision ⑧) : la chaîne `cancelConfirmNoRefund` ne
// porte pas de variable de prix, ce qui rend la règle impossible à contourner par distraction. Le
// cahier §2d voulait cette mention « sur l'écran de paiement, et pas ailleurs » — la spec 34 le
// révise, parce que c'est ici que le client perd de l'argent sans pouvoir défaire.
//
// ⚠️ L'`error` de supabase-js est LUE, contrairement à `OrdersList.tsx` qu'on remplace : une panne
// réseau et un refus métier ne disent pas la même chose, et les confondre a produit un écran qui
// répondait « impossible d'annuler » à un problème de connexion.

type CancelOrderLineResult = { ok: boolean; reason?: string; remaining_active_lines?: number };

export type CancelLineButtonProps = {
  lineId: string;
  /** Le nom du produit, DÉJÀ résolu dans la locale — un composant ne retraduit pas ce qu'il reçoit. */
  productName: string;
  /** La date (ou la plage, ou le créneau), déjà formatée par `formatLineSchedule`. */
  dateLabel: string;
  /**
   * Vrai quand c'est la DERNIÈRE prestation encore active de la commande : la confirmation prévient
   * alors que toute la réservation sera annulée. C'est la seule règle de ce composant qui ne se voit
   * pas à l'œil, donc la seule que son test tient.
   */
  isLastActiveLine: boolean;
  testId?: string;
};

export function CancelLineButton({
  lineId,
  productName,
  dateLabel,
  isLastActiveLine,
  testId,
}: CancelLineButtonProps) {
  const t = useTranslations("AccountOrdersPage");
  const router = useRouter();
  const [isConfirming, setIsConfirming] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [hasFailed, setHasFailed] = useState(false);
  const confirmRef = useRef<HTMLDivElement>(null);

  // Le bloc de confirmation prend la place du bouton : sans ce déplacement de focus, un utilisateur
  // au clavier resterait sur un bouton qui n'existe plus, et un lecteur d'écran annoncerait le
  // texte sans jamais atteindre les deux réponses.
  useEffect(() => {
    if (!isConfirming) return;
    confirmRef.current?.querySelector("button")?.focus();
  }, [isConfirming]);

  async function handleConfirm() {
    setIsPending(true);
    setHasFailed(false);

    const supabase = createClient();
    const { data, error } = await supabase.rpc("cancel_order_line", { p_line_id: lineId });
    const result = data as CancelOrderLineResult | null;

    if (error || !result?.ok) {
      setIsPending(false);
      setHasFailed(true);
      return;
    }

    // ⚠️ `router.refresh()` et non une mise à jour optimiste : l'écran relit `list_my_orders`, donc
    // la base. `OrdersList.tsx` recopiait la transition à la main, ce qui obligeait le client à
    // faire confiance à deux sources — et aurait menti si la RPC avait refusé pour une autre raison.
    // Le composant reste `isPending` jusqu'au rendu suivant : la carte est alors reconstruite.
    router.refresh();
    setIsConfirming(false);
    setIsPending(false);
  }

  if (!isConfirming) {
    return (
      <div className="flex flex-col gap-1">
        <Button
          variant="outline"
          color="danger"
          size="sm"
          onPress={() => setIsConfirming(true)}
          testId={testId}
        >
          {t("cancelLine")}
        </Button>
        {hasFailed ? (
          <p role="alert" className="text-xs text-danger" data-testid={testId ? `${testId}-error` : undefined}>
            {t("cancelError")}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div
      ref={confirmRef}
      role="alert"
      className="flex flex-col gap-2 rounded-lg border border-danger bg-danger/10 p-3 text-sm"
      data-testid={testId ? `${testId}-confirm` : undefined}
    >
      <p className="font-medium">{t("cancelConfirmTitle", { product: productName, date: dateLabel })}</p>
      <p className="text-muted">{t("cancelConfirmNoRefund")}</p>
      {isLastActiveLine ? (
        <p className="text-muted" data-testid={testId ? `${testId}-last-line` : undefined}>
          {t("cancelConfirmLastLine")}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          color="danger"
          size="sm"
          onPress={handleConfirm}
          isPending={isPending}
          pendingLabel={t("cancelling")}
          testId={testId ? `${testId}-yes` : undefined}
        >
          {t("cancelConfirmYes")}
        </Button>
        <Button
          variant="ghost"
          color="neutral"
          size="sm"
          onPress={() => setIsConfirming(false)}
          isDisabled={isPending}
          testId={testId ? `${testId}-no` : undefined}
        >
          {t("cancelConfirmNo")}
        </Button>
      </div>
    </div>
  );
}
