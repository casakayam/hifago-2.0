// Les colonnes `products` qu'un TRANSPORT porte pour informer le voyageur — migration
// 20260916150000, demande Jérôme du 2026-09-16 : « pouvoir rajouter une plage horaire de Xh à Xh ;
// quantité ; ainsi que lieux (maps de départ et d'arrivée) — c'est à titre informatif pour la
// personne qui réserve ».
//
// ⚠️ INFORMATIF, ET C'EST TOUT. Ces 9 colonnes ne sont lues par AUCUNE RPC. La fenêtre de départs
// n'est pas un créneau réservable (surtout pas `product_slot_rules`, qui rendrait `create_order`
// bloquant via le refus `slot_required` — spec 18 §0), et `seatsPerDeparture` ne décrémente rien :
// le cupo réel d'un transport reste `products.default_capacity`, par date, décrémenté sous verrou
// par `create_order`. Ne jamais câbler ces champs à une décision de vente.
//
// Même patron que les autres convertisseurs du dossier (`toEventoBookableColumns`,
// `toGroupDiscountColumns`, `toSlotRuleRows`) : UNE seule définition partagée par les deux chemins
// d'écriture (création via productCreationPayload.ts, édition via product-form.tsx), parce que le
// « miroir exact tenu à la main » a déjà divergé deux fois dans ce dossier (cf. l'en-tête de
// `eventoBookable.ts`). Entrée STRUCTURELLE étroite, jamais `ProductTypeFieldsState` en entier —
// ce module reste ainsi lisible depuis un Server Component, sans traîner `"use client"` dans son
// graphe.
//
// Le lieu de DÉPART a ses propres colonnes plutôt que de réutiliser le trio générique
// `address`/`lat`/`lon` (arbitrage Jérôme) : un trajet a DEUX extrémités, et une seule convention
// de nommage doit porter un seul concept. Le trio générique n'est plus ni exposé ni écrit pour ce
// type — cf. l'amendement daté du 2026-09-16 de `docs/specs/14-admin-transporte.md` §4.

export type TransportInfoFields = {
  /**
   * Téléphone WhatsApp du transporteur, E.164 — OPTIONNEL (décision Jérôme du 2026-09-17 : « non
   * obligatoire le num et sinon c'est celui de hifago »). Laissé vide, la fiche publique retombe
   * sur le WhatsApp de Hifago : c'est ce repli qui garantit qu'un transport a toujours un contact,
   * donc qu'il n'affiche jamais de calendrier.
   */
  contactPhone: string;
  firstDepartureTime: string;
  lastDepartureTime: string;
  seatsPerDeparture: string;
  departureAddress: string;
  departureLat: string;
  departureLon: string;
  arrivalAddress: string;
  arrivalLat: string;
  arrivalLon: string;
};

export function emptyTransportInfo(): TransportInfoFields {
  return {
    contactPhone: "",
    firstDepartureTime: "",
    lastDepartureTime: "",
    seatsPerDeparture: "",
    departureAddress: "",
    departureLat: "",
    departureLon: "",
    arrivalAddress: "",
    arrivalLat: "",
    arrivalLon: "",
  };
}

// Miroir exact des CHECK SQL de la migration 20260916150000 — un message ici, un refus en base :
// l'écran ne doit jamais laisser passer ce que la base rejetterait, et la base ne doit jamais faire
// confiance à l'écran (CLAUDE.md §11.20). Tout vide est un état VALIDE : ces champs sont tous
// optionnels, même discipline que « 0 tag » ou « aucune borne min/max » (spec 08 §8).
export function validateTransportInfo(fields: TransportInfoFields): string | null {
  const firstEmpty = fields.firstDepartureTime.trim() === "";
  const lastEmpty = fields.lastDepartureTime.trim() === "";

  // products_transport_departure_pair
  if (firstEmpty !== lastEmpty) {
    return "Completa la primera y la última salida juntas, o deja ambas vacías.";
  }
  // products_transport_departure_order — `>=` et non `>` : une seule salida (first = last) est le
  // cas NORMAL d'un transfert à heure fixe, pas une erreur de saisie. Comparaison de chaînes
  // "HH:MM" valide (zero-padded par <input type="time">), même convention que validateSlotRules.
  if (!firstEmpty && fields.lastDepartureTime < fields.firstDepartureTime) {
    return "La última salida no puede ser anterior a la primera.";
  }

  // products_transport_seats_positive
  if (fields.seatsPerDeparture.trim() !== "") {
    const seats = Number(fields.seatsPerDeparture);
    if (!Number.isInteger(seats) || seats < 1) {
      return "Las plazas por salida deben ser un número entero de al menos 1.";
    }
  }

  // products_transport_contact_phone_e164 — même forme que establishments_contact_phone_e164, donc
  // `urlDeContacto()` s'applique tel quel côté vitrine sans rien deviner.
  if (fields.contactPhone.trim() !== "" && !/^\+[1-9][0-9]{7,14}$/.test(fields.contactPhone.trim())) {
    return "El teléfono debe estar en formato internacional, por ejemplo +573001112233.";
  }

  // products_transport_departure_coords_pair / products_transport_arrival_coords_pair
  for (const [lat, lon, lugar] of [
    [fields.departureLat, fields.departureLon, "salida"],
    [fields.arrivalLat, fields.arrivalLon, "llegada"],
  ] as const) {
    const latEmpty = lat.trim() === "";
    const lonEmpty = lon.trim() === "";
    if (latEmpty !== lonEmpty) {
      return `Completa la latitud y la longitud del lugar de ${lugar} juntas, o deja ambas vacías.`;
    }
    if (!latEmpty && (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lon)))) {
      return `Las coordenadas del lugar de ${lugar} deben ser números.`;
    }
  }

  return null;
}

// Les heures traversent la frontière comme des chaînes "HH:MM" OPAQUES, jamais reconstruites en
// objet Date : un `new Date(\`${date}T${heure}\`)` serait interprété dans le fuseau du NAVIGATEUR
// visiteur et pas celui de Bogota (spec 18 §0, CLAUDE.md §11.20). Rien ici ne parse une heure —
// c'est volontaire, et c'est ce que prouve le test à TZ=Europe/Paris.
export function toTransportInfoColumns(fields: TransportInfoFields): {
  transport_contact_phone: string | null;
  transport_first_departure_time: string | null;
  transport_last_departure_time: string | null;
  transport_seats_per_departure: number | null;
  transport_departure_address: string | null;
  transport_departure_lat: number | null;
  transport_departure_lon: number | null;
  transport_arrival_address: string | null;
  transport_arrival_lat: number | null;
  transport_arrival_lon: number | null;
} {
  const texto = (valeur: string) => valeur.trim() || null;
  const numero = (valeur: string) => (valeur.trim() ? Number(valeur) : null);

  return {
    transport_contact_phone: texto(fields.contactPhone),
    transport_first_departure_time: texto(fields.firstDepartureTime),
    transport_last_departure_time: texto(fields.lastDepartureTime),
    transport_seats_per_departure: numero(fields.seatsPerDeparture),
    transport_departure_address: texto(fields.departureAddress),
    transport_departure_lat: numero(fields.departureLat),
    transport_departure_lon: numero(fields.departureLon),
    transport_arrival_address: texto(fields.arrivalAddress),
    transport_arrival_lat: numero(fields.arrivalLat),
    transport_arrival_lon: numero(fields.arrivalLon),
  };
}
