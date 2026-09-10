"use client";

import { useEffect } from "react";
import { useCart, type AddToCartInput } from "@/lib/cart/CartContext";

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
//
// ⚠️ Depuis spec 32 (panier en base, 2026-09-10) : addLine écrit RÉELLEMENT dans `cart_items`
// (Supabase, RLS directe) — plus un simple état React local. En Storybook (aucun mock de
// `@hifago/supabase/client` ici, contrairement à `SiteHeader.test.tsx`), ce composant appelle donc
// la vraie stack Supabase locale (`/hifago-dev`) : la pastille se remplit pour de vrai si elle
// tourne, reste vide sinon (échec réseau silencieux, cf. `addLine`) — jamais une erreur affichée.

/** `CartProvider` n'accepte pas d'état initial — on le remplit donc au montage. */
export function PanierPre({ lignes }: { lignes: number }) {
  const { lines, addLine } = useCart();
  useEffect(() => {
    if (lines.length > 0 || lignes === 0) return;
    for (let i = 0; i < lignes; i += 1) {
      addLine({
        productId: `p-${i}`,
        date: "2026-09-14",
        // ⚠️ 3 personnes sur UNE ligne : la pastille doit afficher le nombre de LIGNES, pas 3×N.
        // C'est le seul endroit du playground qui distingue les deux, d'où la valeur 3 plutôt que 1.
        qty: 3,
      } satisfies AddToCartInput);
    }
  }, [lines.length, lignes, addLine]);
  return null;
}
