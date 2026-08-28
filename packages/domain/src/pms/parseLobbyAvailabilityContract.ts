// Parseur d'OBSERVATION de GET /api/v2/available-rooms — à ne pas confondre avec
// parseLobbyNightCatalog.ts, qui est sur le chemin de réservation et ne lit délibérément que
// `available_rooms`. Celui-ci ne sert QU'au job nocturne de contrôle de contrat : il décrit ce que
// Lobby renvoie, sans rien en déduire ni rien en consommer.
//
// Deux questions ouvertes depuis le début du chantier, et qui ne peuvent se trancher qu'ici :
//
//   C1 — quel attribut sépare une catégorie réservable par API (9631, 36572, 9629, 29376) d'une qui
//        refuse en 422 (17998, 49823, 18013, 51636) ? Hypothèse à vérifier : Lobby n'énumère dans
//        cette réponse QUE les catégories réservables. Si c'est vrai, la réponse EST le filtre, et
//        C1 devient implémentable sans jamais coder un identifiant en dur. Si c'est faux, la
//        comparaison des clés brutes entre les deux familles reste le seul angle — d'où `keys`.
//   C5 — les valeurs réelles de `restrictions{min_stay, max_stay, lead_days}`, jamais observées.
//        Conservées TELLES QUELLES, sans typage ni normalisation : on ne sait pas encore ce que
//        Lobby y met, et forcer une forme maintenant reviendrait à décider avant d'avoir vu.
//
// Même discipline défensive que le reste du dossier `pms/` : aucun champ supposé présent, aucune
// exception levée, une racine tolérée sous `data[0]` comme sous le corps lui-même.

import { asRecord } from "./parseHelpers.ts";

export interface LobbyAvailabilityCategoryObservation {
  categoryId: number;
  /** Clés brutes de l'entrée, triées. C'est le matériau de C1 : ce qui diffère entre deux familles. */
  keys: string[];
  availableRooms: number | null;
  /** `restrictions` tel quel, sans interprétation (C5). `null` si le champ est absent. */
  restrictions: Record<string, unknown> | null;
  planCount: number;
  /** Nombre total de prix, tous plans confondus — hifago n'en consomme aucun, c'est un constat. */
  priceCount: number;
}

export interface LobbyAvailabilityContract {
  /** `false` = corps inexploitable (ni `categories[]` ni `data[0].categories[]`). */
  ok: boolean;
  categoryIds: number[];
  categories: LobbyAvailabilityCategoryObservation[];
}

export function parseLobbyAvailabilityContract(body: unknown): LobbyAvailabilityContract {
  const empty: LobbyAvailabilityContract = { ok: false, categoryIds: [], categories: [] };

  const outer = asRecord(body);
  if (!outer) return empty;
  const dataArray = outer.data;
  const root = Array.isArray(dataArray) ? asRecord(dataArray[0]) : outer;
  if (!root) return empty;

  const rawCategories = root.categories;
  if (!Array.isArray(rawCategories)) return empty;

  const categories: LobbyAvailabilityCategoryObservation[] = [];
  for (const entry of rawCategories) {
    const record = asRecord(entry);
    if (!record) continue;
    const categoryId = Number(record.category_id);
    if (!Number.isFinite(categoryId)) continue;

    const availableRooms = Number(record.available_rooms);
    const plans = Array.isArray(record.plans) ? record.plans : [];

    categories.push({
      categoryId,
      keys: Object.keys(record).sort(),
      availableRooms: Number.isFinite(availableRooms) ? availableRooms : null,
      restrictions: asRecord(record.restrictions) ?? null,
      planCount: plans.length,
      priceCount: plans.reduce((total: number, plan: unknown) => {
        const prices = asRecord(plan)?.prices;
        return total + (Array.isArray(prices) ? prices.length : 0);
      }, 0),
    });
  }

  return { ok: true, categoryIds: categories.map((c) => c.categoryId), categories };
}
