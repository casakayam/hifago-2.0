"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { createClient } from "@hifago/supabase/client";

// Spec 32 (panier en base) — réécrit le 2026-09-10 : les lignes ne vivent plus dans `useState`
// (perdues à tout rechargement, cf. l'ancien commentaire de tête) mais dans `cart_items`,
// rattachées à l'identité posée par la spec 31. `CartLine` perd `productName`/`establishmentName`/
// `priceCop` (décision ② — `cart_items` ne stocke que `product_id`, jamais dénormalisé) : ce
// contexte ne porte plus que la forme BRUTE de la ligne, celle dont `lib/reservas/disponibilidad.ts`
// et `reservationRange.ts` ont besoin pour marquer une date/un créneau déjà présent dans le panier
// en cours (jamais la vraie barrière, qui reste `create_order`). L'affichage RICHE d'une ligne
// (nom, établissement, prix) est désormais une jointure côté serveur (`lib/cart/getCartLines.ts`),
// consommée par `/carrito` et `/pago` — jamais recalculée ici.
export type CartLine = {
  id: string;
  productId: string;
  date: string;
  endDate?: string;
  slotStartTime?: string;
  qty: number;
};

export type AddToCartInput = Omit<CartLine, "id">;

type CartContextValue = {
  lines: CartLine[];
  // Async depuis spec 31 (invariant 1/2) : le premier ajout crée une session anonyme Supabase
  // avant que la ligne rejoigne le panier. `{ ok: false }` si la session n'a pas pu être établie —
  // JAMAIS une ligne ajoutée sans identité derrière (create_order refuse tout appel sans
  // auth.uid(), spec 31 Tranche 1) — ou si l'insertion elle-même échoue.
  addLine: (input: AddToCartInput) => Promise<{ ok: boolean }>;
  // Resynchronise `lines` depuis la base — après un retrait (CartSummary) ou une commande créée
  // (CheckoutForm, cart_items déjà vidée côté serveur par create_order à ce moment-là).
  refresh: () => Promise<void>;
};

const CartContext = createContext<CartContextValue | null>(null);

function toCartLine(row: {
  id: string;
  product_id: string;
  date: string;
  end_date: string | null;
  slot_start_time: string | null;
  qty: number;
}): CartLine {
  return {
    id: row.id,
    productId: row.product_id,
    date: row.date,
    endDate: row.end_date ?? undefined,
    slotStartTime: row.slot_start_time ?? undefined,
    qty: row.qty,
  };
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>([]);
  // Un seul client pour toute la durée de vie du provider (jamais un par appel) : chaque
  // createClient() ouvre son propre GoTrueClient (BroadcastChannel + listener), jamais fermé —
  // un par clic sur "Ajouter au panier" fuirait un client à chaque ajout.
  const supabase = useMemo(() => createClient(), []);

  // Volontairement séparée de `refresh` ci-dessous : `fetchLines` ne pose aucun état elle-même,
  // seulement `refresh` (exposée aux appelants externes) le fait. Un `useEffect` qui appellerait
  // directement une fonction posant l'état déclenche `react-hooks/set-state-in-effect` — cette
  // séparation est ce qui permet au montage de peupler `lines` sans jamais y référencer `refresh`.
  const fetchLines = useCallback(async (): Promise<CartLine[]> => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) return [];
    // RLS directe (cart_items_select, account_id = auth.uid()) : ne lit jamais que les lignes du
    // compte courant, sans filtre explicite à répéter ici.
    const { data } = await supabase
      .from("cart_items")
      .select("id, product_id, date, end_date, slot_start_time, qty")
      .order("created_at", { ascending: true });
    return (data ?? []).map(toCartLine);
  }, [supabase]);

  const refresh = useCallback(async () => {
    setLines(await fetchLines());
  }, [fetchLines]);

  useEffect(() => {
    fetchLines().then(setLines);
  }, [fetchLines]);

  const value = useMemo<CartContextValue>(
    () => ({
      lines,
      addLine: async (input) => {
        // Invariant 2 (spec 31) : vérifier AVANT tout qu'aucune session n'existe déjà —
        // signInAnonymously() n'est PAS idempotent (POST /signup inconditionnel + remplacement de
        // la session locale). Appelé sans cette garde, il créerait une identité à CHAQUE ajout et
        // déconnecterait un client réellement connecté dès son premier clic sur « Ajouter au
        // panier ». getSession() lit la session déjà posée (connectée ou déjà anonyme) sans
        // aller-retour réseau dans le cas courant.
        let {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session) {
          // Invariant 1 : c'est LE seul déclencheur du projet — jamais à la simple visite, jamais
          // sur un ?ref=. Échec fermé (cahier §0/CLAUDE.md §4.4) : si la session ne peut pas être
          // créée, la ligne n'entre PAS dans le panier.
          const { data, error } = await supabase.auth.signInAnonymously();
          if (error || !data.session) {
            return { ok: false };
          }
          session = data.session;
        }

        // Attribution (spec 32) : best-effort, ne bloque jamais l'ajout — le cookie hifago_ref est
        // httpOnly (illisible ici), seul un Route Handler peut le lire et poser carts.attribution_code.
        void fetch("/api/cart/attribution", { method: "POST" }).catch(() => {});

        const { error: insertError } = await supabase.from("cart_items").insert({
          account_id: session.user.id,
          product_id: input.productId,
          date: input.date,
          end_date: input.endDate ?? null,
          slot_start_time: input.slotStartTime ?? null,
          qty: input.qty,
        });
        if (insertError) {
          return { ok: false };
        }
        await refresh();
        return { ok: true };
      },
      refresh,
    }),
    [lines, supabase, refresh]
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
