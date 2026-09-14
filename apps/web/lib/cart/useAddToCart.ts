"use client";

import { startTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "@hifago/ui";
import { useRouter } from "@/i18n/navigation";
import { hrefRetornoCarrito } from "@/lib/catalog/criterios";
import { leerUltimosCriterios } from "@/lib/catalog/ultimosCriterios";
import { useCart, type AddToCartInput } from "./CartContext";

// 2026-09-10 (/simplify) : les trois formulaires de réservation dupliquaient le même bloc après
// addLine() — spec 31 (Tranche 1), ok:false ne signifie jamais "capacité refusée" (la barrière de
// capacité reste exclusivement create_order, appelée uniquement depuis /pago), seulement
// "l'identité n'a pas pu être établie" (ou, depuis spec 32, un échec d'écriture dans cart_items).
// CartContext établit cette identité ; ce hook centralise ce qu'on en dit à l'utilisateur, pour que
// chaque formulaire n'ait plus à connaître ni `toast` ni la clé de traduction — seulement
// construire sa ligne et réagir à ok/échec.
//
// Spec 28 Tranche 3 (2026-09-13) : sur succès, LE geste de retour se branche ICI, pas dans chaque
// formulaire — c'est justement pour ça qu'il a été extrait dans ce hook unique. Cahier §2b.5 :
// retour immédiat à l'accueil, critères conservés (mémorisés par `BuscadorInicio` dans
// `ultimosCriterios.ts`, la fiche produit ne les portant jamais elle-même — spec 28 §4), sections
// réordonnées selon le panier (`desdeCarrito=1`, lu par `page.tsx`). `startTransition` plutôt que
// `useTransition()` : rien ici n'affiche d'état `isPending`, il n'y a donc rien à exposer à
// l'appelant.
export function useAddToCart() {
  const t = useTranslations("ProductPage");
  const { addLine } = useCart();
  const router = useRouter();

  return async (line: AddToCartInput) => {
    const result = await addLine(line);
    if (!result.ok) {
      toast.danger(t("addToCartError"));
      return false;
    }
    toast.success(t("addedToCart"));
    const criterios = leerUltimosCriterios();
    startTransition(() => {
      router.push(hrefRetornoCarrito(criterios));
    });
    return true;
  };
}
