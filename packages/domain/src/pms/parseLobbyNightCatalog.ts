import { asRecord } from "./parseHelpers.ts";

// Parseur de GET /api/v2/available-rooms sur le CHEMIN DE RÉSERVATION, dans sa forme « catalogue »
// (appel SANS `category_id`). Remplace l'usage que le calendrier faisait de
// parseLobbyNightAvailability, qui ne savait lire qu'UNE catégorie d'UNE nuit.
//
// ⚠️⚠️ LE PIÈGE QUE CE FICHIER EXISTE POUR FERMER. Le parseur précédent commençait par
// `Array.isArray(body.data) ? body.data[0] : body` — il ne lisait QUE le premier enregistrement, et
// l'appelant étiquetait la ligne obtenue avec la date qu'il avait DEMANDÉE. Tant qu'on demandait
// une seule nuit par appel, c'était juste. Le jour où l'on élargit `end_date` pour couvrir un mois
// en un appel, ce code ne casse RIEN DE VISIBLE : il lit `data[0]`, l'étiquette avec la date de
// début, et l'on écrit la disponibilité du 1er jour sur les 30 nuits du mois. Un calendrier
// d'apparence parfaitement normale, faux du 2e au 30e jour.
//
// D'où la règle, non négociable et vérifiée par test : **la date d'une ligne vient de la RÉPONSE,
// jamais de l'index ni de la requête.** Ce module ne connaît pas les dates demandées — il ne peut
// donc pas les recopier. Le rapprochement demandé ↔ obtenu est fait ailleurs, explicitement
// (alignLobbyCatalogEntries.ts), et échoue bruyamment quand il ne tombe pas juste.
//
// Une seule exception, étroite et matérialisée là-bas : une réponse à UNE nuit demandée qui ne
// porte aucune date. Il n'y a alors ni index ni ambiguïté possible, et c'est la forme sur laquelle
// la production tourne depuis toujours.
export interface LobbyCatalogEntry {
  /** yyyy-MM-dd TEL QUE LOBBY LE REND. `null` = la réponse ne porte pas de date. */
  date: string | null;
  /**
   * categoryId → nombre d'UNITÉS libres (chambres/tentes/lits-unités — jamais des cupos, la
   * conversion appartient à l'appelant). Une catégorie ABSENTE de cette map n'est pas cotée par
   * Lobby, ce qui est très différent d'une catégorie cotée à 0 (« complet », une réponse pleine et
   * entière).
   */
  availableByCategory: Map<number, number>;
}

export type LobbyNightCatalogResult =
  | { ok: true; entries: LobbyCatalogEntry[] }
  | { ok: false };

const ISO_DAY = /^\d{4}-\d{2}-\d{2}/;

// `date` est le champ OBSERVÉ le 2026-08-27 sur le compte Casa Kayam (forme mono-nuit). `start_date`
// est un repli DÉFENSIF, pas une observation : c'est le nom du paramètre de requête, que beaucoup
// d'API réémettent dans leur réponse. Il ne peut rien rendre silencieusement faux — au pire il ne
// trouve rien, et l'absence de date fait échouer l'alignement au lieu de fabriquer une valeur.
// On tolère un horodatage complet (`2026-12-23 00:00:00`) en n'en gardant que le jour.
function readEntryDate(record: Record<string, unknown>): string | null {
  for (const field of ["date", "start_date"] as const) {
    const raw = record[field];
    if (typeof raw === "string" && ISO_DAY.test(raw)) return raw.slice(0, 10);
  }
  return null;
}

function readCategories(record: Record<string, unknown>): Map<number, number> | null {
  const rawCategories = record.categories;
  if (!Array.isArray(rawCategories)) return null;

  const availableByCategory = new Map<number, number>();
  for (const entry of rawCategories) {
    const category = asRecord(entry);
    if (!category) continue;

    // `Number(null)` vaut 0 : sans ce garde, une entrée dont `category_id` est nul créerait une
    // catégorie FANTÔME numéro 0. Ce n'est pas théorique — `isPmsBacked` accepte
    // `lobby_category_id = 0` (il ne teste que `!= null`), donc un produit pourrait s'y raccrocher.
    if (category.category_id === null || category.category_id === undefined) continue;
    const categoryId = Number(category.category_id);
    if (!Number.isInteger(categoryId)) continue;

    // ⚠️ UNE DISPONIBILITÉ ILLISIBLE N'EST PAS UN ZÉRO — corrigé le 2026-08-28 après revue.
    // La première version reprenait le repli de l'ancien parseur : champ absent, `null` ou `""`
    // donnaient 0, c'est-à-dire « complet ». Une nuit devenait donc non réservable SANS un seul
    // log, exactement le silence que tout ce lot existe pour supprimer, et en contradiction avec la
    // règle du dossier (un échec de LECTURE n'est pas une disponibilité). La catégorie est
    // désormais laissée HORS de la map : elle est alors « non cotée », ce que pickCategoryNights
    // rapporte nommément.
    //
    // Tronqué, pas arrondi : Lobby compte des unités physiques. Un `2.5` hypothétique deviendrait
    // 2.5 cupos après multiplication par `cuposPerUnit` — une demi-place à vendre.
    const raw = category.available_rooms;
    // ⚠️ `Number("")` vaut 0, et `Number("  ")` aussi : sans ce filtre, une chaîne vide — la forme
    // la plus banale d'un champ « pas renseigné » — se lirait « complet ». Lobby renvoie parfois
    // ses nombres en chaîne, d'où la tolérance, mais elle s'arrête à une chaîne qui a du contenu.
    const isUsable =
      typeof raw === "number" || (typeof raw === "string" && raw.trim().length > 0);
    if (!isUsable) continue;
    const availableRooms = Number(raw);
    if (!Number.isFinite(availableRooms)) continue;
    const available = Math.max(0, Math.trunc(availableRooms));

    // Doublon de catégorie dans une même nuit : on garde le MINIMUM. On ne sait pas laquelle des
    // deux lignes fait foi, et la seule erreur qui coûte de l'argent est de sur-vendre.
    const known = availableByCategory.get(categoryId);
    availableByCategory.set(categoryId, known === undefined ? available : Math.min(known, available));
  }
  return availableByCategory;
}

/**
 * Deux formes de racine, exactement comme les autres parseurs du dossier : le corps lui-même
 * (forme mono-nuit RÉELLEMENT OBSERVÉE) ou un tableau `data[]` (forme tolérée par précaution,
 * jamais confirmée — c'est précisément ce que la sonde de plage doit trancher). La différence avec
 * le parseur précédent est qu'ici `data[]` est lu EN ENTIER, pas seulement `data[0]`.
 */
export function parseLobbyNightCatalog(body: unknown): LobbyNightCatalogResult {
  const outer = asRecord(body);
  if (!outer) return { ok: false };

  if (Array.isArray(outer.data)) {
    const entries: LobbyCatalogEntry[] = [];
    for (const element of outer.data) {
      const record = asRecord(element);
      if (!record) return { ok: false };
      const availableByCategory = readCategories(record);
      if (!availableByCategory) return { ok: false };
      entries.push({ date: readEntryDate(record), availableByCategory });
    }
    return { ok: true, entries };
  }

  const availableByCategory = readCategories(outer);
  if (!availableByCategory) return { ok: false };
  return { ok: true, entries: [{ date: readEntryDate(outer), availableByCategory }] };
}
