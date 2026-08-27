import { createServer, type Server } from "node:http";

// Spec 21 — connecteur LobbyPMS. Serveur node:http minimal, aucune nouvelle dépendance (ni Nock ni
// MSW ne sont réellement installés dans ce monorepo, cf. spec 21 §10) : sert de cible unique pour
// TOUTES les couches qui ont besoin d'un LobbyPMS de test — le module domain (packages/domain/src/
// pms/lobbyClient.test.ts a son propre serveur inline, plus simple), une Route Handler Next.js
// (via LOBBY_API_BASE_URL) ET une Edge Function Deno (via supabase/functions/.env,
// LOBBY_API_BASE_URL=http://host.docker.internal:<port>) — ce qu'aucune lib de mock JS ne peut
// faire, pg_net émettant un vrai appel HTTP depuis Postgres.
export interface PmsFixtureScenario {
  rooms?: unknown;
  createBookingStatus?: number;
  createBookingBody?: unknown;
  addProductServiceStatus?: number;
  addProductServiceBody?: unknown;
  bookingDetailByStatus?: Map<number, { status: number; body: unknown }>;
  // Spec 21 §13 (gap comblé) — clé = start_date (yyyy-MM-dd) envoyé par getLobbyNightAvailability.
  // Une date absente de cette map répond "disponible" par défaut (available_rooms: 5) : un scénario
  // n'a besoin d'énumérer que les exceptions (nuit pleine, nuit en erreur), pas tout le mois.
  nightAvailabilityByDate?: Record<string, { status?: number; availableRooms?: number }>;
  // Refonte parcours produit ↔ LobbyPMS — GET /api/v1/products (les « services » du compte). Sans
  // cette route, le picker de services (apps/admin/app/api/pms/lobby-services/route.ts) tombait en
  // 404 → 502 : il n'était ni testable ni exerçable en local, contrairement à son jumeau /rooms.
  services?: unknown;
  // POST /api/v1/cancel-booking/{id} — clé = booking_id. Une entrée absente répond 200 avec un
  // cancel_booking synthétique ; poser explicitement { status: 422, body: { error_code:
  // "RESTRICTED_RESERVATION" } } pour rejouer le cas « booking portant déjà une charge », qui est
  // un cas ATTENDU et documenté (spec 21 §0), jamais une exception.
  cancelBookingByStatus?: Map<number, { status: number; body: unknown }>;
  // GET /api/v2/available-rooms appelé SANS `category_id` — forme « catalogue entier pour la nuit »,
  // utilisée par le job nocturne de contrôle de contrat (jamais par le parcours de réservation, qui
  // filtre toujours sur une catégorie). Servie telle quelle, sans synthèse : ce scénario existe
  // précisément pour rejouer une charge utile OBSERVÉE, restrictions comprises.
  availableRoomsCatalog?: unknown;
}

// Forme RÉELLEMENT OBSERVÉE le 2026-08-26 sur le compte Lobby de Casa Kayam, via la préprod
// (spec 24 §11.1) — et non plus une transcription de leur documentation, qui s'était déjà révélée
// fausse une fois sur `POST /bookings`.
//
// Ces constantes sont LOAD-BEARING depuis le 2026-08-27 :
// `apps/admin/lib/pms/lobbyContract.test.ts` démarre ce serveur, les sert sur du vrai HTTP et
// vérifie la chaîne complète (lobbyClient → parseur → pagination). Modifier une valeur ici fait
// donc rougir un test — c'est tout l'intérêt.
//
// Elles ne l'étaient PAS quand elles ont été écrites, et le commentaire prétendait le contraire
// (« les tests qui consomment ceci prouvent le contrat réel », alors qu'aucun ne les consommait) ;
// le /simplify du 2026-08-26 l'a relevé, d'où le test. À garder branché : sans consommateur, ces
// valeurs redeviennent une référence décorative qui peut diverger de Lobby en silence.
//
// Les quatre traits que cette fixture doit conserver, parce que chacun a cassé ou aurait pu casser
// quelque chose :
//   1. `type` est en ESPAGNOL (`privada` / `compartida`), jamais en anglais ;
//   2. `capacity` = occupants d'UNE unité, `quantity` = NOMBRE d'unités — un dortoir est
//      capacity:1 × quantity:8 (huit lits), pas capacity:8 ;
//   3. `descriptions[]` contient `pt` et `fr` en plus de `es`/`en` : le parseur DOIT les ignorer
//      sans les écrire (l'éditeur hifago est fermé à es/en) et les signaler via unsupportedLangs ;
//   4. une catégorie parfaitement valide peut avoir `descriptions: []` ET `photos: []` — c'est le
//      cas de 2 des 6 catégories réelles, jamais une anomalie.
export const LOBBY_ROOMS_OBSERVED_2026_08_26 = {
  data: [
    {
      category_id: 29376,
      name: "GLAMPING",
      type: "privada",
      capacity: 2,
      quantity: 3,
      descriptions: [
        { description: "Habitación con baño privado, agua caliente\n", lang: "es" },
        { description: "Room with private bathroom, hot water", lang: "en" },
        { description: "Quarto com banheiro privativo, água quente", lang: "pt" },
        { description: "Chambre avec salle de bain privée, eau chaude", lang: "fr" },
      ],
      photos: [
        { photo_id: 60107, url: "https://app.lobbypms.com/permanent/uploads/1157066d7610b43075.jpg" },
        { photo_id: 60108, url: "https://app.lobbypms.com/permanent/uploads/1157066d7613394959.jpg" },
      ],
      rooms: [
        { id: 718411, name: "EMBERA", type: "privada" },
        { id: 718412, name: "KUNA", type: "privada" },
        { id: 718413, name: "ZENU", type: "privada" },
      ],
    },
    {
      category_id: 9631,
      name: "VIDPOVO",
      type: "compartida",
      capacity: 1,
      quantity: 8,
      descriptions: [
        { description: "Dormitorio práctico y organizado con cortinas [8 camas]", lang: "es" },
        { description: "Practical and organized bedroom with curtains [8 beds]", lang: "en" },
      ],
      photos: [
        { photo_id: 60541, url: "https://app.lobbypms.com/permanent/uploads/1157064f271ab8fb20.jpg" },
      ],
      rooms: Array.from({ length: 8 }, (_, i) => ({
        id: 700000 + i,
        name: `Cama ${i + 1}`,
        type: "compartida",
      })),
    },
    // Catégorie sans aucun contenu éditorial — cas réel (2 des 6 catégories du compte), à garder
    // pour que la carte de prévisualisation soit toujours exercée sur sa branche "rien à montrer".
    {
      category_id: 49823,
      name: "CAMPER Van",
      type: "privada",
      capacity: 4,
      quantity: 2,
      descriptions: [],
      photos: [],
      rooms: [
        { id: 939246, name: "Habitación 1", type: "privada" },
        { id: 939247, name: "Habitación 2", type: "privada" },
      ],
    },
  ],
  meta: { total_records: 3, total_pages: 1 },
};

