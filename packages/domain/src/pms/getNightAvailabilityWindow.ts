import { getLobbyNightAvailability } from "./lobbyClient.ts";
import { parseLobbyNightAvailability } from "./parseLobbyNightAvailability.ts";
import { describeLobbyErrorBody } from "./describeLobbyErrorBody.ts";

export interface NightAvailabilityRow {
  date: string;
  capacity: number;
  booked: number;
}

// Pourquoi une cause TYPÉE plutôt qu'un `null`. Jusqu'au 2026-08-28, une nuit perdue l'était pour
// trois raisons très différentes — statut non-200 (429 de quota, 5xx, 403 du relais), catégorie
// absente de la réponse, exception réseau — toutes réduites au même `null`, sans un seul log. C'est
// ce qui a rendu la panne du 23 décembre indiagnosticable : l'écran ne savait pas distinguer
// « complet » de « je n'ai pas su », et personne ne pouvait savoir laquelle des trois s'était
// produite. `bodyExcerpt` ne contient que le corps de la RÉPONSE, jamais l'URL (CLAUDE.md §8).
export type PmsFailure =
  | { kind: "rate_limited"; status: number; retryAfterSeconds: number | null; limit: number | null; bodyExcerpt: string }
  | { kind: "rejected"; status: number; bodyExcerpt: string }
  | { kind: "unparseable"; status: number; bodyExcerpt: string }
  | { kind: "unreachable"; message: string };

// Une fenêtre est complète ou elle a échoué — il n'y a pas de demi-succès. Le seuil est UNE nuit
// manquante, jamais « toutes manquantes » : la panne mesurée le 2026-08-28 comprenait des mois
// PARTIELS (novembre à 29 nuits sur 30), qu'un déclencheur « zéro nuit » aurait laissé passer pour
// un succès. `requested`/`obtained` servent au diagnostic, pas à une décision de l'appelant.
export type PmsWindowResult =
  | { ok: true; nights: NightAvailabilityRow[] }
  | { ok: false; failure: PmsFailure; requested: number; obtained: number };

type NightResult = { ok: true; row: NightAvailabilityRow } | { ok: false; failure: PmsFailure };

const CHUNK_SIZE = 6;

// Port de mapChunked (app legacy, src/services/portalService.js) : lots séquentiels, appels
// parallèles intra-lot — évite de saturer Lobby tout en restant raisonnablement rapide.
//
// ARRÊT AU PREMIER ÉCHEC, et ce n'est pas qu'une optimisation. Le mode d'échec dominant est le
// quota (60 appels par fenêtre, mesuré) : une fois le mur atteint, les 25 appels suivants sont
// certains d'échouer et ne feraient que creuser le trou. Le legacy poursuivait et rendait un
// résultat partiel muet — c'est exactement ce qu'on retire.
export async function getNightAvailabilityWindow(
  baseUrl: string,
  apiToken: string,
  categoryId: number,
  nights: string[],
  relaySecret?: string
): Promise<PmsWindowResult> {
  const rows: NightAvailabilityRow[] = [];

  for (let i = 0; i < nights.length; i += CHUNK_SIZE) {
    const chunk = nights.slice(i, i + CHUNK_SIZE);
    const results = await Promise.all(
      chunk.map((date) => fetchOneNight(baseUrl, apiToken, categoryId, date, relaySecret))
    );

    // Le premier échec du lot fait foi : les autres nuits du même lot sont parties en parallèle,
    // leur sort n'apprend rien de plus sur la cause.
    const failed = results.find((result): result is { ok: false; failure: PmsFailure } => !result.ok);
    if (failed) {
      return { ok: false, failure: failed.failure, requested: nights.length, obtained: rows.length };
    }

    for (const result of results) {
      if (result.ok) rows.push(result.row);
    }
  }

  return { ok: true, nights: rows };
}

async function fetchOneNight(
  baseUrl: string,
  apiToken: string,
  categoryId: number,
  date: string,
  relaySecret?: string
): Promise<NightResult> {
  let response;
  try {
    response = await getLobbyNightAvailability(baseUrl, apiToken, categoryId, date, addOneDay(date), relaySecret);
  } catch (error) {
    return {
      ok: false,
      failure: { kind: "unreachable", message: error instanceof Error ? error.message : String(error) },
    };
  }

  // 429 est le cas qu'on veut nommer plutôt que subir : c'est le plafond de débit, il se rattrape
  // en attendant, contrairement à un 4xx de configuration. `Retry-After` et `X-RateLimit-Limit`
  // viennent de la réponse elle-même — Lobby dit lui-même sa limite, on cesse de la déduire.
  if (response.status === 429) {
    return {
      ok: false,
      failure: {
        kind: "rate_limited",
        status: response.status,
        retryAfterSeconds: response.rateLimit.retryAfterSeconds,
        limit: response.rateLimit.limit,
        bodyExcerpt: describeLobbyErrorBody(response.body),
      },
    };
  }

  if (response.status !== 200) {
    return {
      ok: false,
      failure: { kind: "rejected", status: response.status, bodyExcerpt: describeLobbyErrorBody(response.body) },
    };
  }

  const parsed = parseLobbyNightAvailability(response.body, categoryId);
  if (!parsed) {
    // 200 mais la catégorie n'est pas cotée. Distinct d'un `available_rooms: 0`, qui est une
    // réponse pleine et entière (« complet ») — le parseur ne rend null que si la catégorie est
    // ABSENTE du tableau.
    return {
      ok: false,
      failure: { kind: "unparseable", status: response.status, bodyExcerpt: describeLobbyErrorBody(response.body) },
    };
  }

  return { ok: true, row: { date, capacity: parsed.available, booked: 0 } };
}

function addOneDay(dateIso: string): string {
  const date = new Date(`${dateIso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

// Toutes les nuits ISO (yyyy-MM-dd) d'un mois (yyyy-MM), en excluant celles strictement avant
// notBeforeIso — jamais interroger Lobby sur des dates déjà passées (ex. mois courant partiellement
// écoulé).
export function nightsOfMonth(month: string, notBeforeIso?: string): string[] {
  const [yearStr, monthStr] = month.split("-");
  const year = Number(yearStr);
  const monthIndex = Number(monthStr) - 1;
  const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();

  const nights: string[] = [];
  for (let day = 1; day <= daysInMonth; day++) {
    const iso = `${yearStr}-${monthStr.padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    if (!notBeforeIso || iso >= notBeforeIso) nights.push(iso);
  }
  return nights;
}
