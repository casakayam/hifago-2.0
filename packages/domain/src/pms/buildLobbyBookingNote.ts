// La note d'un booking LobbyPMS est le SEUL champ libre disponible : Lobby n'a aucun champ email ni
// téléphone sur une réservation (vérifié sur la surface complète de son API). L'app legacy s'en
// servait donc déjà comme véhicule pour tout ce que le PMS ne sait pas stocker — code promo,
// WhatsApp, mail, source — format `<PROMO> | WA:… | MAIL:… | SRC:…` (src/services/portalService.js).
// hifago n'envoyait qu'un identifiant technique, si bien que l'hôte voyait arriver une réservation
// sans savoir qui contacter ni d'où elle venait.
//
// Sur la PII : envoyer téléphone et e-mail au compte Lobby de l'établissement n'expose rien de
// nouveau à ce partenaire. La restriction « PII minimale, jamais téléphone ni email » de
// 20260817180000 a été explicitement levée par Jérôme le 2026-08-19 (migration
// 20260819180000_order_lines_holder_contact_operator.sql : « Le prestataire a désormais besoin de
// contacter son client ») — order_lines.holder_phone/holder_email lui sont déjà lisibles sur son
// propre périmètre. Décision confirmée le 2026-08-26 : note enrichie pour TOUS les établissements
// PMS-backed, pas seulement ceux opérés en direct. La pièce d'identité (`DOC` de la v1) reste
// délibérément exclue : elle n'a jamais servi à contacter qui que ce soit.

export interface LobbyBookingNoteInput {
  /** Identifiant technique, toujours en tête — le seul repère fiable pour retrouver la ligne. */
  orderLineId: string;
  promoCode?: string | null;
  phone?: string | null;
  email?: string | null;
  source?: string | null;
}

// `|` est le séparateur du format : le neutraliser dans les valeurs, sinon un code promo ou une
// source contenant une barre couperait la note en deux champs fantômes. Les retours à la ligne sont
// aplatis pour la même raison (port de sanitizeComment, app legacy).
function sanitize(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[|\r\n]+/g, " ").replace(/\s+/g, " ").trim();
  return cleaned.length > 0 ? cleaned : null;
}

export function buildLobbyBookingNote(input: LobbyBookingNoteInput): string {
  const parts = [`hifago order_line ${input.orderLineId}`];

  const promo = sanitize(input.promoCode);
  if (promo) parts.push(`PROMO:${promo}`);

  const phone = sanitize(input.phone);
  if (phone) parts.push(`WA:${phone}`);

  const email = sanitize(input.email);
  if (email) parts.push(`MAIL:${email}`);

  const source = sanitize(input.source);
  if (source) parts.push(`SRC:${source}`);

  return parts.join(" | ");
}
