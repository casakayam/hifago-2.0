"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

// État React en mémoire uniquement, JAMAIS persisté (cahier des charges client §3e : « perdu si
// l'onglet est fermé ») — pas de localStorage/sessionStorage, aucune sérialisation. Monté au
// niveau du layout apps/web/app/[locale] : survit à une navigation client entre deux fiches produit et
// vers /checkout, mais se réinitialise sur un rechargement complet de page (comportement voulu,
// pas un bug).
export type CartLine = {
  // Identifiant LOCAL à cette ligne, jamais product_id+date : deux lignes visant le même produit
  // et la même date sont explicitement autorisées (cahier des charges client A14) et doivent
  // rester deux entrées distinctes dans le panier, retirables indépendamment.
  id: string;
  productId: string;
  productName: string;
  establishmentName: string;
  date: string; // ISO yyyy-MM-dd — check-in si endDate est posé (chambre/alojamiento par plage)
  qty: number;
  // Spec 17 §0 Tranche 2 : pour une ligne par plage, priceCop est déjà le total de LA PLAGE ENTIÈRE
  // POUR UNE SEULE unité (nuits × prix nightly estimé) — jamais multiplié par les nuits une
  // deuxième fois. `qty` s'applique par-dessus exactement comme pour une ligne normale
  // (`priceCop * qty`, cf. total du panier/CheckoutForm) : aucune formule spéciale à ajouter pour
  // ce cas, le total réellement facturé reste de toute façon résolu par create_order.
  priceCop: number;
  roomTypeId?: string; // Chambre d'hôtel réservée par plage — absent pour tout le reste.
  roomTypeName?: string; // Affichage panier/checkout uniquement.
  endDate?: string; // ISO — présent seulement pour une ligne par plage (chambre ou alojamiento).
  slotStartTime?: string; // "HH:MM" — présent seulement pour une ligne à créneau horaire (spec 18 Tranche 1), toujours une chaîne opaque, jamais combinée à une Date JS.
};

type CartContextValue = {
  lines: CartLine[];
  addLine: (line: Omit<CartLine, "id">) => void;
  removeLine: (id: string) => void;
  clear: () => void;
};

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>([]);

  const value = useMemo<CartContextValue>(
    () => ({
      lines,
      addLine: (line) => {
        const id = crypto.randomUUID();
        setLines((prev) => [...prev, { ...line, id }]);
      },
      removeLine: (id) => setLines((prev) => prev.filter((existing) => existing.id !== id)),
      clear: () => setLines([]),
    }),
    [lines]
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const context = useContext(CartContext);
  if (!context) {
    throw new Error("useCart doit être utilisé sous CartProvider");
  }
  return context;
}
