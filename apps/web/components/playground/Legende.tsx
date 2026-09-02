import type { ReactNode } from "react";

// La légende des stories : le petit texte gris qui explique ce qu'on regarde.
//
// ⚠️ Elle était recopiée à l'octet près dans DIX fichiers de stories, écrits par cinq agents
// différents (2026-09-02). C'est le seul élément stylé commun à tout le playground, et donc le seul
// dont une divergence se verrait partout : le jour où la légende change de taille ou de jeton de
// couleur, c'était dix éditions, et la onzième story repartait de la copie d'à côté.
//
// N'importe rien de `@hifago/ui` : ce module n'entre dans le graphe d'aucun Server Component, mais
// le garder sans dépendance le rend utilisable depuis n'importe quelle story sans réfléchir.
export function Legende({ children }: { children: ReactNode }) {
  return <span className="text-xs text-muted">{children}</span>;
}
