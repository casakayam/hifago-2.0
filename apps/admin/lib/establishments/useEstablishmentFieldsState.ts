"use client";

import { useState } from "react";

// Miroir de useProductTypeFieldsState.ts (lib/products/), extrait le 2026-09-17 (revue de
// packaging admin) : NewEstablishmentForm.tsx et EstablishmentEditBlock.tsx réimplémentaient
// chacun leur propre state à la main (avec `buildDescription()` dupliqué mot pour mot entre les
// deux) — exactement la dérive déjà survenue côté produit avant l'extraction de son hook.
//
// `nombre` reste HORS de ce hook, comme `name`/`description` restent hors de
// useProductTypeFieldsState côté produit — possédé par le composant appelant, jamais localisé
// (un nom d'établissement est un nom propre, décision Jérôme, spec 03 §3). La description, elle,
// entre dans le hook : elle porte un vrai state structuré (ES/EN + bascule de langue affichée),
// pas un simple champ.
export type EstablishmentFieldsInit = {
  descriptionEs?: string | null;
  descriptionEn?: string | null;
  address?: string | null;
  // `number` : origine directe d'une ligne `establishments` (NewEstablishmentForm.tsx n'a pas de
  // valeur initiale, mais un futur appelant côté colonnes DB en aurait une). `string` : origine
  // déjà sérialisée par l'appelant (EstablishmentEditBlock.tsx reçoit `initialLat`/`initialLon` en
  // string depuis page.tsx) — accepté SANS repasser par Number() puis String(), qui arrondirait/
  // reformaterait une valeur déjà correcte pour l'affichage (ex. perdrait des zéros de fin).
  lat?: number | string | null;
  lon?: number | string | null;
  operatedDirectly?: boolean;
  // Équipements structurés (migration 20260917110000) — stagés à la CRÉATION uniquement, même
  // patron que amenityIds côté produit (ProductTypeFieldsInit) : rattachés après l'insert, jamais
  // consommés par EstablishmentEditBlock.tsx (EstablishmentAmenitiesBlock reprend la main en
  // édition, à sauvegarde immédiate).
  amenityIds?: string[];
};

export function useEstablishmentFieldsState(init: EstablishmentFieldsInit = {}) {
  const [operatedDirectly, setOperatedDirectly] = useState(init.operatedDirectly ?? false);
  const [descriptionEs, setDescriptionEs] = useState(init.descriptionEs ?? "");
  const [descriptionEn, setDescriptionEn] = useState(init.descriptionEn ?? "");
  const [descriptionLang, setDescriptionLang] = useState<"es" | "en">("es");
  const [address, setAddress] = useState(init.address ?? "");
  const [lat, setLat] = useState(init.lat != null ? String(init.lat) : "");
  const [lon, setLon] = useState(init.lon != null ? String(init.lon) : "");
  const [selectedAmenityIds, setSelectedAmenityIds] = useState<string[]>(init.amenityIds ?? []);

  return {
    operatedDirectly, setOperatedDirectly,
    descriptionEs, setDescriptionEs,
    descriptionEn, setDescriptionEn,
    descriptionLang, setDescriptionLang,
    address, setAddress,
    lat, setLat,
    lon, setLon,
    selectedAmenityIds, setSelectedAmenityIds,
  };
}

export type EstablishmentFieldsState = ReturnType<typeof useEstablishmentFieldsState>;
