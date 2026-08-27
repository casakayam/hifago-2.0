import { getLobbyNightAvailability } from "./lobbyClient.ts";
import { parseLobbyNightAvailability } from "./parseLobbyNightAvailability.ts";

export interface NightAvailabilityRow {
  date: string;
  capacity: number;
  booked: number;
}

const CHUNK_SIZE = 6;

// Port de mapChunked (app legacy, src/services/portalService.js) : lots séquentiels, appels
// parallèles intra-lot — évite de saturer Lobby (rate-limit empirique déjà documenté v1) tout en
// restant raisonnablement rapide sur une fenêtre d'un mois (~28-31 nuits). Chaque nuit est
// indépendante : un échec isolé (réseau, catégorie absente de la réponse, forme inattendue) OMET
// cette nuit du résultat plutôt que d'abattre tout l'appel ou d'inventer une valeur —
// hasUnavailableNightInRange (apps/web/lib/products/reservationRange.ts) traite déjà toute nuit
// absente comme indisponible : c'est le comportement fail-closed voulu, gratuitement, sans dupliquer
// une règle "capacité=0" ailleurs.
export async function getNightAvailabilityWindow(
  baseUrl: string,
  apiToken: string,
  categoryId: number,
  nights: string[],
  relaySecret?: string
): Promise<NightAvailabilityRow[]> {
  const rows: NightAvailabilityRow[] = [];

  for (let i = 0; i < nights.length; i += CHUNK_SIZE) {
    const chunk = nights.slice(i, i + CHUNK_SIZE);
    const results = await Promise.all(
      chunk.map((date) => fetchOneNight(baseUrl, apiToken, categoryId, date, relaySecret))
    );
    for (const row of results) {
      if (row) rows.push(row);
    }
  }

  return rows;
}

async function fetchOneNight(
  baseUrl: string,
  apiToken: string,
  categoryId: number,
  date: string,
  relaySecret?: string
): Promise<NightAvailabilityRow | null> {
  try {
    const response = await getLobbyNightAvailability(baseUrl, apiToken, categoryId, date, addOneDay(date), relaySecret);
    if (response.status !== 200) return null;
    const parsed = parseLobbyNightAvailability(response.body, categoryId);
    if (!parsed) return null;
    return { date, capacity: parsed.available, booked: 0 };
  } catch {
    return null;
  }
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
