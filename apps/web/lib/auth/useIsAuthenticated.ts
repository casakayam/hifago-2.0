"use client";

import { useEffect, useState } from "react";
import { createClient } from "@hifago/supabase/client";
import { isRealAccount } from "@hifago/supabase/identity";

// Extrait de CoquillaVitrine.tsx (spec 27 §5) le 2026-09-14 : devenu commun à deux coquilles
// (vitrine ET tunnel, retour Jérôme — header complet restauré sur toute la zone tunnel, panier
// compris) plutôt que redupliqué. Résolu CÔTÉ CLIENT après hydratation, jamais par un layout
// serveur qui appellerait `cookies()` (rendrait toute la zone dynamique, cf. CoquillaVitrine.tsx
// pour la zone vitrine — le tunnel, lui, est déjà `noindex`/dynamique, donc sans le même enjeu de
// cache, mais garder un seul patron évite deux résolutions divergentes de « connecté »).
//
// « Connecté » EXCLUT une identité anonyme (spec 33, `isRealAccount`) — sans quoi
// `CartContext.addLine`'s `signInAnonymously()` ferait passer tout visiteur ayant juste touché le
// panier pour un compte réel dès son premier ajout.
export function useIsAuthenticated(): boolean {
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    let vivant = true;
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      if (vivant) setIsAuthenticated(isRealAccount(data.user));
    });
    // Sans cet abonnement, se connecter dans un autre onglet laisserait l'en-tête mentir jusqu'au
    // prochain rechargement complet.
    const { data: sub } = supabase.auth.onAuthStateChange((_evento, session) => {
      if (vivant) setIsAuthenticated(isRealAccount(session?.user));
    });
    return () => {
      vivant = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return isAuthenticated;
}
