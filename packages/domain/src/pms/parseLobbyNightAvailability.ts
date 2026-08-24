export interface LobbyNightAvailability {
  available: number;
}

// Port du pattern nightAvailability legacy (app legacy, src/services/portalService.js) : la racine
// utile est soit body.data[0] (forme "data" tolérée par précaution, jamais confirmée observée en
// v2), soit body lui-même (forme réellement observée, cf. docs/3-integrations/lobby_pms_api.md à la
// racine du dépôt) — parser défensivement, ne jamais supposer un format garanti (client cahier des
// charges §5). Ne lit QUE la disponibilité : Lobby n'est jamais la source du prix côté hifago (cf.
// buildEvenRatesPerDay.ts) — plans[].prices[] n'est délibérément pas lu ici.
export function parseLobbyNightAvailability(body: unknown, categoryId: number): LobbyNightAvailability | null {
  if (typeof body !== "object" || body === null) return null;
  const dataArray = (body as { data?: unknown }).data;
  const root = Array.isArray(dataArray) ? dataArray[0] : body;
  if (typeof root !== "object" || root === null) return null;

  const categories = (root as { categories?: unknown }).categories;
  if (!Array.isArray(categories)) return null;

  const category = categories.find(
    (entry) =>
      typeof entry === "object" &&
      entry !== null &&
      Number((entry as { category_id?: unknown }).category_id) === categoryId
  );
  if (!category) return null;

  const availableRooms = Number((category as { available_rooms?: unknown }).available_rooms);
  return { available: Number.isFinite(availableRooms) ? Math.max(0, availableRooms) : 0 };
}
