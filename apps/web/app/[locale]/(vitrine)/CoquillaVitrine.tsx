"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createClient } from "@hifago/supabase/client";
import { SiteHeader } from "@/components/organisms/SiteHeader";
import { SiteFooter } from "@/components/organisms/SiteFooter";

// La coquille visible de la zone vitrine (spec 27 §5). Elle existe pour UNE raison précise, et
// c'est elle qui décide de la vitesse du site :
//
// ⚠️ `SiteHeader` doit savoir si le visiteur est connecté. Si le layout serveur lisait la session,
// il appellerait `cookies()` — ce qui rend TOUTE la zone dynamique, y compris les fiches produit et
// établissement que la spec 27 veut cacheables (§8). L'état de connexion est donc résolu ICI, côté
// client, après hydratation : le HTML rendu par le serveur ne dépend d'aucun cookie, et il peut
// être mis en cache.
//
// Conséquence assumée : au premier rendu l'en-tête affiche « Iniciar sesión », puis bascule sur
// « Mi cuenta » une fraction de seconde plus tard pour un visiteur connecté. C'est le prix de la
// cacheabilité, et c'est le bon prix — la valeur d'une page de catalogue ne dépend pas de qui la
// regarde.
//
// `SiteHeader` n'est PAS modifié : il garde sa prop `isAuthenticated`. La règle du dépôt veut qu'un
// composant existant ne soit pas touché au milieu d'un lot d'écran
// (`apps/web/components/README.md`) — on l'alimente autrement, on ne le réécrit pas.

export function CoquillaVitrine({ children }: { children: ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    let vivant = true;
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      if (vivant) setIsAuthenticated(Boolean(data.user));
    });
    // Sans cet abonnement, se connecter dans un autre onglet laisserait l'en-tête mentir jusqu'au
    // prochain rechargement complet.
    const { data: sub } = supabase.auth.onAuthStateChange((_evento, session) => {
      if (vivant) setIsAuthenticated(Boolean(session?.user));
    });
    return () => {
      vivant = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return (
    <>
      <SiteHeader isAuthenticated={isAuthenticated} />
      {children}
      <SiteFooter />
    </>
  );
}
