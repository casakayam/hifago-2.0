// Table de correspondance des codes d'erreur LobbyPMS connus (docs/3-integrations/lobby_pms_api.md,
// racine du dépôt) vers un message court destiné à pms_reconciliation_entries.resolution_note ou
// un log — jamais une erreur générique opaque pour un cas déjà documenté.
const KNOWN_LOBBY_ERROR_CODES: Record<string, string> = {
  INPUT_PARAMETERS: "Paramètres invalides ou catégorie non réservable par API.",
  NOT_ROOM: "Chambre indisponible (sold-out côté Lobby).",
  RECORD_NOT_FOUND: "Booking introuvable côté Lobby.",
  UNAUTHORIZED_BOOKING: "Ce booking n'a pas été créé par l'API, action refusée.",
  BOOKING_CHECK_IN_COMPLETE: "Annulation impossible : check-in déjà effectué.",
  RESTRICTED_RESERVATION: "Annulation impossible : le booking porte déjà une prestation attachée.",
};

export function mapLobbyErrorCode(errorCode: string | null | undefined): string {
  if (!errorCode) return "Erreur LobbyPMS non identifiée.";
  return KNOWN_LOBBY_ERROR_CODES[errorCode] ?? `Erreur LobbyPMS non documentée : ${errorCode}.`;
}
