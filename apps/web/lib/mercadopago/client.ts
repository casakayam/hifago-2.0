import { MercadoPagoConfig, Payment, Preference } from "mercadopago";

// Spec 19 §0 Tranche 1 — wrapper SDK Mercado Pago. Reste dans apps/web (jamais @hifago/domain, qui
// n'a aucune dépendance runtime aujourd'hui) : appelle un service externe avec un secret serveur,
// même patron que `sharp` dans apps/admin/app/api/upload/[entity]/route.ts (bibliothèque à effets
// de bord gardée dans l'app qui l'utilise, pas mutualisée dans un package partagé). Un seul compte
// marchand (Hifago) — aucun split natif, aucun OAuth établissement/référent ici (spec §1/§3).
let cachedConfig: MercadoPagoConfig | null = null;

function getConfig(): MercadoPagoConfig {
  if (!cachedConfig) {
    const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
    if (!accessToken) {
      throw new Error("MERCADOPAGO_ACCESS_TOKEN manquant — impossible d'appeler Mercado Pago.");
    }
    cachedConfig = new MercadoPagoConfig({ accessToken });
  }
  return cachedConfig;
}

export interface CreateCheckoutPreferenceInput {
  /** payments.id — sert à la fois d'external_reference ET de clé d'idempotence SDK. */
  paymentId: string;
  amountCop: number;
  payerEmail: string | null;
  successUrl: string;
  pendingUrl: string;
  failureUrl: string;
  notificationUrl: string;
}

export interface CheckoutPreferenceResult {
  initPoint: string;
}

// Checkout Pro par simple redirection (pas de bouton/brique intégrée) : aucun besoin du SDK client
// @mercadopago/sdk-js/sdk-react ni de NEXT_PUBLIC_MERCADOPAGO_PUBLIC_KEY — un lien/redirect vers
// init_point suffit entièrement. Simplification par rapport à l'intuition initiale de la spec
// (§0 Tranche 1, « SDK client pour Checkout Pro ») : la brique intégrée n'apporte rien ici, un seul
// compte marchand, pas de personnalisation de paiement in-page nécessaire pour ce périmètre.
export async function createCheckoutPreference(
  input: CreateCheckoutPreferenceInput
): Promise<CheckoutPreferenceResult> {
  const preference = new Preference(getConfig());
  const response = await preference.create({
    body: {
      items: [
        {
          id: input.paymentId,
          title: "Anticipo de reserva Hifago",
          quantity: 1,
          currency_id: "COP",
          unit_price: input.amountCop,
        },
      ],
      external_reference: input.paymentId,
      payer: input.payerEmail ? { email: input.payerEmail } : undefined,
      back_urls: {
        success: input.successUrl,
        pending: input.pendingUrl,
        failure: input.failureUrl,
      },
      auto_return: "approved",
      // ⚠️ DÉCISION JÉRÔME 2026-09-10 (spec 33 §3 décision ③) — les moyens de paiement HORS LIGNE
      // sont retirés du tunnel, et ce n'est pas une optimisation : c'était une impasse mesurée.
      // Mercado Pago rend `pending` pour un paiement en espèces (Efecty, Baloto), c'est-à-dire un
      // bon à régler en point de vente SOUS 1 À 3 JOURS. Or `expire_stale_payment_orders` annule
      // toute commande `pending` de plus de 30 MINUTES : le client repartait avec un bon inutile et
      // une réservation annulée avant même d'avoir pu payer, sans que rien ne le lui dise.
      //
      // Allonger la fenêtre d'expiration a été écarté d'emblée : immobiliser des places trois jours
      // aggraverait le « Trou (a) » du backlog (rien ne libère un cupo quand une commande expire),
      // lui-même en attente d'arbitrage. On ne construit pas sur un trou ouvert.
      //
      // Conséquence assumée : un client sans carte ni PSE ne peut plus réserver. `pending` reste
      // possible (revue anti-fraude), mais redevient rare et court — d'où le bandeau d'attente de
      // `OrderResult`, qui reste nécessaire.
      payment_methods: {
        excluded_payment_types: [{ id: "ticket" }, { id: "atm" }],
      },
      notification_url: input.notificationUrl,
    },
    // Idempotence liée à NOTRE paiement interne (pas une clé aléatoire par appel SDK) : un retry
    // réseau côté Route Handler sur le MÊME payment_id ne crée jamais deux préférences distinctes.
    requestOptions: { idempotencyKey: input.paymentId },
  });

  if (!response.init_point) {
    throw new Error("Mercado Pago n'a renvoyé aucun init_point pour cette préférence.");
  }
  return { initPoint: response.init_point };
}

// Re-confirmation serveur-à-serveur GET /v1/payments/{id} — jamais sur la seule foi du corps du
// webhook (spec §0 Tranche 1, pattern anti-race-condition recommandé par Mercado Pago).
export async function getMercadoPagoPayment(mpPaymentId: string) {
  const payment = new Payment(getConfig());
  return payment.get({ id: mpPaymentId });
}
