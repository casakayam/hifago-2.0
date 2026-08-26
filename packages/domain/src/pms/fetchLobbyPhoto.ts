// Récupération BORNÉE d'une photo hébergée par LobbyPMS, en vue de l'importer dans catalog-media.
//
// Ce module existe parce qu'importer une photo revient à faire une requête sortante vers une URL
// fournie par un tiers — c'est la seule de tout le connecteur. Les bornes ne sont donc pas du
// confort : sans elles, une réponse lente, un `Content-Length` menteur ou une redirection suffisent
// à immobiliser ou saturer le Route Handler.
//
// Un piège précis à connaître : le plafond de 6 photos vit DANS la RPC add_catalog_media
// (20260815110000), donc il ne se déclenche qu'APRÈS le téléchargement, le décodage et l'écriture
// dans Storage. Il ne borne pas le travail sortant. C'est à l'appelant de couper la liste d'URLs
// AVANT le premier fetch, et de nettoyer Storage si la RPC refuse ensuite.

export const LOBBY_PHOTO_HOST = "app.lobbypms.com";

const DEFAULT_MAX_BYTES = 8 * 1024 * 1024; // aligné sur MAX_BYTES du Route Handler d'upload
const DEFAULT_TIMEOUT_MS = 10_000;

export type FetchLobbyPhotoFailure =
  | "invalid_url"
  | "host_not_allowed"
  | "redirect_refused"
  | "http_error"
  | "too_large"
  | "timeout"
  | "network_error";

export type FetchLobbyPhotoResult =
  | { ok: true; bytes: Uint8Array; contentType: string | null }
  | { ok: false; reason: FetchLobbyPhotoFailure; status?: number };

export interface FetchLobbyPhotoOptions {
  maxBytes?: number;
  timeoutMs?: number;
  /** Surchargé uniquement par les tests, qui servent les fixtures depuis 127.0.0.1. */
  allowedHosts?: string[];
}

export async function fetchLobbyPhoto(
  rawUrl: string,
  options: FetchLobbyPhotoOptions = {}
): Promise<FetchLobbyPhotoResult> {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const allowedHosts = options.allowedHosts ?? [LOBBY_PHOTO_HOST];

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, reason: "invalid_url" };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { ok: false, reason: "invalid_url" };
  }
  // Liste blanche d'hôtes : une URL de photo ne doit jamais pouvoir désigner autre chose que
  // l'hébergeur de Lobby. Sans ça, un identifiant de catégorie bidouillé côté requête pourrait
  // faire émettre une requête vers une adresse interne depuis notre propre serveur.
  if (!allowedHosts.includes(url.hostname)) {
    return { ok: false, reason: "host_not_allowed" };
  }

  let response: Response;
  try {
    response = await fetch(url, {
      // Jamais de suivi automatique : une redirection pourrait sortir de la liste blanche après
      // coup. Un 3xx est refusé, pas suivi.
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const isTimeout = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    return { ok: false, reason: isTimeout ? "timeout" : "network_error" };
  }

  if (response.status >= 300 && response.status < 400) {
    return { ok: false, reason: "redirect_refused", status: response.status };
  }
  if (!response.ok) {
    return { ok: false, reason: "http_error", status: response.status };
  }

  // Le Content-Length est une indication, jamais une garantie : on compte les octets réellement
  // reçus et on coupe au plafond, plutôt que de faire confiance à l'en-tête (ou à arrayBuffer(),
  // qui aurait déjà tout chargé en mémoire avant qu'on puisse dire non).
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    return { ok: false, reason: "too_large" };
  }

  const body = response.body;
  if (!body) return { ok: false, reason: "network_error" };

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      received += value.byteLength;
      if (received > maxBytes) {
        await reader.cancel();
        return { ok: false, reason: "too_large" };
      }
      chunks.push(value);
    }
  } catch (error) {
    const isTimeout = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    return { ok: false, reason: isTimeout ? "timeout" : "network_error" };
  }

  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  // Le format réel n'est PAS déduit de cet en-tête : l'appelant repasse par sharp, qui lit les
  // octets. Le Content-Type n'est remonté qu'à titre de diagnostic.
  return { ok: true, bytes, contentType: response.headers.get("content-type") };
}

/**
 * Combien de photos on s'autorise à télécharger, sachant le plafond de la galerie et ce qu'elle
 * contient déjà. Appelé AVANT le premier fetch — c'est tout l'intérêt.
 */
export function remainingPhotoSlots(existingCount: number, maxPerGallery = 6): number {
  return Math.max(0, maxPerGallery - Math.max(0, existingCount));
}
