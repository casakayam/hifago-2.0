// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

// Spec 33 — CE FICHIER EXISTE POUR UNE RAISON PRÉCISE : la `back_url` envoyée à Mercado Pago est
// invisible partout ailleurs. Elle part dans la préférence, jamais dans l'`init_point` que le
// navigateur reçoit — donc aucun e2e ne peut la voir, et c'est exactement pour ça que le trou
// corrigé par la spec 33 a survécu : les trois back_urls ont pointé pendant des semaines sur un
// écran devenu vide, sans qu'une seule ligne de test ne regarde.
//
// Les deux invariants vérifiés ici sont ceux qu'un futur lot pourrait casser sans s'en apercevoir :
//   1. la back_url mène à `/reserva/<jeton>` — jamais à `/pago` ;
//   2. elle NE PORTE PAS de préfixe de locale — c'est le `/es` en dur qui faisait basculer toute la
//      session d'un anglophone en espagnol (via la réécriture du cookie NEXT_LOCALE par next-intl).

const PAYMENT_ID = "44444444-4444-4444-8444-444444444444";
const ORDER_ID = "55555555-5555-4555-8555-555555555555";
const ACCESS_TOKEN = "0123456789abcdef0123456789abcdef";

let preferenceInput: Record<string, unknown> | null = null;
let orderRow: { access_token: string } | null = { access_token: ACCESS_TOKEN };

// Le Route Handler lit `payments` AVEC l'embed PostgREST `orders(access_token)` — une seule
// requête, via la FK `payments.order_id → orders.id`. Le mock rend donc la commande imbriquée,
// exactement comme PostgREST le ferait ; `orderRow = null` simule l'embed vide.
vi.mock("@hifago/supabase/service", () => ({
  createServiceRoleClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: {
              id: PAYMENT_ID,
              order_id: ORDER_ID,
              amount_cop: 17000,
              payer_email: "cliente@test.local",
              status: "pending",
              orders: orderRow,
            },
            error: null,
          }),
        }),
      }),
    }),
  }),
}));

vi.mock("@/lib/mercadopago/client", () => ({
  createCheckoutPreference: async (input: Record<string, unknown>) => {
    preferenceInput = input;
    return { initPoint: "https://mercadopago.com/checkout/fake" };
  },
}));

const { POST } = await import("./route");

function requete(origin = "https://hifago.test") {
  return new Request(`${origin}/api/payments/create`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ paymentId: PAYMENT_ID }),
  });
}

describe("POST /api/payments/create — la back_url de retour", () => {
  beforeEach(() => {
    preferenceInput = null;
    orderRow = { access_token: ACCESS_TOKEN };
  });

  it("renvoie le client sur l'adresse propre à sa commande, jamais sur /pago", async () => {
    const response = await POST(requete());
    expect(response.status).toBe(200);
    expect(preferenceInput?.successUrl).toBe(`https://hifago.test/reserva/${ACCESS_TOKEN}`);
  });

  it("utilise la MÊME adresse pour les trois issues — succès, attente et échec", async () => {
    await POST(requete());
    const attendu = `https://hifago.test/reserva/${ACCESS_TOKEN}`;
    expect(preferenceInput?.successUrl).toBe(attendu);
    expect(preferenceInput?.pendingUrl).toBe(attendu);
    expect(preferenceInput?.failureUrl).toBe(attendu);
  });

  it("NE PRÉFIXE PAS la locale : c'est le /es en dur qui faisait basculer la session en espagnol", async () => {
    await POST(requete());
    expect(preferenceInput?.successUrl).not.toContain("/es/");
    expect(preferenceInput?.successUrl).not.toContain("/en/");
  });

  it("porte le jeton de la commande, jamais son identifiant technique", async () => {
    await POST(requete());
    // L'order_id est un secret aussi (create_payment_intent s'en sert comme capacité) : le laisser
    // fuiter dans une URL de retour donnerait la capacité de payer à qui lit l'historique.
    expect(preferenceInput?.successUrl).not.toContain(ORDER_ID);
  });

  it("échoue plutôt que de fabriquer une adresse de retour introuvable", async () => {
    orderRow = null;
    const response = await POST(requete());
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ ok: false, reason: "order_not_found" });
    expect(preferenceInput).toBeNull();
  });

  it("suit l'origine réelle derrière un reverse proxy, jamais l'adresse locale du serveur", async () => {
    const request = new Request("http://127.0.0.1:3000/api/payments/create", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-forwarded-host": "hifago.co",
        "x-forwarded-proto": "https",
      },
      body: JSON.stringify({ paymentId: PAYMENT_ID }),
    });
    await POST(request);
    expect(preferenceInput?.successUrl).toBe(`https://hifago.co/reserva/${ACCESS_TOKEN}`);
  });
});
