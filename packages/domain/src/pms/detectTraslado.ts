export interface LobbyBookingDetailData {
  checkin_realizado: number | null;
  checkout_realizado: number | null;
  total_alojamiento: string;
  descuentos: unknown[] | null;
  deleted_at: string | null;
}

// Mécanisme de DÉTECTION seul repris du legacy (docs/2-reference/06-lobbypms.md, racine du dépôt,
// piège empirique n°5) — jamais le branchement commission/attribution de code promo par CSV, qui
// ne correspond plus au modèle hifago (spec 21 §10 point 3). Un traslado (changement de chambre
// fait par le staff Lobby) met total_alojamiento=0 sur la résa d'origine et crée une NOUVELLE résa
// sans les descuentos — signal à faire remonter en réconciliation, jamais reconstruit
// automatiquement ici.
export function isPossibleTraslado(detail: LobbyBookingDetailData): boolean {
  return Number(detail.total_alojamiento) === 0 && (!detail.descuentos || detail.descuentos.length === 0);
}

// Réalisation = checkout_realizado === 1 (PAS estatus, piège empirique n°9 de 06-lobbypms.md) —
// deleted_at n'est qu'un signal défensif, jamais le signal principal.
export function isRealized(detail: LobbyBookingDetailData): boolean {
  return detail.checkout_realizado === 1;
}
