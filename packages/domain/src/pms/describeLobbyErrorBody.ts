// Promu depuis pms-nightly-contract-check le 2026-08-28 : le job savait déjà rapporter un corps
// d'erreur, le chemin de réservation non — c'est exactement l'asymétrie qui a rendu la panne du
// 2026-08-28 indiagnosticable pendant une heure.
//
// Un 403 de Caddy (relais : en-tête X-Relay-Secret refusé, corps « forbidden ») et un 403 de
// LobbyPMS (IP non whitelistée, corps JSON) sont INDISCERNABLES quand on ne rapporte que le statut.
// Le corps tranche en un coup d'œil, et il ne coûte rien : il est déjà lu et parsé par lobbyCall.
//
// SÛRETÉ : on n'imprime QUE le corps de la RÉPONSE. Jamais l'URL de la requête — elle porte
// `api_token` en query string (hifago/CLAUDE.md §8). Tronqué court : un corps d'erreur utile tient
// en deux lignes, et une page HTML d'erreur d'un proxy amont n'a pas à noyer les logs.
export function describeLobbyErrorBody(body: unknown): string {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  if (!text) return "corps vide";
  return text.length > 200 ? `${text.slice(0, 200)}…` : text;
}
