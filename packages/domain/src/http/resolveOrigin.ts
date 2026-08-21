// Feature 32 — trouvé en testant via tunnel cloudflared (docs/journal/2026-08.md, 2026-08-21) :
// `new URL(request.url).origin` seul retombe sur l'adresse locale du serveur (ex.
// http://localhost:3100) dès que la requête traverse un reverse proxy/tunnel qui ne réécrit pas
// request.url lui-même — le Host header ET X-Forwarded-Host arrivent corrects, seul request.url
// ment. Fonction PURE (aucune dépendance Fetch API/Node) : prend les valeurs déjà extraites des
// headers plutôt qu'un objet Request, réutilisable partout où une route doit construire une URL
// absolue (redirection, callback, notification_url) à partir d'une requête entrante.
export function resolveOrigin(params: {
  requestUrl: string;
  forwardedHost: string | null;
  forwardedProto: string | null;
}): string {
  if (params.forwardedHost) {
    return `${params.forwardedProto ?? "https"}://${params.forwardedHost}`;
  }
  return new URL(params.requestUrl).origin;
}
