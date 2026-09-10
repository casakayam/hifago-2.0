import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { CartProvider, useCart, type CartLine } from "./CartContext";

// Invariants 1/2 de la spec 31 (docs/specs/31-identite-anonyme.md) — le point précis qui a motivé
// ce test : signInAnonymously() n'est PAS idempotent (POST /signup inconditionnel), donc l'appeler
// sans vérifier d'abord qu'une session existe déjà déconnecterait un client réellement connecté au
// premier clic sur « Ajouter au panier ». Rien d'autre dans ce fichier ne le protégeait.
const getSession = vi.fn();
const signInAnonymously = vi.fn();

vi.mock("@hifago/supabase/client", () => ({
  createClient: () => ({
    auth: { getSession, signInAnonymously },
  }),
}));

const LIGNE: Omit<CartLine, "id"> = {
  productId: "p1",
  productName: "Paseo en lancha",
  establishmentName: "Casa Kayam",
  date: "2028-01-01",
  qty: 1,
  priceCop: 80000,
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
    getSession.mockReset();
    signInAnonymously.mockReset();
  });

  it("invariant 2 : une session déjà active (connectée ou déjà anonyme) → signInAnonymously JAMAIS appelé", async () => {
    getSession.mockResolvedValue({ data: { session: { user: { id: "u1" } } } });
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
    getSession.mockResolvedValue({ data: { session: null } });
    signInAnonymously.mockResolvedValue({ data: {}, error: null });
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
    getSession.mockResolvedValue({ data: { session: null } });
    signInAnonymously.mockResolvedValue({ data: {}, error: new Error("réseau indisponible") });
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
