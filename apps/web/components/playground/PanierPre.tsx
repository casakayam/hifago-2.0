"use client";

import { useEffect } from "react";
import { useCart, type CartLine } from "@/lib/cart/CartContext";

// Remplit le panier au montage, pour une story qui a besoin d'une pastille non vide.
//
// ⚠️ Recopié à l'octet près dans `SiteHeader.stories.tsx` puis `SiteToaster.stories.tsx`, par deux
// agents différents (2026-09-02 et 2026-09-03) — et la copie avait déjà perdu la seule chose qui
// comptait, la note sur `qty` ci-dessous. Même motif que `Legende.tsx` et `contraste.ts` : ce qui
// est recopié diverge, et ce qui diverge ment.
//
// ⚠️ Il vit dans `playground/` et PAS dans un fichier de stories : en CSF3, tout export nommé d'un
// `.stories.tsx` est lu par Storybook comme une story, donc un helper exporté de là apparaîtrait
// dans la barre latérale comme un composant vide.

/** `CartProvider` n'accepte pas d'état initial — on le remplit donc au montage. */
export function PanierPre({ lignes }: { lignes: number }) {
  const { lines, addLine } = useCart();
  useEffect(() => {
    if (lines.length > 0 || lignes === 0) return;
    for (let i = 0; i < lignes; i += 1) {
      addLine({
        productId: `p-${i}`,
        productName: "Paseo en lancha",
        establishmentName: "Casa Kayam",
        date: "2026-09-14",
        // ⚠️ 3 personnes sur UNE ligne : la pastille doit afficher le nombre de LIGNES, pas 3×N.
        // C'est le seul endroit du playground qui distingue les deux, d'où la valeur 3 plutôt que 1.
        qty: 3,
        priceCop: 80000,
      } satisfies Omit<CartLine, "id">);
    }
  }, [lines.length, lignes, addLine]);
  return null;
}
