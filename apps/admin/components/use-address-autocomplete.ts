"use client";

import { useEffect, useRef, type RefObject } from "react";
import {
  mountAddressAutocomplete,
  type AddressAutocompleteOptions,
  type PlaceSelection,
} from "@/components/address-autocomplete";

// Extrait du patron `useRef` + `useEffect(() => mountAddressAutocomplete(...), [])` dupliqué à 5
// endroits (revue de packaging admin, 2026-09-17) : product-type-fields/LocationAndTagsFields.tsx,
// product-type-fields/TransportFields.tsx (×2, départ/arrivée), NewEstablishmentForm.tsx,
// EstablishmentEditBlock.tsx. Usage double produit/établissement PROUVÉ dans `apps/admin` — aucune
// raison de migrer vers `packages/` (CLAUDE.md §2.1 : preuve d'usage, jamais une anticipation).
// `mountAddressAutocomplete` lui-même ne bouge pas, cette couche n'ajoute qu'un appel.
export function useAddressAutocomplete(
  onPlaceSelected: (place: PlaceSelection) => void,
  options: AddressAutocompleteOptions = {},
): RefObject<HTMLDivElement | null> {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    return mountAddressAutocomplete(container, onPlaceSelected, options);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onPlaceSelected/options sont stables côté appelant (setters directs ou objet littéral figé) ; les redéclarer en dépendance remonterait le widget à chaque frappe.
  }, []);

  return containerRef;
}
