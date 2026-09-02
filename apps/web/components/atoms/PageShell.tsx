import type { ReactNode } from "react";

// La coquille d'une page publique : son unique <main>, et sa largeur. Créée le 2026-09-01
// (vague 1 des atomes, prompts/vague1-agent-A.md §3.1) parce que ce gabarit était copié à
// l'identique dans les huit pages de app/[locale]/**.
//
// Trois écarts assumés par rapport au copier-coller relevé ce jour-là :
//   1. `gap-6` partout. Le code existant portait `gap-4` sur deux pages (fiche produit,
//      établissement) et `gap-6` sur les six autres : une dérive, pas une décision. D'où aussi
//      l'ABSENCE de prop `gap` — exposer une prop pour une dérive accidentelle, c'est la figer.
//   2. `p-6 sm:p-8` au lieu de `p-8` partout : 64 px de marge horizontale sur un écran de 390 px,
//      c'est un sixième de la largeur. Mobile d'abord, comme l'exige components/README.md.
//   3. Le `text-center` de verify-email n'est PAS repris dans `centered` : c'est l'alignement du
//      contenu de cette page-là, pas la coquille.
//
// ⚠️ Ne rend NI <h1>, NI <header>, NI <footer>. Un titre rendu par la coquille est la faute qui
// produit trois <h1> par page : le niveau est porté par Title (prop `as`) et décidé par la page.
// <header>/<footer> iront dans app/[locale]/layout.tsx en vague 2 (SiteHeader/SiteFooter) — pas de
// props `header`/`footer` ici, le README interdit l'anticipation.
//
// ⚠️ Ce fichier n'importe RIEN de "@hifago/ui", volontairement : plusieurs des pages qui
// consommeront cette coquille sont des Server Components, et faire entrer le barrel dans leur
// graphe de modules fait planter `next build` (CLAUDE.md §11.16). Les variantes sont des classes
// fixes, `cn` n'a donc rien à fusionner ici.
export type PageShellProps = {
  children: ReactNode;
  /** Pas de valeur par défaut : chaque page choisit explicitement sa largeur. */
  variant: "large" | "narrow" | "centered";
  testId?: string;
};

// Chaînes littérales complètes, jamais construites par concaténation : Tailwind v4 scanne ce
// fichier par glob (@source dans app/globals.css) et ne voit que des classes écrites en toutes
// lettres.
const VARIANT_CLASSES: Record<PageShellProps["variant"], string> = {
  // accueil, établissement
  large: "mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 p-6 sm:p-8",
  // fiche produit, checkout, commandes
  narrow: "mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-6 sm:p-8",
  // login, signup, verify-email
  centered: "flex flex-1 flex-col items-center justify-center gap-6 p-6 sm:p-8",
};

export function PageShell({ children, variant, testId }: PageShellProps) {
  return (
    <main className={VARIANT_CLASSES[variant]} data-testid={testId}>
      {children}
    </main>
  );
}
