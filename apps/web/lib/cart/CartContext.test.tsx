import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { CartProvider, useCart, type AddToCartInput } from "./CartContext";

// Invariants 1/2 de la spec 31 (docs/specs/31-identite-anonyme.md) — le point précis qui a motivé
// ce test : signInAnonymously() n'est PAS idempotent (POST /signup inconditionnel), donc l'appeler
// sans vérifier d'abord qu'une session existe déjà déconnecterait un client réellement connecté au
// premier clic sur « Ajouter au panier ». Rien d'autre dans ce fichier ne le protégeait.
//
// Depuis spec 32 (panier en base) : `addLine` écrit réellement dans `cart_items` (RLS directe),
// plus un simple `setLines` local — le mock ci-dessous simule cette table en mémoire, dans l'ordre
// d'insertion (`refresh()` la relit après chaque ajout). `refresh()` rappelle lui-même
// `getSession()` (pour tout appelant qui n'a pas de session déjà en main) — `getSession` doit donc
// refléter la session posée par `signInAnonymously()`, comme le fait le vrai client Supabase (son
// cache de session interne), sans quoi le second appel verrait encore « aucune session » et
// `refresh()` viderait `lines` juste après que `addLine` les ait remplies.
let currentSession: { user: { id: string } } | null = null;
const getSession = vi.fn(() => Promise.resolve({ data: { session: currentSession } }));
const signInAnonymously = vi.fn();

type Row = {
  id: string;
  product_id: string;
  date: string;
  end_date: string | null;
  slot_start_time: string | null;
  qty: number;
};
let rows: Row[] = [];

vi.mock("@hifago/supabase/client", () => ({
  createClient: () => ({
    auth: { getSession, signInAnonymously },
    from: (table: string) => {
      if (table !== "cart_items") throw new Error(`table inattendue dans ce mock : ${table}`);
      return {
        insert: (row: { product_id: string; date: string; end_date: string | null; slot_start_time: string | null; qty: number }) => {
          rows.push({ id: `row-${rows.length + 1}`, ...row });
          return Promise.resolve({ error: null });
        },
        select: () => ({
          order: () => Promise.resolve({ data: rows, error: null }),
        }),
      };
    },
  }),
}));

const LIGNE: AddToCartInput = {
  productId: "p1",
  date: "2028-01-01",
  qty: 1,
};

function Sonde() {
  const { lines, addLine } = useCart();
  return (
    <div>
      <button onClick={() => addLine(LIGNE)}>ajouter</button>
      <span data-testid="count">{lines.length}</span>
    </div>
  );
}

describe("CartContext — invariants 1/2 (session anonyme au premier ajout)", () => {
  beforeEach(() => {
    getSession.mockClear();
    signInAnonymously.mockReset();
    currentSession = null;
    rows = [];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true } as Response));
  });

  it("invariant 2 : une session déjà active (connectée ou déjà anonyme) → signInAnonymously JAMAIS appelé", async () => {
    currentSession = { user: { id: "u1" } };
    render(
      <CartProvider>
        <Sonde />
      </CartProvider>,
    );
    fireEvent.click(screen.getByText("ajouter"));
    await screen.findByText("1");
    expect(signInAnonymously).not.toHaveBeenCalled();
  });

  it("invariant 1 : aucune session → signInAnonymously appelé une seule fois, la ligne rejoint le panier", async () => {
    signInAnonymously.mockImplementation(() => {
      currentSession = { user: { id: "u1" } };
      return Promise.resolve({ data: { session: currentSession }, error: null });
    });
    render(
      <CartProvider>
        <Sonde />
      </CartProvider>,
    );
    fireEvent.click(screen.getByText("ajouter"));
    await screen.findByText("1");
    expect(signInAnonymously).toHaveBeenCalledTimes(1);
  });

  it("échec fermé : signInAnonymously échoue → la ligne n'entre JAMAIS dans le panier (jamais de commande orpheline)", async () => {
    signInAnonymously.mockResolvedValue({ data: { session: null }, error: new Error("réseau indisponible") });
    render(
      <CartProvider>
        <Sonde />
      </CartProvider>,
    );
    fireEvent.click(screen.getByText("ajouter"));
    // Laisse la promesse se résoudre — aucune assertion positive à attendre ici, on vérifie
    // l'ABSENCE d'effet, donc pas de findBy possible : un délai court et déterministe suffit,
    // la résolution de la chaîne getSession → signInAnonymously ne dépend d'aucun timer réel.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.getByTestId("count").textContent).toBe("0");
  });
});
