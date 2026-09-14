// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const PAYMENT_ID = "44444444-4444-4444-8444-444444444444";
const RETURN_URL = "https://hifago.test/reserva/abcdef";
const ORIGINAL_ENV = { ...process.env };

let paymentRow: { amount_cop: number; status: string } | null = {
  amount_cop: 17000,
  status: "pending",
};

vi.mock("@hifago/supabase/service", () => ({
  createServiceRoleClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: paymentRow, error: null }),
        }),
      }),
    }),
  }),
}));

const { GET } = await import("./route");

function requete(overrides: Record<string, string> = {}) {
  const params = { paymentId: PAYMENT_ID, returnUrl: RETURN_URL, ...overrides };
  const url = new URL("https://hifago.test/api/payments/mock-checkout");
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, value);
  }
  return new Request(url.toString());
}

describe("GET /api/payments/mock-checkout", () => {
  beforeEach(() => {
    process.env.MERCADOPAGO_MOCK_MODE = "true";
    delete process.env.VERCEL_ENV;
    paymentRow = { amount_cop: 17000, status: "pending" };
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("404 si le mode mock n'est pas activé", async () => {
    delete process.env.MERCADOPAGO_MOCK_MODE;
    const response = await GET(requete());
    expect(response.status).toBe(404);
  });

  it("404 même flag posé, sur un déploiement de production déclarée", async () => {
    process.env.VERCEL_ENV = "production";
    const response = await GET(requete());
    expect(response.status).toBe(404);
  });

  it("400 si paymentId ou returnUrl manque", async () => {
    const response = await GET(requete({ returnUrl: "" }));
    expect(response.status).toBe(400);
  });

  it("404 si le paiement n'existe pas", async () => {
    paymentRow = null;
    const response = await GET(requete());
    expect(response.status).toBe(404);
  });

  it("affiche le montant relu en base, jamais un montant fabriqué depuis la query string", async () => {
    const response = await GET(requete());
    expect(response.status).toBe(200);
    const html = await response.text();
    const expectedAmount = new Intl.NumberFormat("es-CO", {
      style: "currency",
      currency: "COP",
      maximumFractionDigits: 0,
    }).format(17000);
    expect(html).toContain(expectedAmount);
  });

  it("porte le bandeau explicite de simulateur", async () => {
    const response = await GET(requete());
    const html = await response.text();
    expect(html).toContain("SIMULADOR DE PAGO");
  });
});