// Forme réellement observée de GET /api/v1/products (spec 24 §11.3). À retenir : un service ne
// porte NI photo, NI capacité, NI quantité, NI description — ces champs n'existent pas sur cette
// ressource, et aucun compte n'en fournira. `stock` est null quand `infinite_inventory` est vrai.
export const LOBBY_SERVICES_OBSERVED_2026_08_26 = {
  data: [
    { service_id: 494426, name: "YOGA session", value: 22000, infinite_inventory: true, stock: null },
    { service_id: 473220, name: "Ensayo hora", value: 40000, infinite_inventory: true, stock: null },
    { service_id: 566605, name: "Paddle boarding 4H", value: 135000, infinite_inventory: true, stock: null },
  ],
  meta: { total_records: 3, total_pages: 1 },
};

// Forme réellement observée le 2026-08-27 sur le compte Casa Kayam — GET /api/v2/available-rooms
// appelé SANS `category_id` (catalogue entier pour une nuit), relevé par la sonde de
// pms-nightly-contract-check via le relais. Ce que ce relevé a tranché, et qui était ouvert depuis
// le début du chantier :
//
//   C1 — RÉFUTÉ. L'hypothèse « Lobby ne cote que les catégories réservables » est fausse : les 6
//        catégories du compte sont cotées, avec une signature de champs IDENTIQUE
//        [available_rooms, category_id, name, plans, restrictions] et une disponibilité non nulle
//        pour toutes. Cette réponse ne porte AUCUN discriminant. Y compris pour 18013 et 49823,
//        qui figuraient parmi les catégories refusant un booking en 422 le 2026-07-06.
//   C5 — RÉPONDU. `restrictions` existe (il n'avait jamais été observé) et vaut {0,0,0} sur les
//        SIX. Aucune contrainte sur ce compte : lire défensivement et n'appliquer que si > 0 reste
//        la bonne règle, désormais fondée sur un constat et non sur une précaution.
//
// Troisième constat, non cherché : `plans[].prices[]` compte AUTANT D'ENTRÉES QUE LA CAPACITÉ
// d'une unité — GLAMPING (capacity 2) → 2 prix, CAMPER Van (capacity 4) → 4 prix, les dortoirs
// (capacity 1) → 1 prix. Les prix Lobby sont donc par NIVEAU D'OCCUPATION, un modèle que hifago
// n'a pas (unit = per_person | per_two | per_house). Confirme, plutôt qu'il ne l'infirme,
// « Lobby n'est jamais la source du prix ».
//
// ⚠️ Ce qui est OBSERVÉ ici : les identifiants, `available_rooms`, `restrictions`, la liste des
// clés, et le NOMBRE de plans et de prix. Ce qui ne l'est PAS : les valeurs de prix, les
// identifiants de plan et les noms de catégorie ci-dessous — reconstruits pour donner un objet
// complet. Le parseur ne lit que ce qui est observé (il compte les prix, ne les lit jamais), donc
// la fixture reste opposable sur exactement ce dont elle témoigne.
export const LOBBY_AVAILABILITY_OBSERVED_2026_08_27 = {
  date: "2026-09-26",
  categories: [
    { category_id: 9629, name: "Dormitorio A", available_rooms: 4, restrictions: { min_stay: 0, max_stay: 0, lead_days: 0 },
      plans: [{ plan_id: 1, prices: [{ people: 1, price: 45000 }] }] },
    { category_id: 9631, name: "VIDPOVO", available_rooms: 8, restrictions: { min_stay: 0, max_stay: 0, lead_days: 0 },
      plans: [{ plan_id: 1, prices: [{ people: 1, price: 45000 }] }] },
    { category_id: 18013, name: "Dormitorio B", available_rooms: 12, restrictions: { min_stay: 0, max_stay: 0, lead_days: 0 },
      plans: [{ plan_id: 1, prices: [{ people: 1, price: 45000 }] }] },
    { category_id: 29376, name: "GLAMPING", available_rooms: 3, restrictions: { min_stay: 0, max_stay: 0, lead_days: 0 },
      plans: [{ plan_id: 1, prices: [{ people: 1, price: 120000 }, { people: 2, price: 180000 }] }] },
    { category_id: 36572, name: "Dormitorio C", available_rooms: 6, restrictions: { min_stay: 0, max_stay: 0, lead_days: 0 },
      plans: [{ plan_id: 1, prices: [{ people: 1, price: 45000 }] }] },
    { category_id: 49823, name: "CAMPER Van", available_rooms: 2, restrictions: { min_stay: 0, max_stay: 0, lead_days: 0 },
      plans: [{ plan_id: 1, prices: [
        { people: 1, price: 90000 }, { people: 2, price: 140000 },
        { people: 3, price: 180000 }, { people: 4, price: 210000 },
      ] }] },
  ],
};

