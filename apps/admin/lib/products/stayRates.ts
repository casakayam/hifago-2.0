// Extras de tarification d'un hébergement loué en entier (spec 12) — stocké dans
// products.stay_rates (jsonb), colonne dormante déjà présente en base depuis la toute première
// migration catalogue (copiée du schéma V1, cf. src/services/stayService.js), jamais branchée à
// un écran jusqu'ici. Les paliers de prix par nombre de personnes ne vivent PAS ici : ils
// réutilisent price_tiers/min_qty/max_qty (déjà construits pour l'activité, spec 08/11) plutôt que
// de dupliquer les `tiers` de stay_rates — seuls les champs sans équivalent hifago existant sont
// repris ici (saison, dépôt, inclusions, note), plus une majoration week-end qui n'existait pas en
// V1 (demande explicite de Jérôme, cf. spec 12 §1 — le seul levier temporel de la V1 était mensuel).
// Même convention que priceTiers.ts/slotRules.ts : type "brouillon" en strings pour les inputs
// contrôlés, validation retournant un message d'erreur ou null, conversion vers le JSON de colonne
// juste avant l'écriture.
export type DraftStayRates = {
  seasonMonths: number[]; // 1=enero..12=diciembre
  seasonSurchargePct: string; // pourcentage saisi (0-100), converti en fraction 0-1 à l'écriture
  seasonNote: string;
  weekendDays: number[]; // ISO 8601 : 1=lundi..7=dimanche
  weekendSurchargePct: string; // même traitement que seasonSurchargePct
  includes: string[];
  depositCop: string;
  extraNote: string;
};

type StayRatesColumn = {
  season: { months: number[]; surcharge_pct: number; note: string | null };
  weekend_days: number[];
  weekend_surcharge_pct: number;
  includes: string[];
  deposit_cop: number | null;
  extra_note: string | null;
};

const MAX_INCLUDES = 20;
const MAX_TEXT = 80;
const MAX_NOTE = 300;
const MAX_PRICE = 100_000_000;

// Ven+Sam présélectionnés — définition par défaut la plus courante pour un hébergement, ajustable
// par règle (pas de jour "correct" universel, cf. spec 12 §3).
export function emptyStayRates(): DraftStayRates {
  return {
    seasonMonths: [],
    seasonSurchargePct: "",
    seasonNote: "",
    weekendDays: [5, 6],
    weekendSurchargePct: "",
    includes: [],
    depositCop: "",
    extraNote: "",
  };
}

function isEmptyPct(value: string): boolean {
  return value.trim().length === 0;
}

// Retourne un message d'erreur (à afficher tel quel) si le brouillon est invalide, sinon null. Un
// brouillon entièrement vide est valide (toute la grille reste optionnelle) — même discipline que
// "0 tramo" ou "aucun horario" (spec 08 §8/spec 11).
export function validateStayRates(draft: DraftStayRates): string | null {
  if (!isEmptyPct(draft.seasonSurchargePct)) {
    const pct = Number(draft.seasonSurchargePct);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
      return "El recargo de temporada alta debe ser un porcentaje entre 0 y 100.";
    }
    if (draft.seasonMonths.length === 0) {
      return "Elige al menos un mes de temporada alta.";
    }
  }
  if (draft.seasonNote.trim().length > MAX_NOTE) {
    return `La nota de temporada supera los ${MAX_NOTE} caracteres.`;
  }

  if (!isEmptyPct(draft.weekendSurchargePct)) {
    const pct = Number(draft.weekendSurchargePct);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
      return "El recargo de fin de semana debe ser un porcentaje entre 0 y 100.";
    }
    if (draft.weekendDays.length === 0) {
      return "Elige al menos un día de fin de semana.";
    }
  }

  const includes = draft.includes.map((item) => item.trim()).filter(Boolean);
  if (includes.length > MAX_INCLUDES) {
    return `Máximo ${MAX_INCLUDES} servicios incluidos.`;
  }
  if (includes.some((item) => item.length > MAX_TEXT)) {
    return `Cada servicio incluido debe tener menos de ${MAX_TEXT} caracteres.`;
  }

  if (draft.depositCop.trim().length > 0) {
    const deposit = Number(draft.depositCop);
    if (!Number.isFinite(deposit) || deposit < 0 || deposit > MAX_PRICE) {
      return "El depósito no es válido.";
    }
  }

  if (draft.extraNote.trim().length > MAX_NOTE) {
    return `La nota adicional supera los ${MAX_NOTE} caracteres.`;
  }

  return null;
}

