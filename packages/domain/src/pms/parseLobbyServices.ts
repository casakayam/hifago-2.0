// Parseur défensif de GET /api/v1/products — les « services » d'un compte Lobby (activités,
// transports, extras facturables sur un booking). Même discipline que parseLobbyRooms.ts.
//
// Rappel de cadrage, pour que personne ne rebranche le prix par erreur : `value` est le prix
// configuré CHEZ LOBBY, exposé ici à titre purement indicatif. hifago reste la source du prix
// (règle actée, cf. buildEvenRatesPerDay.ts et parseLobbyNightAvailability.ts) — au mieux ce
// chiffre sert de valeur suggérée au moment d'établir le lien, jamais de prix de vente.
//
// Le champ identifiant est `service_id` côté Lobby ; c'est le même entier que `id_producto` dans
// ingresos[] et que `product_id` de POST /booking/add-product-service — mappé vers ce que hifago
// nomme lobby_product_id. Aucune photo, aucune description, aucune catégorie, aucun horaire n'est
// exposé par cet endpoint : un service Lobby est un couple identifiant/prix, rien de plus.

export interface LobbyService {
  serviceId: number;
  name: string;
  /** Prix Lobby (`value`, chaîne décimale), indicatif seulement. */
  valueCop: number | null;
  /** `infinite_inventory` à 1 → stock illimité. null si Lobby ne le renseigne pas. */
  infiniteInventory: boolean | null;
  /** Stock restant. null si illimité ou non renseigné (le cas le plus fréquent observé). */
  stock: number | null;
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

    const stockRaw = row.stock;
    services.push({
      serviceId,
      name,
      valueCop: asMoney(row.value),
      infiniteInventory: asFlag(row.infinite_inventory),
      stock: stockRaw === null || stockRaw === undefined ? null : asPositiveInt(stockRaw),
    });
  }
  return services;
}
