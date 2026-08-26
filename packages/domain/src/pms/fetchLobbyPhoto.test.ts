import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fetchLobbyPhoto, remainingPhotoSlots } from "./fetchLobbyPhoto";

// Serveur hostile local : chaque route reproduit une façon dont une URL tierce peut mal se
// comporter. Même approche que lobbyClient.test.ts (vrai fetch contre un vrai node:http), jamais
// un mock de fetch — c'est le comportement réseau qu'on veut prouver, pas notre propre stub.
let server: Server;
let base: string;
const ALLOWED = ["127.0.0.1"];

beforeAll(async () => {
  server = createServer((req, res) => {
    const path = req.url ?? "/";
    if (path === "/ok") {
      res.writeHead(200, { "Content-Type": "image/jpeg" });
      res.end(Buffer.from([1, 2, 3, 4, 5]));
      return;
    }
    if (path === "/redirect") {
      res.writeHead(302, { Location: "http://example.com/elsewhere.jpg" });
      res.end();
      return;
    }
    if (path === "/notfound") {
      res.writeHead(404);
      res.end();
      return;
    }
    if (path === "/chunked-enorme") {
      // Réponse SANS Content-Length (chunked) et bien plus grosse que le plafond : c'est le cas
      // que l'en-tête ne protège pas, et donc celui où le compteur d'octets reçus doit couper.
      // (Impossible de simuler un Content-Length menteur ici : node:http tronque lui-même le corps
      // à la taille déclarée — constaté en écrivant ce test.)
      res.writeHead(200, { "Content-Type": "image/jpeg" });
      for (let i = 0; i < 50; i++) res.write(Buffer.alloc(10_000, 7));
      res.end();
      return;
    }
    if (path === "/enorme") {
      res.writeHead(200, { "Content-Type": "image/jpeg", "Content-Length": "999999999" });
      res.end(Buffer.alloc(1000, 1));
      return;
    }
    if (path === "/lent") {
      setTimeout(() => {
        res.writeHead(200);
        res.end(Buffer.from([1]));
      }, 2000);
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  base = typeof address === "object" && address ? `http://127.0.0.1:${address.port}` : "";
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("fetchLobbyPhoto", () => {
  it("récupère une image et compte les octets réellement reçus", async () => {
    const result = await fetchLobbyPhoto(`${base}/ok`, { allowedHosts: ALLOWED });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Array.from(result.bytes)).toEqual([1, 2, 3, 4, 5]);
      expect(result.contentType).toBe("image/jpeg");
    }
  });

  it("refuse un hôte hors liste blanche AVANT toute requête", async () => {
    const result = await fetchLobbyPhoto("https://exemple-malveillant.test/a.jpg");
    expect(result).toEqual({ ok: false, reason: "host_not_allowed" });
  });

  it("refuse aussi une adresse interne — c'est le point de la liste blanche", async () => {
    const result = await fetchLobbyPhoto("http://169.254.169.254/latest/meta-data/");
    expect(result).toEqual({ ok: false, reason: "host_not_allowed" });
  });

  it("refuse une redirection au lieu de la suivre", async () => {
    const result = await fetchLobbyPhoto(`${base}/redirect`, { allowedHosts: ALLOWED });
    expect(result).toMatchObject({ ok: false, reason: "redirect_refused" });
  });

  it("remonte un statut HTTP d'erreur sans lever", async () => {
    const result = await fetchLobbyPhoto(`${base}/notfound`, { allowedHosts: ALLOWED });
    expect(result).toMatchObject({ ok: false, reason: "http_error", status: 404 });
  });

  it("coupe sur les octets REÇUS quand aucune taille n'est déclarée", async () => {
    const result = await fetchLobbyPhoto(`${base}/chunked-enorme`, {
      allowedHosts: ALLOWED,
      maxBytes: 1000,
    });
    expect(result).toEqual({ ok: false, reason: "too_large" });
  });

  it("refuse d'emblée un Content-Length déclaré au-dessus du plafond", async () => {
    const result = await fetchLobbyPhoto(`${base}/enorme`, { allowedHosts: ALLOWED, maxBytes: 1000 });
    expect(result).toEqual({ ok: false, reason: "too_large" });
  });

  it("abandonne une réponse trop lente", async () => {
    const result = await fetchLobbyPhoto(`${base}/lent`, { allowedHosts: ALLOWED, timeoutMs: 200 });
    expect(result).toEqual({ ok: false, reason: "timeout" });
  });

  it.each(["", "pas une url", "ftp://app.lobbypms.com/a.jpg", "javascript:alert(1)"])(
    "rejette l'URL invalide %j",
    async (raw) => {
      const result = await fetchLobbyPhoto(raw);
      expect(result.ok).toBe(false);
    }
  );
});

describe("remainingPhotoSlots", () => {
  it.each([
    [0, 6],
    [2, 4],
    [6, 0],
    [9, 0],
    [-1, 6],
  ])("galerie à %i photos → %i places", (existing, expected) => {
    expect(remainingPhotoSlots(existing)).toBe(expected);
  });
});
