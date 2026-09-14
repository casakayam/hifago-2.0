"use client";

import type { ReactNode } from "react";
import { SiteHeader } from "@/components/organisms/SiteHeader";
import { useIsAuthenticated } from "@/lib/auth/useIsAuthenticated";

// Retour Jérôme (2026-09-14) — header COMPLET (menu + icône panier) restauré sur toute la zone
// tunnel : la décision « en-tête réduit, aucune fuite pendant le paiement » documentée dans
// layout.tsx est explicitement abandonnée POUR LE HEADER. Le PIED de page, lui, reste absent — sa
// justification est distincte et n'a pas été remise en cause (l'email de confirmation reste le
// seul canal de suivi d'un invité ici, `SiteFooter` n'en ajouterait aucun de plus).
//
// Même patron que CoquillaVitrine.tsx (isAuthenticated résolu côté client après hydratation,
// jamais par le layout serveur), extrait en hook partagé (`useIsAuthenticated`) plutôt que
// redupliqué — cette zone en est désormais le second consommateur.
export function CoquillaTunel({ children }: { children: ReactNode }) {
  const isAuthenticated = useIsAuthenticated();

  return (
    <>
      <SiteHeader isAuthenticated={isAuthenticated} />
      {children}
    </>
  );
}
