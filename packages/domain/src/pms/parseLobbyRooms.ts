// Parseur défensif de GET /api/v1/rooms — même discipline que parseLobbyNightAvailability.ts :
// la doc officielle de LobbyPMS s'est DÉJÀ révélée fausse une fois (la réponse de POST /bookings
// est {"booking":{...}} et jamais le {"data":[{"idBooking":…}]} imprimé), donc aucun champ n'est
// supposé présent, aucune exception n'est levée, et un champ absent est OMIS plutôt que fabriqué.
//
// Jusqu'ici la charge utile de /rooms était intégralement jetée par le Route Handler (seuls
// {id, name} en ressortaient) alors qu'elle porte déjà tout ce qu'il faut pour décrire une chambre :
// type, capacity, quantity, descriptions[] multilingues, photos[], et les chambres physiques.
// Ce module l'expose sans un seul appel réseau supplémentaire.

// Langues de CONTENU réellement éditables dans hifago (LocalizedTextField est fermé à es/en, et
// activeLang s'initialise à "es") — importer une clé hors de ce jeu produirait une valeur publiée
// par repli mais invisible et non supprimable dans l'éditeur. On les collecte donc à part plutôt
// que de les écrire (hifago/CLAUDE.md §5.1 : contenu partenaire multilingue, repli obligatoire).
const SUPPORTED_LANGS = ["es", "en"] as const;
export type SupportedLang = (typeof SUPPORTED_LANGS)[number];

// Le vocabulaire `type` de Lobby n'est documenté que pour "privada" ; aucune valeur dortoir n'a
// jamais été observée. On ne devine donc jamais : un type inconnu donne kind=null et rawType est
// conservé tel quel, pour que l'écran puisse l'afficher et qu'une sonde réelle puisse le relever.
export type LobbyRoomKind = "private" | "dorm";

export interface LobbyRoomPhoto {
  photoId: number | null;
  url: string;
}

export interface LobbyRoomCategory {
  categoryId: number;
  name: string;
  kind: LobbyRoomKind | null;
  rawType: string | null;
  capacity: number | null;
  quantity: number | null;
  /** Descriptions par langue, restreintes aux langues éditables dans hifago. */
  descriptions: Partial<Record<SupportedLang, string>>;
  /** Codes `lang` renvoyés par Lobby mais non éditables ici — jamais écrits, seulement signalés. */
  unsupportedLangs: string[];
  photos: LobbyRoomPhoto[];
  /** Numéros des chambres physiques de la catégorie (rooms[].name), à titre informatif. */
  roomLabels: string[];
}

export interface LobbyPageMeta {
  currentPage: number | null;
  totalPages: number | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asPositiveInt(value: unknown): number | null {
  const parsed = typeof value === "string" ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isFinite(parsed)) return null;
  const rounded = Math.trunc(parsed);
  return rounded > 0 ? rounded : null;
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

// "es-CO" / "ES" / " es " → "es". Un code non reconnu n'est jamais transformé en es par défaut :
// il part dans unsupportedLangs, sinon on écrirait un texte anglais dans le champ espagnol.
function normalizeLang(value: unknown): string | null {
  const raw = asNonEmptyString(value);
  if (!raw) return null;
  return raw.toLowerCase().slice(0, 2);
}

function isSupportedLang(lang: string): lang is SupportedLang {
  return (SUPPORTED_LANGS as readonly string[]).includes(lang);
}

export function normalizeLobbyRoomKind(rawType: unknown): LobbyRoomKind | null {
  const raw = asNonEmptyString(rawType);
  if (!raw) return null;
  const normalized = raw.toLowerCase();
  if (normalized.includes("privad") || normalized.includes("privat")) return "private";
  if (normalized.includes("dorm") || normalized.includes("compartid")) return "dorm";
  return null;
}

function parseDescriptions(value: unknown): {
  descriptions: Partial<Record<SupportedLang, string>>;
  unsupportedLangs: string[];
} {
  const descriptions: Partial<Record<SupportedLang, string>> = {};
  const unsupported = new Set<string>();
  if (!Array.isArray(value)) return { descriptions, unsupportedLangs: [] };

  for (const entry of value) {
    const row = asRecord(entry);
    if (!row) continue;
    const text = asNonEmptyString(row.description);
    if (!text) continue;
    const lang = normalizeLang(row.lang);
    // Une description sans `lang` : Lobby n'en documente qu'un exemple, en anglais. On la range en
    // espagnol (langue de contenu par défaut du projet) plutôt que de la perdre — mais uniquement
    // si l'espagnol est encore libre, pour ne jamais écraser une valeur explicitement taguée.
    const target = lang ?? "es";
    if (!isSupportedLang(target)) {
      unsupported.add(target);
      continue;
    }
    if (descriptions[target] === undefined) descriptions[target] = text;
  }

  return { descriptions, unsupportedLangs: [...unsupported].sort() };
}

function parsePhotos(value: unknown): LobbyRoomPhoto[] {
  if (!Array.isArray(value)) return [];
  const photos: LobbyRoomPhoto[] = [];
  for (const entry of value) {
    const row = asRecord(entry);
    if (!row) continue;
    const url = asNonEmptyString(row.url);
    if (!url) continue;
    photos.push({ photoId: asPositiveInt(row.photo_id), url });
  }
  return photos;
}

function parseRoomLabels(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const labels: string[] = [];
  for (const entry of value) {
    const row = asRecord(entry);
    if (!row) continue;
    const label = asNonEmptyString(row.name);
    if (label) labels.push(label);
  }
  return labels;
}

/**
 * Extrait les catégories de chambres d'une page de GET /api/v1/rooms.
 * Une entrée sans category_id numérique ou sans nom est ignorée (jamais une ligne à moitié vide
 * dans un sélecteur), tout le reste est facultatif.
 */
export function parseLobbyRooms(body: unknown): LobbyRoomCategory[] {
  const root = asRecord(body);
  if (!root || !Array.isArray(root.data)) return [];

  const categories: LobbyRoomCategory[] = [];
  for (const entry of root.data) {
    const row = asRecord(entry);
    if (!row) continue;
    const categoryId = asPositiveInt(row.category_id);
    const name = asNonEmptyString(row.name);
    if (categoryId === null || name === null) continue;

    const { descriptions, unsupportedLangs } = parseDescriptions(row.descriptions);
    categories.push({
      categoryId,
      name,
      kind: normalizeLobbyRoomKind(row.type),
      rawType: asNonEmptyString(row.type),
      capacity: asPositiveInt(row.capacity),
      quantity: asPositiveInt(row.quantity),
      descriptions,
      unsupportedLangs,
      photos: parsePhotos(row.photos),
      roomLabels: parseRoomLabels(row.rooms),
    });
  }
  return categories;
}

/**
 * Pagination : `meta.total_pages` permet d'arrêter la boucle dès la dernière page réelle, au lieu
 * de taper systématiquement jusqu'au plafond de sécurité (un appel de picker déclenchait jusqu'à
 * 20 requêtes chez Lobby, pour un compte qui n'a qu'une page).
 */
export function parseLobbyPageMeta(body: unknown): LobbyPageMeta {
  const root = asRecord(body);
  const meta = root ? asRecord(root.meta) : null;
  if (!meta) return { currentPage: null, totalPages: null };
  return {
    currentPage: asPositiveInt(meta.current_page),
    totalPages: asPositiveInt(meta.total_pages),
  };
}
