// Client LobbyPMS générique — port du pattern portalService.js `call()` (app legacy,
// src/services/portalService.js) vers fetch natif : ne lève JAMAIS d'exception sur un 4xx/5xx,
// laisse l'appelant décider (un 422 INPUT_PARAMETERS ou un 404 sur booking annulé sont des
// réponses NORMALES à traiter, pas des cas d'erreur, cf. client cahier des charges §5).
//
// Principe central (spec 21 §3) : baseUrl/apiToken sont TOUJOURS des paramètres explicites de
// fonction, jamais lus depuis process.env/Deno.env à l'intérieur de ce module. C'est ce qui permet
// à ce module identique de tourner dans un Route Handler Next.js (Node) ET une Edge Function
// Supabase (Deno), et d'être redirigé vers un serveur de fixtures local en test.

export const LOBBY_DEFAULT_BASE_URL = "https://api.lobbypms.com";

export interface LobbyCallResult<T = unknown> {
  status: number;
  body: T;
}

async function lobbyCall<T = unknown>(
  method: "GET" | "POST",
  baseUrl: string,
  path: string,
  apiToken: string,
  options: { params?: Record<string, string | number>; data?: unknown; relaySecret?: string } = {}
): Promise<LobbyCallResult<T>> {
  const url = new URL(path, baseUrl);
  if (method === "GET") {
    url.searchParams.set("api_token", apiToken);
    for (const [key, value] of Object.entries(options.params ?? {})) {
      url.searchParams.set(key, String(value));
    }
  }

  const headers: Record<string, string> = { Accept: "application/json", "Content-Type": "application/json" };
  if (options.relaySecret) {
    headers["X-Relay-Secret"] = options.relaySecret;
  }

  const response = await fetch(url.toString(), {
    method,
    headers,
    body: method === "POST" ? JSON.stringify({ api_token: apiToken, ...(options.data as object) }) : undefined,
  });

  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // Réponse non-JSON (rare, ex. page d'erreur HTML d'un proxy amont) — forme défensive, jamais
    // une exception (client cahier des charges §5 : parser défensivement, ne jamais supposer un
    // format garanti).
    body = { raw: text };
  }

  return { status: response.status, body: body as T };
}

export function getLobbyRooms(baseUrl: string, apiToken: string, page?: number, relaySecret?: string) {
  return lobbyCall("GET", baseUrl, "/api/v1/rooms", apiToken, {
    params: page ? { page } : undefined,
    relaySecret,
  });
}

// GET /api/v1/products — services/activités du compte Lobby (jamais des chambres). Réponse
// { data: [{ service_id, name, value, infinite_inventory, stock }], meta }. Champ nommé
// service_id côté Lobby — le Route Handler appelant (jamais ce module générique) est responsable
// de le mapper vers ce que hifago appelle lobby_product_id ailleurs, cohérent avec l'usage de ce
// même identifiant comme product_id dans addLobbyProductService.
export function getLobbyProducts(baseUrl: string, apiToken: string, page?: number, relaySecret?: string) {
  return lobbyCall("GET", baseUrl, "/api/v1/products", apiToken, {
    params: page ? { page } : undefined,
    relaySecret,
  });
}

// GET /api/v2/available-rooms pour UNE nuit (start_date=date, end_date=date+1) — la forme V2 groupe
// les prix par plan (plans[].prices[]), pas directement categories[].prices[] comme la V1.
export function getLobbyNightAvailability(
  baseUrl: string,
  apiToken: string,
  categoryId: number,
  date: string,
  nextDate: string,
  relaySecret?: string
) {
  return lobbyCall("GET", baseUrl, "/api/v2/available-rooms", apiToken, {
    params: { category_id: categoryId, start_date: date, end_date: nextDate },
    relaySecret,
  });
}

// GET /api/v2/available-rooms SANS `category_id` — la réponse porte un tableau `categories[]`, donc
// omettre le filtre revient à demander le catalogue entier pour la nuit. Lecture d'OBSERVATION,
// réservée au job nocturne de contrôle de contrat : getLobbyNightAvailability juste au-dessus reste
// la seule fonction du parcours de réservation, et n'est pas touchée.
//
// Ce que cet appel doit trancher, et que rien d'autre ne peut (les deux points sont ouverts depuis
// le début du chantier, faute d'observation) :
//   C1 — si Lobby n'énumère ici QUE les catégories réservables, la réponse EST le filtre cherché,
//        et on n'a jamais à coder un identifiant en dur.
//   C5 — les valeurs réelles de restrictions{min_stay, max_stay, lead_days}.
export function getLobbyAvailableRooms(
  baseUrl: string,
  apiToken: string,
  date: string,
  nextDate: string,
  relaySecret?: string
) {
  return lobbyCall("GET", baseUrl, "/api/v2/available-rooms", apiToken, {
    params: { start_date: date, end_date: nextDate },
    relaySecret,
  });
}

export interface CreateLobbyBookingInput {
  categoryId: number;
  startDate: string;
  endDate: string;
  totalAdults: number;
  totalChildren?: number;
  holderName: string;
  ratesPerDay: { date: string; price: number }[];
  note?: string;
}

// rates_per_day[].price est le tarif DÉJÀ NET (remise appliquée, quantité encodée) — Lobby ne
// multiplie jamais par occupants ni n'applique de remise propre (piège confirmé, client cahier des
// charges §5). L'appelant (Route Handler) est responsable d'envoyer un prix déjà net.
export function createLobbyBooking(
  baseUrl: string,
  apiToken: string,
  input: CreateLobbyBookingInput,
  relaySecret?: string
) {
  return lobbyCall("POST", baseUrl, "/api/v1/bookings", apiToken, {
    data: {
      category_id: input.categoryId,
      start_date: input.startDate,
      end_date: input.endDate,
      total_adults: input.totalAdults,
      total_children: input.totalChildren,
      holder_name: input.holderName,
      rates_per_day: input.ratesPerDay,
      note: input.note,
    },
    relaySecret,
  });
}

export function addLobbyProductService(
  baseUrl: string,
  apiToken: string,
  bookingId: number,
  items: { productId: number; qty: number }[],
  relaySecret?: string
) {
  return lobbyCall("POST", baseUrl, "/api/v1/booking/add-product-service", apiToken, {
    data: {
      booking_id: bookingId,
      items: items.map((item) => ({ product_id: item.productId, cant: item.qty })),
    },
    relaySecret,
  });
}

export function getLobbyBookingDetail(baseUrl: string, apiToken: string, bookingId: number, relaySecret?: string) {
  return lobbyCall("GET", baseUrl, `/api/v1/bookings/${encodeURIComponent(String(bookingId))}`, apiToken, {
    relaySecret,
  });
}

export function cancelLobbyBooking(
  baseUrl: string,
  apiToken: string,
  bookingId: number,
  cancellationReason: string,
  description?: string,
  relaySecret?: string
) {
  return lobbyCall(
    "POST",
    baseUrl,
    `/api/v1/cancel-booking/${encodeURIComponent(String(bookingId))}`,
    apiToken,
    { data: { cancellation_reason: cancellationReason, description }, relaySecret }
  );
}
