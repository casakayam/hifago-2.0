// Parseur défensif de GET /api/v1/products — les « services » d'un compte Lobby (activités,
// transports, extras facturables sur un booking). Même discipline que parseLobbyRooms.ts.
//
// Rappel de cadrage, pour que personne ne rebranche le prix par erreur : `value` est le prix
// configuré CHEZ LOBBY, exposé ici à titre purement indicatif. hifago reste la source du prix
// (règle actée, cf. buildEvenRatesPerDay.ts et parseLobbyNightCatalog.ts) — au mieux ce
// chiffre sert de valeur suggérée au moment d'établir le lien, jamais de prix de vente.
//
// Le champ identifiant est `service_id` côté Lobby ; c'est le même entier que `id_producto` dans
// ingresos[] et que `product_id` de POST /booking/add-product-service — mappé vers ce que hifago
// nomme lobby_product_id. Aucune photo, aucune description, aucune catégorie, aucun horaire n'est
// exposé par cet endpoint : un service Lobby est un couple identifiant/prix, rien de plus.
// Confirmé en conditions réelles le 2026-08-26 (14 services du compte Casa Kayam, spec 24 §11.3) —
// c'est la raison pour laquelle lier une ACTIVITÉ à un service ne peut rien rapatrier d'autre.

import { asNonEmptyString, asPositiveInt, asRecord } from "./parseHelpers.ts";

export interface LobbyService {
  serviceId: number;
  name: string;
  /** Prix Lobby (`value`, chaîne décimale), indicatif seulement. */
  valueCop: number | null;
  /** `infinite_inventory` à 1 → stock illimité. null si Lobby ne le renseigne pas. */
  infiniteInventory: boolean | null;
  /**
   * Stock restant. null si illimité, non renseigné — ou ÉPUISÉ : `asPositiveInt` ramène 0 à null,
   * si bien qu'un service à stock 0 n'est pas distingué d'un service sans stock. Sans conséquence
   * aujourd'hui (les 14 services réels sont tous `infinite_inventory`), et l'écran n'affiche de
   * toute façon « Stock: n » que si `infiniteInventory` est faux. À revoir le jour où un compte
   * utilisera un stock fini.
   */
  stock: number | null;
}

// "120000.00" → 120000. Un montant nul ou négatif est traité comme absent : un service à 0 n'a
// aucun sens comme valeur suggérée, et laisser passer un négatif polluerait l'écran.
function asMoney(value: unknown): number | null {
  const parsed = typeof value === "string" ? Number(value.trim()) : value;
  if (typeof parsed !== "number" || !Number.isFinite(parsed)) return null;
  const rounded = Math.round(parsed);
  return rounded > 0 ? rounded : null;
}

// Lobby renvoie 0/1 (parfois en chaîne). Tout le reste → null, jamais un false par défaut qui
// ferait afficher « stock limité » à tort.
function asFlag(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  const parsed = typeof value === "string" ? Number(value.trim()) : value;
  if (typeof parsed !== "number" || !Number.isFinite(parsed)) return null;
  return parsed !== 0;
}

export function parseLobbyServices(body: unknown): LobbyService[] {
  const root = asRecord(body);
  if (!root || !Array.isArray(root.data)) return [];

  const services: LobbyService[] = [];
  for (const entry of root.data) {
    const row = asRecord(entry);
    if (!row) continue;
    const serviceId = asPositiveInt(row.service_id);
    const name = asNonEmptyString(row.name);
    if (serviceId === null || name === null) continue;

    services.push({
      serviceId,
      name,
      valueCop: asMoney(row.value),
      infiniteInventory: asFlag(row.infinite_inventory),
      // La garde `stockRaw === null || undefined` qui entourait ceci était redondante :
      // asPositiveInt renvoie déjà null pour l'un comme pour l'autre (/simplify 2026-08-26).
      stock: asPositiveInt(row.stock),
    });
  }
  return services;
}
