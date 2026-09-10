"use client";

import { useTranslations } from "next-intl";
import { toast } from "@hifago/ui";
import { useCart, type CartLine } from "./CartContext";

// 2026-09-10 (/simplify) : les trois formulaires de réservation dupliquaient le même bloc après
// addLine() — spec 31 (Tranche 1), ok:false ne signifie jamais "capacité refusée" (la barrière de
// capacité reste exclusivement create_order, appelée uniquement depuis /pago), seulement
// "l'identité n'a pas pu être établie". CartContext établit CETTE identité ; ce hook centralise ce
// qu'on en dit à l'utilisateur, pour que chaque formulaire n'ait plus à connaître ni `toast` ni la
// clé de traduction — seulement construire sa ligne et réagir à ok/échec.
export function useAddToCart() {
  const t = useTranslations("ProductPage");
  const { addLine } = useCart();

  return async (line: Omit<CartLine, "id">) => {
    const result = await addLine(line);
    if (!result.ok) {
      toast.danger(t("addToCartError"));
      return false;
    }
    return true;
  };
}
