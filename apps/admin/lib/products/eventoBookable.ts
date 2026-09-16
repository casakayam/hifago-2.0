// Les colonnes `products` qu'un evento RÉSERVABLE EN LIGNE porte (2026-09-15) — une seule
// définition, pour les deux chemins d'écriture.
//
// ⚠️ POURQUOI CE FICHIER EXISTE. Ces sept expressions étaient écrites deux fois, à l'identique :
// dans `productCreationPayload.ts` (création) et dans le bloc `if (isEditing && product)` de
// `product-form.tsx` (édition). C'est exactement le « miroir exact tenu à la main » dont l'en-tête
// de `productCreationPayload.ts` raconte qu'il avait DÉJÀ fini par diverger une fois — et il avait
// recommencé : `price_label` valait `fields.priceLabel.trim()` à la création (chaîne vide) contre
// `fields.priceLabel.trim() || null` à l'édition (null) pour la même saisie. `null` gagne, c'est ce
// que la colonne veut ; une chaîne vide n'est pas « pas de libellé ».
//
// Même patron que les autres convertisseurs du dossier (`toGroupDiscountColumns`,
// `toStayRatesColumn`, `toPriceTiersColumn`) : une entrée STRUCTURELLE étroite, jamais
// `ProductTypeFieldsState` en entier — ce module reste ainsi lisible depuis un Server Component,
// sans traîner le hook `"use client"` dans son graphe.

export type EventoBookableFields = {
  onlineBookable: boolean;
  eventoCapacityMode: "unlimited" | "metered" | "rsvp" | "";
  isFree: boolean;
  eventoPaymentMode: "online" | "on_site" | "";
  eventoOccupiesResource: boolean;
  defaultCapacity: string;
  priceLabel: string;
};

export function toEventoBookableColumns(fields: EventoBookableFields): {
  online_bookable: boolean;
  evento_capacity_mode: string | null;
  is_free: boolean;
  evento_payment_mode: string | null;
  evento_occupies_resource: boolean;
  default_capacity: number | null;
  price_label: string | null;
} {
  // Les deux modes qui comptent réellement des places. 'unlimited' n'a aucun aforo à saisir.
  const conAforo = fields.eventoCapacityMode === "metered" || fields.eventoCapacityMode === "rsvp";

  return {
    online_bookable: fields.onlineBookable,
    evento_capacity_mode: fields.onlineBookable ? fields.eventoCapacityMode || null : null,
    is_free: fields.onlineBookable ? fields.isFree : false,
    evento_payment_mode:
      fields.onlineBookable && !fields.isFree ? fields.eventoPaymentMode || null : null,
    evento_occupies_resource: fields.eventoOccupiesResource,
    // `hasDefaultCapacity` (productTypeGating.ts) N'INCLUT PAS evento — écrit ici plutôt que de
    // l'ajouter à ce gating partagé, qui ferait alors apparaître un second champ de cupo pour
    // activity/camp/transport/lodging.
    default_capacity:
      fields.onlineBookable && conAforo && fields.defaultCapacity.trim()
        ? Number(fields.defaultCapacity)
        : null,
    // Un evento réservable en ligne n'a jamais de libellé de prix libre : c'est `price_cop` qui
    // fait foi. `resolverModoReserva` (apps/web) s'appuie sur « jamais les deux en même temps ».
    price_label: fields.onlineBookable ? null : fields.priceLabel.trim() || null,
  };
}
