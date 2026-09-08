"use client";

import { Breadcrumbs } from "@hifago/ui";
import type { Locale } from "@/messages";

// Le fil d'Ariane des pages de listing et de catégorie (2026-09-08, spec 29 §5a — décision 13).
//
// ⚠️ POURQUOI IL EXISTE. Un visiteur qui arrive par un moteur sur `/es/actividades/kayak` est dans
// un cul-de-sac : rien sur la page ne lui dit qu'il existe d'autres catégories, ni où il se trouve.
// Le menu du site et le bouton « précédent » ne remplacent pas ça — le second suppose qu'il vient
// d'ailleurs sur le site, ce qui est faux par construction pour une arrivée depuis Google.
//
// ⚠️ `"use client"` est imposé par l'import de `@hifago/ui` : le barrel tire tout son graphe et
// fait planter `next build` dès qu'il atteint un Server Component (CLAUDE.md §11.16). Ça ne coûte
// RIEN au référencement — un composant client est quand même pré-rendu en HTML par Next, donc le
// fil est bien dans la page servie au crawler. Le seul coût réel est l'hydratation, marginale pour
// trois liens.
//
// ⚠️ ET IL NE POSE PAS SON PROPRE JSON-LD. Le nœud `BreadcrumbList` est rendu par la PAGE
// (`buildBreadcrumbJsonLd`, déjà utilisé par les deux fiches), côté serveur : règle SEO 6 du dépôt
// — le JSON-LD se décrit dans `page.tsx`, jamais dans un composant de présentation. Ce composant
// affiche ; la page décrit. Les deux disent la même chose, et c'est la page qui garantit qu'ils ne
// divergent pas, puisqu'elle construit les deux depuis la même liste.

export type MigaItem = {
  /** Déjà traduit, ou déjà résolu depuis le contenu partenaire — une molécule ne traduit rien. */
  nombre: string;
  /**
   * Chemin SANS préfixe de langue (`/actividades`). Absent sur le DERNIER élément : la page
   * courante n'est pas un lien vers elle-même.
   */
  href?: string;
};

// ⚠️ Constaté au rendu (2026-09-08) et laissé tel quel : HeroUI rend le DERNIER élément en
// `<span role="link" aria-disabled="true" aria-current="page">`. Le `aria-current` est correct et
// posé tout seul — c'est ce qui compte. Le `role="link"` sur la page courante est discutable (un
// lecteur d'écran annoncera « lien désactivé »), mais c'est le comportement du design system : on
// le documente, on ne le contourne pas avec un composant parallèle.

export type MigasProps = {
  items: MigaItem[];
  /** Le nom accessible du `<nav>` — déjà traduit. Un repère de navigation sans nom n'en est pas un. */
  etiqueta: string;
  /** ⚠️ Sert à préfixer les `href` à la main — voir ci-dessous. */
  locale: Locale;
  testId?: string;
};

export function Migas({ items, etiqueta, locale, testId }: MigasProps) {
  return (
    // ⚠️ LE `<nav>` EST À NOUS, ET IL EST OBLIGATOIRE. Vérifié au rendu réel le 2026-09-08 :
    // `Breadcrumbs` de HeroUI rend un `<ol>` NU, pas un repère de navigation — et un `<ol>` porteur
    // d'un `aria-label` n'est pas un landmark ARIA. Sans cette enveloppe, le fil d'Ariane
    // disparaîtrait de la liste des repères de la page pour un lecteur d'écran, alors que c'est
    // exactement le public pour qui « où suis-je » compte le plus. Règle SEO 7 du dépôt : les
    // landmarks sont du HTML, pas une option de composant.
    //
    // Ce n'est pas un second design system : c'est l'élément sémantique que le motif WAI-ARIA
    // exige autour d'un fil d'Ariane. Le style, lui, reste entièrement celui de HeroUI.
    <nav aria-label={etiqueta} data-testid={testId}>
      <Breadcrumbs>
        {items.map((item) => (
          <Breadcrumbs.Item
            // Le chemin est unique dans un fil d'Ariane ; le dernier élément n'en a pas, mais il
            // est seul dans ce cas — son nom suffit à le distinguer.
            key={item.href ?? item.nombre}
            // ⚠️ LE PRÉFIXE DE LANGUE EST POSÉ À LA MAIN, et ce n'est pas un oubli du `Link`
            // localisé. `Breadcrumbs.Item` rend un `<a href>` NATIF (il étend `LinkProps` de
            // react-aria), pas le `Link` de `@/i18n/navigation` : sans ce préfixe, chaque lien
            // partirait sur une URL sans langue que le proxy devrait rattraper par une redirection
            // qui redevine la locale depuis un cookie — au lieu de garder celle de la page lue.
            // Rien ne casse visiblement, et c'est exactement le problème. Même contrainte et même
            // solution que les options de `SearchBar` (spec 28 §10ter).
            href={item.href ? `/${locale}${item.href}` : undefined}
          >
            {item.nombre}
          </Breadcrumbs.Item>
        ))}
      </Breadcrumbs>
    </nav>
  );
}
