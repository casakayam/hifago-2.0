// Le contact WhatsApp, côté vitrine — SANS aucune dépendance à Supabase, et c'est tout l'intérêt
// de ce module.
//
// ⚠️ POURQUOI IL EXISTE. `urlDeContacto` vivait dans `lib/catalog/establecimiento.ts`, à côté de
// requêtes Supabase : l'importer depuis un composant `"use client"` embarque tout `lib/catalog/` —
// et `createPublicClient` — dans le bundle navigateur. C'est l'angle mort nommé en tête de
// `scripts/check-data-layer.sh`, déjà contourné à la main deux fois (`FichaEstablecimiento.tsx`,
// puis le commentaire d'`establishmentContactUrl` dans `lib/orders/getOrderByToken.ts` qui dit
// « ne pas en faire une seconde occurrence »). Ici la fonction est isolée, donc importable de
// partout sans ce risque. `lib/catalog/establecimiento.ts` la réexporte : aucun import existant
// n'est cassé.

/**
 * Le WhatsApp de Hifago, en E.164 — le repli quand un prestataire n'a pas donné le sien.
 *
 * ⚠️ MÊME NUMÉRO que celui du pied de page (`components/organisms/SiteFooter.tsx`), qui pointe
 * désormais ici plutôt que d'en garder sa propre copie. Un numéro de contact public qui existe en
 * deux exemplaires finit par en avoir deux différents.
 */
export const TELEFONO_HIFAGO = "+573215764841";

/**
 * L'URL du bouton de contact, depuis un numéro E.164.
 *
 * ⚠️ Les contraintes `establishments_contact_phone_e164` et
 * `products_transport_contact_phone_e164` garantissent la forme en base ; cette fonction ne fait
 * que retirer le `+`, que `wa.me` n'accepte pas. Elle ne devine RIEN — un composant qui déduirait
 * « c'est un numéro, donc WhatsApp » ferait de la logique métier dans du rendu.
 */
export function urlDeContacto(telefonoE164: string): string {
  return `https://wa.me/${telefonoE164.replace(/^\+/, "")}`;
}

/** Le lien WhatsApp de Hifago, prêt à poser sur un `href`. */
export const URL_WHATSAPP_HIFAGO = urlDeContacto(TELEFONO_HIFAGO);
