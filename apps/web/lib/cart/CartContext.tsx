"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { createClient } from "@hifago/supabase/client";

// Les LIGNES du panier restent en mémoire React uniquement — pas de localStorage/sessionStorage,
// aucune sérialisation, réinitialisées sur un rechargement complet de page (comportement voulu,
// pas un bug). ⚠️ Le commentaire d'origine citait ici le cahier §3e (« perdu si l'onglet est
// fermé ») comme justification durable : ce n'est plus le cas depuis sa réécriture, VALIDÉE par
// Jérôme le 2026-09-07 (cf. docs/journal/2026-09.md) — le panier persistant est désormais la
// cible, portée par une spec séparée («panier en base», à écrire). Ce fichier n'anticipe QUE ce
// que spec 31 exige : depuis ce lot, addLine établit une IDENTITÉ durable (session anonyme
// Supabase, cf. plus bas) même si les LIGNES elles-mêmes restent encore volatiles en attendant
// cette spec suivante — l'identité est donc, dès maintenant, plus durable que le panier qu'elle
// porte, pas l'inverse.
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
  endDate?: string; // ISO — présent seulement pour une ligne par plage (alojamiento).
  slotStartTime?: string; // "HH:MM" — présent seulement pour une ligne à créneau horaire (spec 18 Tranche 1), toujours une chaîne opaque, jamais combinée à une Date JS.
};

type CartContextValue = {
  lines: CartLine[];
  // Async depuis spec 31 (invariant 1/2) : le premier ajout crée une session anonyme Supabase
  // avant que la ligne rejoigne l'état. `{ ok: false }` si la session n'a pas pu être établie —
  // JAMAIS une ligne ajoutée sans identité derrière, qui produirait plus tard une commande
  // orpheline (create_order refuse désormais tout appel sans auth.uid(), spec 31 Tranche 1).
  addLine: (line: Omit<CartLine, "id">) => Promise<{ ok: boolean }>;
  removeLine: (id: string) => void;
  clear: () => void;
};

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>([]);
  // Un seul client pour toute la durée de vie du provider (jamais un par appel à addLine) : chaque
  // createClient() ouvre son propre GoTrueClient (BroadcastChannel + listener), jamais fermé —
  // un par clic sur "Ajouter au panier" fuirait un client à chaque ajout.
  const supabase = useMemo(() => createClient(), []);

  const value = useMemo<CartContextValue>(
    () => ({
      lines,
      addLine: async (line) => {
        // Invariant 2 (spec 31) : vérifier AVANT tout qu'aucune session n'existe déjà —
        // signInAnonymously() n'est PAS idempotent (POST /signup inconditionnel + remplacement de
        // la session locale). Appelé sans cette garde, il créerait une identité à CHAQUE ajout et
        // déconnecterait un client réellement connecté dès son premier clic sur « Ajouter au
        // panier ». getSession() lit la session déjà posée (connectée ou déjà anonyme) sans
        // aller-retour réseau dans le cas courant.
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session) {
          // Invariant 1 : c'est LE seul déclencheur du projet — jamais à la simple visite, jamais
          // sur un ?ref=. Échec fermé (cahier §0/CLAUDE.md §4.4) : si la session ne peut pas être
          // créée, la ligne n'entre PAS dans le panier — un panier sans identité derrière
          // produirait une commande orpheline que create_order refuse désormais (Tranche 1).
          const { error } = await supabase.auth.signInAnonymously();
          if (error) {
            return { ok: false };
          }
        }
        const id = crypto.randomUUID();
        setLines((prev) => [...prev, { ...line, id }]);
        return { ok: true };
      },
      removeLine: (id) => setLines((prev) => prev.filter((existing) => existing.id !== id)),
      clear: () => setLines([]),
    }),
    [lines, supabase]
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
