// Dérive un affichage (jamais une écriture) à partir du snapshot de commission déjà en base
// (order_lines, feature 11) et du statut courant de la ligne (feature 8). Contrairement à
// computeCommission (feature 11), PAS de miroir SQL : dériver un affichage n'exige rien de plus
// qu'une lecture, aucun risque d'atomicité à couvrir côté serveur — une seule implémentation
// suffit.
//
// Aucune colonne "payée" : le mécanisme de paiement n'existe pas dans ce backlog (cf. plan feature
// 12) — earned/redistributed s'affichent tous deux comme dus, jamais comme payés.
export type LedgerState = "estimated" | "earned" | "redistributed" | "voided";

export type LedgerEntry = {
  appDueCop: number;
  referrerDueCop: number;
  providerDueCop: number;
  state: LedgerState;
};

// Traité par analogie directe avec un no-show/annulation côté client (même cause : le prestataire
// a bloqué un créneau pour rien) — extrapolation assumée, le cahier des charges ne l'énumère pas
// explicitement (cf. plan feature 12).
const REDISTRIBUTED_STATUSES = new Set(["cancelled_by_client", "no_show", "expired"]);

export function deriveLedgerEntry(input: {
  commissionCase: string;
  totalCop: number;
  acompteCop: number;
  referrerCommissionCop: number;
  appCommissionCop: number;
  lineStatus: string;
}): LedgerEntry {
  const { totalCop, acompteCop, referrerCommissionCop, appCommissionCop, lineStatus } = input;
  // Ce que le prestataire garde de toute façon, hors commission — pas un champ du snapshot, une
  // conséquence structurelle de totalCop/acompteCop, valable identiquement en estimated et earned.
  const providerShareCop = totalCop - acompteCop;

  if (lineStatus === "cancelled_by_provider") {
    return { appDueCop: 0, referrerDueCop: 0, providerDueCop: 0, state: "voided" };
  }

  if (REDISTRIBUTED_STATUSES.has(lineStatus)) {
    return {
      appDueCop: appCommissionCop,
      referrerDueCop: 0,
      providerDueCop: providerShareCop + referrerCommissionCop,
      state: "redistributed",
    };
  }

  if (lineStatus === "fulfilled") {
    return {
      appDueCop: appCommissionCop,
      referrerDueCop: referrerCommissionCop,
      providerDueCop: providerShareCop,
      state: "earned",
    };
  }

  // 'reserved' : aperçu pas encore certain, mêmes montants structurels que 'fulfilled'.
  return {
    appDueCop: appCommissionCop,
    referrerDueCop: referrerCommissionCop,
    providerDueCop: providerShareCop,
    state: "estimated",
  };
}