// null si le brouillon est entièrement vide — même convention que price_tiers/V1 stay_rates
// ("NULL = pas de grille"). weekendDays garde sa présélection par défaut même vide de sens tant
// qu'aucun recargo n'est saisi : ignoré ici pour ne pas déclencher un stockage non vide à tort.
export function toStayRatesColumn(draft: DraftStayRates): StayRatesColumn | null {
  const includes = draft.includes.map((item) => item.trim()).filter(Boolean);
  const isEmpty =
    draft.seasonMonths.length === 0 &&
    isEmptyPct(draft.seasonSurchargePct) &&
    draft.seasonNote.trim().length === 0 &&
    isEmptyPct(draft.weekendSurchargePct) &&
    includes.length === 0 &&
    draft.depositCop.trim().length === 0 &&
    draft.extraNote.trim().length === 0;
  if (isEmpty) return null;

  return {
    season: {
      months: [...draft.seasonMonths].sort((a, b) => a - b),
      surcharge_pct: isEmptyPct(draft.seasonSurchargePct) ? 0 : Number(draft.seasonSurchargePct) / 100,
      note: draft.seasonNote.trim() || null,
    },
    weekend_days: [...draft.weekendDays].sort((a, b) => a - b),
    weekend_surcharge_pct: isEmptyPct(draft.weekendSurchargePct)
      ? 0
      : Number(draft.weekendSurchargePct) / 100,
    includes,
    deposit_cop: draft.depositCop.trim() ? Math.round(Number(draft.depositCop)) : null,
    extra_note: draft.extraNote.trim() || null,
  };
}

// Lit la colonne (jsonb) sans jamais throw : une grille corrompue ou absente = brouillon vide,
// même philosophie que stayService.parseStayRates côté V1 ("grille illisible, ignorée").
export function stayRatesFromColumn(value: unknown): DraftStayRates {
  const base = emptyStayRates();
  if (!value || typeof value !== "object") return base;
  const raw = value as Partial<StayRatesColumn>;

  const seasonMonths = Array.isArray(raw.season?.months)
    ? raw.season!.months.filter((m): m is number => Number.isInteger(m) && m >= 1 && m <= 12)
    : [];
  const seasonSurchargePct =
    typeof raw.season?.surcharge_pct === "number" && raw.season.surcharge_pct > 0
      ? String(Math.round(raw.season.surcharge_pct * 100))
      : "";
  const weekendDays = Array.isArray(raw.weekend_days)
    ? raw.weekend_days.filter((d): d is number => Number.isInteger(d) && d >= 1 && d <= 7)
    : base.weekendDays;
  const weekendSurchargePct =
    typeof raw.weekend_surcharge_pct === "number" && raw.weekend_surcharge_pct > 0
      ? String(Math.round(raw.weekend_surcharge_pct * 100))
      : "";

  return {
    seasonMonths,
    seasonSurchargePct,
    seasonNote: raw.season?.note ?? "",
    weekendDays: weekendDays.length > 0 ? weekendDays : base.weekendDays,
    weekendSurchargePct,
    includes: Array.isArray(raw.includes) ? raw.includes.filter((i): i is string => typeof i === "string") : [],
    depositCop: typeof raw.deposit_cop === "number" ? String(raw.deposit_cop) : "",
    extraNote: raw.extra_note ?? "",
  };
}
