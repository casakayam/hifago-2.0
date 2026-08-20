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
}

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
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
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

      if (req.method === "POST" && url.pathname === "/api/v1/booking/add-product-service") {
        send(
          res,
          scenario.addProductServiceStatus ?? 200,
          scenario.addProductServiceBody ?? { sale: { id: 90000003, total: 0 } }
        );
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
