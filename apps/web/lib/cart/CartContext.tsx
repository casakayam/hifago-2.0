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
  date: string; // ISO yyyy-MM-dd
  qty: number;
  priceCop: number;
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
