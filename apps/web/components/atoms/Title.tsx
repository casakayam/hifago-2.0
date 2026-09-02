import type { ReactNode } from "react";

// Un titre dont le NIVEAU est une décision de la page, pas du composant (2026-09-01, vague 1 des
// atomes, prompts/vague1-agent-A.md §3.2). C'est la règle SEO de components/README.md rendue
// impossible à contourner par distraction : `as` est requis, jamais deviné, donc « un seul <h1> et
// une hiérarchie sans saut » se décide à l'endroit qui en a la vue d'ensemble.
//
// ⚠️ Pourquoi `size` est décorrélé de `as` : trois <h2> de l'app (les « availabilityTitle » des
// formulaires de réservation) sont en `text-sm`, deux autres en `text-lg`. Sans cette séparation,
// un développeur pressé écrit <h3> pour obtenir du petit texte et casse la hiérarchie — exactement
// ce que la règle cherche à empêcher. Le niveau est sémantique, la taille est visuelle, et ce ne
// sont pas la même décision.
//
// N'importe rien de "@hifago/ui" pour la même raison que PageShell (CLAUDE.md §11.16) : ce titre
// sera rendu par des pages Server Components.
export type TitleProps = {
  /** Requis, jamais deviné : c'est ce qui garantit un seul <h1> et une hiérarchie sans saut. */
  as: "h1" | "h2" | "h3";
  children: ReactNode;
  /** Apparence, décorrélée du niveau. Défaut dérivé de `as`. */
  size?: "lg" | "md" | "sm";
  testId?: string;
};

// Classes relevées telles quelles dans le code existant : `lg` = les six <h1> de l'app (tous
// identiques), `md` = les <h2> d'EstablishmentDetailView, `sm` = les <h2> « availabilityTitle »
// des trois formulaires de réservation.
const SIZE_CLASSES = {
  lg: "text-2xl font-semibold",
  md: "text-lg font-medium",
  sm: "text-sm font-medium",
} as const;

const DEFAULT_SIZE: Record<TitleProps["as"], keyof typeof SIZE_CLASSES> = {
  h1: "lg",
  h2: "md",
  h3: "sm",
};

export function Title({ as, children, size, testId }: TitleProps) {
  const Tag = as;
  return (
    <Tag className={SIZE_CLASSES[size ?? DEFAULT_SIZE[as]]} data-testid={testId}>
      {children}
    </Tag>
  );
}
