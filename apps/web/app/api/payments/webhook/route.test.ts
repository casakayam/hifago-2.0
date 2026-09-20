// @vitest-environment node
import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// CE FICHIER EXISTE POUR UNE RAISON PRÉCISE (incident du 2026-09-20, piège 19).
//
// La vérification de signature du webhook était le SEUL maillon du chemin critique du paiement que
// rien n'avait jamais exercé : ni Vitest, ni Playwright, ni pgTAP, ni un parcours manuel réussi.
// Résultat : le webhook Mercado Pago n'a jamais confirmé un seul paiement réel depuis le début du
// projet, et il a fallu un vrai paiement en préprod pour s'en apercevoir. CLAUDE.md §11.20 — « une
// règle que rien ne vérifie n'est pas une règle, c'est un souhait ».
//
// Ce que ces tests prouvent, et que rien d'autre ne peut prouver :
//   1. le manifeste HMAC que NOUS validons est bien `id:<data.id>;request-id:<x-request-id>;ts:<ts>;`
//      — vérifié en fabriquant la signature nous-mêmes, sans dépendre de Mercado Pago ;
//   2. une signature falsifiée est refusée (401) ET laisse de quoi être rejouée hors ligne ;
//   3. une notification `merchant_order` est un no-op silencieux, sans entrée de réconciliation
//      (donc sans e-mail à tous les admins) — c'était 2 des 8 entrées parasites du 2026-09-20.
//
// ⚠️ Ce que ces tests NE prouvent PAS, et qu'aucun test local ne peut prouver : que le secret
// configuré dans l'environnement appartient à la même application/au même mode Mercado Pago que
// l'access token. C'était la vraie cause de l'incident — elle ne se voit qu'en livraison réelle.

const SECRET = "secret-de-test-jamais-un-vrai";
const DATA_ID = "179050364695";
const REQUEST_ID = "d7b8e9a0-1111-2222-3333-444455556666";
const EXTERNAL_REFERENCE = "00bd6fbb-c5a0-4001-943a-79676655a0c7";
const ORIGINAL_ENV = { ...process.env };

type Insert = Record<string, unknown>;
let inserts: Insert[] = [];
let rpcCalls: { name: string; args: Record<string, unknown> }[] = [];
let mpStatus = "approved";
let mpAmount: number | null = 3400;

vi.mock("@hifago/supabase/service", () => ({
  createServiceRoleClient: () => ({
    from: (table: string) => ({
      insert: async (row: Insert) => {
        inserts.push({ table, ...row });
        return { error: null };
      },
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: { id: EXTERNAL_REFERENCE, amount_cop: 3400 },
            error: null,
          }),
        }),
      }),
    }),
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      return { data: { ok: true }, error: null };
    },
  }),
}));

vi.mock("@/lib/mercadopago/client", () => ({
  getMercadoPagoPayment: async () => ({
    status: mpStatus,
    transaction_amount: mpAmount,
    external_reference: EXTERNAL_REFERENCE,
  }),
}));

const { POST } = await import("./route");

/** Reproduit à l'identique le manifeste documenté par Mercado Pago et implémenté par le SDK. */
function signer(params: { dataId?: string | null; requestId?: string | null; ts: string }) {
  const parts: string[] = [];
  if (params.dataId) parts.push(`id:${params.dataId}`);
  if (params.requestId) parts.push(`request-id:${params.requestId}`);
  parts.push(`ts:${params.ts}`);
  const manifest = parts.join(";") + ";";
  return crypto.createHmac("sha256", SECRET).update(manifest).digest("hex");
}

function requete(options: {
  type?: string;
  dataId?: string | null;
  signature?: string | null;
  requestId?: string | null;
  body?: unknown;
} = {}) {
  const type = options.type ?? "payment";
  const dataId = options.dataId === undefined ? DATA_ID : options.dataId;
  const query = new URLSearchParams();
  query.set("type", type);
  if (dataId) query.set("data.id", dataId);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (options.signature !== null) {
    const ts = "1789938000";
    headers["x-signature"] =
      options.signature ?? `ts=${ts},v1=${signer({ dataId, requestId: options.requestId ?? REQUEST_ID, ts })}`;
  }
  if (options.requestId !== null) headers["x-request-id"] = options.requestId ?? REQUEST_ID;
  return new Request(`https://hifago.test/api/payments/webhook?${query}`, {
    method: "POST",
    headers,
    body: JSON.stringify(options.body ?? { type, data: { id: dataId } }),
  });
}

describe("POST /api/payments/webhook", () => {
  beforeEach(() => {
    inserts = [];
    rpcCalls = [];
    mpStatus = "approved";
    mpAmount = 3400;
    process.env.MERCADOPAGO_WEBHOOK_SECRET = SECRET;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("accepte une livraison correctement signée et applique le paiement", async () => {
    const response = await POST(requete());

    expect(response.status).toBe(200);
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].name).toBe("apply_payment_webhook");
    expect(rpcCalls[0].args).toMatchObject({
      p_mp_payment_id: DATA_ID,
      p_external_reference: EXTERNAL_REFERENCE,
      p_status: "approved",
    });
    expect(inserts).toHaveLength(0);
  });

  it("refuse une signature falsifiée en 401 et conserve de quoi la rejouer", async () => {
    const response = await POST(requete({ signature: "ts=1789938000,v1=" + "0".repeat(64) }));

    expect(response.status).toBe(401);
    expect(rpcCalls).toHaveLength(0);
    expect(inserts).toHaveLength(1);
    expect(inserts[0].failure_reason).toBe("signature invalide (SignatureMismatch)");

    // Le matériel de rejeu — absent avant le 2026-09-20, ce qui avait rendu les 8 livraisons
    // réelles de l'incident invérifiables hors ligne.
    const rawEvent = inserts[0].raw_event as { body: unknown; delivery: Record<string, unknown> };
    expect(rawEvent.delivery.signature).toContain("v1=");
    expect(rawEvent.delivery.request_id).toBe(REQUEST_ID);
    expect(rawEvent.delivery.query).toContain(`data.id=${DATA_ID}`);
    expect(rawEvent.body).toMatchObject({ data: { id: DATA_ID } });
  });

  it("ignore silencieusement une notification merchant_order, sans entrée de réconciliation", async () => {
    // Régression du 2026-09-20 : ces notifications tombaient en 401 AVANT le tri par type, et
    // chaque entrée déclenchait un e-mail à tous les admins (trigger 20260824060000).
    const response = await POST(requete({ type: "merchant_order", signature: null }));

    expect(response.status).toBe(200);
    expect(inserts).toHaveLength(0);
    expect(rpcCalls).toHaveLength(0);
  });

  it("refuse tout quand le secret n'est pas configuré (échec fermé)", async () => {
    delete process.env.MERCADOPAGO_WEBHOOK_SECRET;

    const response = await POST(requete());

    expect(response.status).toBe(500);
    expect(rpcCalls).toHaveLength(0);
  });

  it("n'approuve jamais un paiement dont le montant diffère de amount_cop", async () => {
    mpAmount = 9999;

    const response = await POST(requete());

    expect(response.status).toBe(200);
    expect(rpcCalls).toHaveLength(0);
    expect(String(inserts[0].failure_reason)).toContain("≠ amount_cop attendu");
  });
});
