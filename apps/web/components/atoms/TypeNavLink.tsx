import { Link } from "@/i18n/navigation";

// Un onglet de navigation par type d'offre (activité/hébergement/transport/camp/evento) — 2026-09-14,
// restylé en texte simple le 2026-09-15 (voir `SelectorTipo.tsx` : capture de l'app legacy montrée
// par Jérôme, ligne `cat-1` de la grille de suivi bêta — "je veux les onglets sur mobile").
//
// ⚠️ CE N'EST PAS `Migas`, et la différence est intentionnelle, pas un oubli. `Migas` (fil
// d'Ariane) ne pose jamais de `href` sur le DERNIER élément parce qu'il représente la page
// courante — un fil d'Ariane décrit un CHEMIN parcouru, pas des destinations. Un menu de
// navigation PERSISTANT est l'inverse : ses entrées restent TOUTES cliquables, y compris celle du
// type actif, même convention que les onglets « Code / Issues / Pull requests » de GitHub (cliquer
// l'onglet actif recharge cet onglet, il ne devient jamais un `<span>` inerte). Un futur agent qui
// rapprocherait ce composant de `Migas` pourrait être tenté de retirer le `href` sur `activo` en
// pensant appliquer la même règle — ce serait l'appliquer au mauvais endroit.
//
// ⚠️ POURQUOI LE `Link` DE `@/i18n/navigation` ET PAS `Tabs`/`ToggleButtonGroup` DE HEROUI (qui
// acceptent pourtant un `href` par item) : ces primitives react-aria délèguent la navigation
// client d'un `href` à un `RouterProvider` react-aria — ABSENT de la version installée dans ce
// dépôt. Sans lui, cliquer l'item déclenche un `<a href>` natif, donc un rechargement COMPLET de
// page. C'est exactement le problème déjà constaté sur `Migas` (voir
// `FichaProducto.tsx` autour de la ligne 94) : ce rechargement vide `CartContext`, tenu en
// mémoire. Passer par le `Link` de `@/i18n/navigation` (comme tout lien interne du dépôt) navigue
// côté client nativement et évite le bug par construction, sans dépendre d'un `RouterProvider`.
//
// ⚠️ PLUS DE COULEUR PAR TYPE (retirée avec `chipVariants`/`TypeBadge`) : le seul signal actif est
// le soulignement, déjà additif avant ce changement — il ne s'ajoute plus par-dessus une couleur,
// il reste simplement seul. `TypeBadge.tsx` garde ses couleurs pour les cartes de catalogue, un
// contexte où le type n'est pas déjà répété par le libellé d'une nav.
//
// ⚠️ PAS DE `"use client"` ICI : ce fichier n'importe plus que `Link` (déjà client lui-même) —
// même principe que `Migas`, importable tel quel par un Server Component. `TypeNavLink` vit
// aujourd'hui sous `SelectorTipo` (client), mais rien ne l'y oblige structurellement.
export type TypeNavLinkProps = {
  /** Déjà traduit — un atome ne traduit rien. */
  label: string;
  /** Chemin SANS préfixe de langue, comme tout appelant de `@/i18n/navigation`. */
  href: string;
  /** Vrai si ce type est celui de la page courante — reste un vrai lien vers lui-même (voir en-tête). */
  activo: boolean;
  testId?: string;
};

export function TypeNavLink({ label, href, activo, testId }: TypeNavLinkProps) {
  const classes = [
    "inline-flex min-h-11 items-center px-1 text-sm font-medium hover:underline focus-visible:status-focused",
    activo ? "underline decoration-2 underline-offset-4" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <Link href={href} aria-current={activo ? "page" : undefined} className={classes} data-testid={testId}>
      {label}
    </Link>
  );
}
