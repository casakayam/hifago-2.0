"use client";

import { chipVariants } from "@hifago/ui";
import { Link } from "@/i18n/navigation";
import { STYLES_PAR_TYPE, STYLE_INCONNU } from "./TypeBadge";
import type { TipoOferta } from "@/lib/catalog/tipos";

// Un onglet de navigation par type d'offre (activité/hébergement/transport/camp/evento) — 2026-09-14.
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
// ⚠️ LE STYLE VIENT DE `TypeBadge`, PAS D'UNE TABLE PARALLÈLE : `STYLES_PAR_TYPE`/`STYLE_INCONNU`
// y sont mesurés au contraste WCAG (voir son en-tête) — les recopier ici les ferait diverger au
// premier ajout de type. Le signal actif/inactif ne touche JAMAIS ce couple (color, variant) : il
// s'ajoute par-dessus (soulignement), voir plus bas.
export type TypeNavLinkProps = {
  tipo: TipoOferta;
  /** Déjà traduit — un atome ne traduit rien. */
  label: string;
  /** Chemin SANS préfixe de langue, comme tout appelant de `@/i18n/navigation`. */
  href: string;
  /** Vrai si ce type est celui de la page courante — reste un vrai lien vers lui-même (voir en-tête). */
  activo: boolean;
  testId?: string;
};

export function TypeNavLink({ tipo, label, href, activo, testId }: TypeNavLinkProps) {
  const style = STYLES_PAR_TYPE[tipo] ?? STYLE_INCONNU;
  const slots = chipVariants({ color: style.color, variant: style.variant });
  // ⚠️ Signal ADDITIF, jamais un changement de `color`/`variant` — voir l'en-tête.
  const classes = [slots.base(), activo ? "underline decoration-2 underline-offset-4" : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <Link href={href} aria-current={activo ? "page" : undefined} className={classes} data-testid={testId}>
      <span className={slots.label()} data-slot="chip-label">
        {label}
      </span>
    </Link>
  );
}
