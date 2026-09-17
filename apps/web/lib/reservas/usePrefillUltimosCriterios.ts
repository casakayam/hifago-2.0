"use client";

import { useEffect, useRef } from "react";
import { leerUltimosCriterios } from "@/lib/catalog/ultimosCriterios";
import type { Criterios } from "@/lib/catalog/tipos";

// Spec 28 §4 point 3 (validée le 2026-09-07) : « le calendrier de la fiche se pré-remplit depuis
// la mémoire du navigateur ». Partagé par les quatre formulaires de réservation ET par le lien de
// retour au catalogue de `FichaProducto` — la seule chose qu'ils ont en commun est CE moment (une
// fois, au montage), et c'est la seule lecture « au montage » de cette mémoire dans l'app. La validation elle-même (bornes,
// disponibilité, porJourDepart/byDate/plage) reste entièrement dans `aplicar`, à charge de chaque
// formulaire, qui la porte déjà pour son propre clic réel. Si `aplicar` ne fait rien, le filet
// reste « pas de pré-remplissage », identique au comportement d'avant ce hook.
//
// ⚠️ UNE SEULE FOIS, jamais rejoué : la garde vient de `hechoRef`, pas du tableau de dépendances —
// `aplicar` n'a donc pas besoin d'être stable (`useCallback`), un effet qui se redéclenche retombe
// sur le premier `if`. Même patron que `loadedMonthsRef` de `LodgingReservationForm.tsx`.
export function usePrefillUltimosCriterios(aplicar: (criterios: Criterios) => void): void {
  const hechoRef = useRef(false);
  useEffect(() => {
    if (hechoRef.current) return;
    hechoRef.current = true;
    aplicar(leerUltimosCriterios());
  }, [aplicar]);
}
