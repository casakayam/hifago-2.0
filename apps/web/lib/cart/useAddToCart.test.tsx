import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { loadMessages } from "@/messages";
import { guardarUltimosCriterios } from "@/lib/catalog/ultimosCriterios";
import { useAddToCart } from "./useAddToCart";

// Aucune couverture n'existait avant ce lot (spec 28 Tranche 3, 2026-09-13) : ce hook ne posait
// jusqu'ici qu'un `toast.danger` sur échec, jamais testé. Il porte maintenant LE geste de retour
// (toast de succès + redirection vers l'accueil, critères conservés) — c'est le point unique par
// lequel passent les trois formulaires de réservation, donc le point unique à couvrir.

const state = vi.hoisted(() => ({
  addLineResult: { ok: true } as { ok: boolean },
  push: vi.fn(),
  toastSuccess: vi.fn(),
  toastDanger: vi.fn(),
}));

vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push: state.push }),
}));

vi.mock("@hifago/ui", () => ({
  toast: {
    success: state.toastSuccess,
    danger: state.toastDanger,
  },
}));

vi.mock("./CartContext", () => ({
  useCart: () => ({ addLine: () => Promise.resolve(state.addLineResult) }),
}));

const MESSAGES = loadMessages("es");

function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <NextIntlClientProvider locale="es" messages={MESSAGES}>
      {children}
    </NextIntlClientProvider>
  );
}

beforeEach(() => {
  sessionStorage.clear();
  state.addLineResult = { ok: true };
  state.push.mockClear();
  state.toastSuccess.mockClear();
  state.toastDanger.mockClear();
});

describe("useAddToCart — succès", () => {
  it("pose un toast de succès et redirige vers l'accueil avec le flag de réordonnancement", async () => {
    const { result } = renderHook(() => useAddToCart(), { wrapper });

    const ok = await result.current({ productId: "p1", date: "2026-10-05", qty: 1 });

    expect(ok).toBe(true);
    expect(state.toastSuccess).toHaveBeenCalledWith(MESSAGES.ProductPage.addedToCart);
    expect(state.toastDanger).not.toHaveBeenCalled();
    await waitFor(() => expect(state.push).toHaveBeenCalledWith("/?desdeCarrito=1"));
  });

  it("conserve les derniers critères mémorisés par BuscadorInicio dans le lien de retour", async () => {
    guardarUltimosCriterios("?q=kayak&personas=2");
    const { result } = renderHook(() => useAddToCart(), { wrapper });

    await result.current({ productId: "p1", date: "2026-10-05", qty: 1 });

    await waitFor(() =>
      expect(state.push).toHaveBeenCalledWith("/?q=kayak&personas=2&desdeCarrito=1")
    );
  });
});

describe("useAddToCart — échec", () => {
  it("pose un toast d'échec et ne redirige JAMAIS", async () => {
    state.addLineResult = { ok: false };
    const { result } = renderHook(() => useAddToCart(), { wrapper });

    const ok = await result.current({ productId: "p1", date: "2026-10-05", qty: 1 });

    expect(ok).toBe(false);
    expect(state.toastDanger).toHaveBeenCalledWith(MESSAGES.ProductPage.addToCartError);
    expect(state.toastSuccess).not.toHaveBeenCalled();
    expect(state.push).not.toHaveBeenCalled();
  });
});