let scenario: PmsFixtureScenario = {};

export function setPmsFixtureScenario(next: PmsFixtureScenario): void {
  scenario = next;
}

function send(res: import("node:http").ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

export function startPmsFixtureServer(port: number): Promise<{ url: string; close: () => Promise<void> }> {
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    // Le listener est nécessaire (il met le flux en mode « flowing » pour que "end" se déclenche) ;
    // l'accumulation ne l'était pas — `raw` n'était jamais lu et bufferisait sans borne un corps
    // que personne ne consomme (/simplify 2026-08-26).
    req.on("data", () => {});
    req.on("end", () => {
      if (req.method === "GET" && url.pathname === "/api/v1/rooms") {
        send(res, 200, scenario.rooms ?? { data: [], meta: { total_records: 0 } });
        return;
      }

      const bookingDetailMatch = url.pathname.match(/^\/api\/v1\/bookings\/(\d+)$/);
      if (req.method === "GET" && bookingDetailMatch) {
        const bookingId = Number(bookingDetailMatch[1]);
        const entry = scenario.bookingDetailByStatus?.get(bookingId);
        if (!entry) {
          send(res, 404, { message: "No query results for model [App\\Models\\Booking]." });
          return;
        }
        send(res, entry.status, entry.body);
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/v1/bookings") {
        send(
          res,
          scenario.createBookingStatus ?? 200,
          scenario.createBookingBody ?? { booking: { booking_id: 90000001, room_id: 90000002 } }
        );
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/v2/available-rooms") {
        // Sans `category_id`, Lobby renvoie le catalogue entier — branche distincte, ajoutée le
        // 2026-08-27. Placée AVANT l'ancienne : `Number(null)` vaut NaN, la branche historique
        // aurait donc répondu une catégorie fantôme `category_id: null` au lieu d'un catalogue.
        if (!url.searchParams.has("category_id")) {
          send(res, 200, scenario.availableRoomsCatalog ?? { date: url.searchParams.get("start_date") ?? "", categories: [] });
          return;
        }
        const categoryId = Number(url.searchParams.get("category_id"));
        const startDate = url.searchParams.get("start_date") ?? "";
        const entry = scenario.nightAvailabilityByDate?.[startDate];
        send(res, entry?.status ?? 200, {
          date: startDate,
          categories: [{ category_id: categoryId, available_rooms: entry?.availableRooms ?? 5, plans: [] }],
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/v1/booking/add-product-service") {
        send(
          res,
          scenario.addProductServiceStatus ?? 200,
          scenario.addProductServiceBody ?? { sale: { id: 90000003, total: 0 } }
        );
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/v1/products") {
        send(res, 200, scenario.services ?? { data: [], meta: { total_records: 0, total_pages: 1 } });
        return;
      }

      const cancelBookingMatch = url.pathname.match(/^\/api\/v1\/cancel-booking\/(\d+)$/);
      if (req.method === "POST" && cancelBookingMatch) {
        const bookingId = Number(cancelBookingMatch[1]);
        const entry = scenario.cancelBookingByStatus?.get(bookingId);
        send(res, entry?.status ?? 200, entry?.body ?? { cancel_booking: bookingId });
        return;
      }

      send(res, 404, { message: "not found in fixture server" });
    });
  });

  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => {
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((closeResolve) => server.close(() => closeResolve())),
      });
    });
  });
}
