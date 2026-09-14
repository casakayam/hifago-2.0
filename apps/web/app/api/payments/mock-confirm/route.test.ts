// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const PAYMENT_ID = "44444444-4444-4444-8444-444444444444";
const RETURN_URL = "https://hifago.test/reserva/abcdef";
const ORIGINAL_ENV = { ...process.env };

let paymentRow: { id: string } | null = { id: PAYMENT_ID };
let rpcArgs: { name: string; args: Record<string, unknown> } | null = null;
let rpcResult: { data: unknown; error: unknown } = { data: { ok: true }, error: null };

vi.mock("@hifago/supabase/service", () => ({
  createServiceRoleClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: paymentRow, error: null }),
        }),
      }),
    }),
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcArgs = { name, args };
      return rpcResult;
    },
  }),
}));

const { POST } = await import("./route");

function requete(fields: Record<string, string>) {
  const body = new URLSearchParams(fields);
  return new Request("https://hifago.test/api/payments/mock-confirm", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
}

describe("POST /api/payments/mock-confirm", () => {
  beforeEach(() => {
    process.env.MERCADOPAGO_MOCK_MODE = "true";
    delete process.env.VERCEL_ENV;
    paymentRow = { id: PAYMENT_ID };
    rpcArgs = null;
    rpcResult = { data: { ok: true }, error: null };
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("404 si le mode mock n'est pas activé", async () => {
    delete process.env.MERCADOPAGO_MOCK_MODE;
    const response = await POST(
      requete({ paymentId: PAYMENT_ID, returnUrl: RETURN_URL, outcome: "approved" })
    );
    expect(response.status).toBe(404);
    expect(rpcArgs).toBeNull();
  });

  it("« Pagar » appelle apply_payment_webhook avec p_status=approved et redirige vers returnUrl", async () => {
    const response = await POST(
      requete({ paymentId: PAYMENT_ID, returnUrl: RETURN_URL, outcome: "approved" })
    );
    expect(rpcArgs?.name).toBe("apply_payment_webhook");
    expect(rpcArgs?.args).toMatchObject({
      p_external_reference: PAYMENT_ID,
      p_status: "approved",
    });
    expect(String(rpcArgs?.args.p_mp_payment_id)).toMatch(/^mock_/);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(RETURN_URL);
  });

  it("« Rechazar » appelle apply_payment_webhook avec p_status=rejected", async () => {
    await POST(requete({ paymentId: PAYMENT_ID, returnUrl: RETURN_URL, outcome: "rejected" }));
    expect(rpcArgs?.args).toMatchObject({ p_status: "rejected" });
  });

  it("rejette un returnUrl pointant vers une autre origine — anti open-redirect", async () => {
    const response = await POST(
      requete({ paymentId: PAYMENT_ID, returnUrl: "https://evil.example/x", outcome: "approved" })
    );
    expect(response.status).toBe(400);
    expect(rpcArgs).toBeNull();
  });

  it("404 si le paiement n'existe pas", async () => {
    paymentRow = null;
    const response = await POST(
      requete({ paymentId: PAYMENT_ID, returnUrl: RETURN_URL, outcome: "approved" })
    );
    expect(response.status).toBe(404);
    expect(rpcArgs).toBeNull();
  });

  it("400 si outcome n'est ni approved ni rejected", async () => {
    const response = await POST(
      requete({ paymentId: PAYMENT_ID, returnUrl: RETURN_URL, outcome: "n'importe quoi" })
    );
    expect(response.status).toBe(400);
    expect(rpcArgs).toBeNull();
  });
});
