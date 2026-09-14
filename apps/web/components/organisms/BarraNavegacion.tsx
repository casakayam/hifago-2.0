import { Migas, type MigaItem } from "@/components/molecules/Migas";
import { TypeNavLink } from "@/components/atoms/TypeNavLink";
import { SelectorTipoCompacto } from "./SelectorTipoCompacto";
import type { TipoOferta } from "@/lib/catalog/tipos";
import type { Locale } from "@/messages";

// La barre commune fil d'Ariane + sélecteur de type — 2026-09-14, décision de Jérôme (« mixer » le
// menu de type avec `Migas`) : UN seul composant, réutilisé sur la home (qui n'a aujourd'hui aucun
// fil) ET sur les listings/fiches (qui avaient `Migas` seul), à poids visuel identique partout.
//
// ⚠️ PAS DE `"use client"` ICI, et ce n'est pas un oubli. Ce fichier n'importe RIEN directement de
// `@hifago/ui` — seulement `Migas` et `TypeNavLink`, qui portent CHACUN déjà leur propre `"use
// client"`. C'est exactement le même principe que les `page.tsx` (Server Components) qui importent
// déjà `<Migas />` directement aujourd'hui sans porter `"use client"` eux-mêmes : la frontière
// client est établie par les feuilles, pas par ce composant de composition (règle
// `components/README.md` : « n'importer rien de `@hifago/ui` » est la forme valide dès que c'est
// suffisant, pas seulement un raccourci).
//
// ⚠️ DEUX `<nav>` DISTINCTS, jamais fusionnés — contrainte dure, pas un choix de style :
// `apps/web/e2e/categorias.spec.ts` compte un nombre EXACT de `a[href]` dans
// `[data-testid="migas"]` ; si les onglets de type finissaient dans ce même repère, cette
// assertion e2e déjà en place casserait. `testId="migas"` reste donc posé en dur sur le fil
// (jamais paramétrable), et le sélecteur de type porte son propre testid et son propre
// `aria-label` (`tiposEtiqueta`, distinct de `migasEtiqueta`) — deux repères de navigation avec le
// même nom accessible sur une page casseraient la navigation par repères d'un lecteur d'écran.
//
// ⚠️ DEUX PRÉSENTATIONS DU MÊME SÉLECTEUR SELON LA LARGEUR — constaté en réel le 2026-09-14 à
// 390×844 (Jérôme) : la rangée des 5 onglets déborde et se coupe net au bord de l'écran sans
// indice qu'elle défile, et sur un listing le type actif se répète TROIS fois en quelques lignes
// (le fil, l'onglet actif, le `<h1>`). Sous `md`, `SelectorTipoCompacto` remplace la rangée par un
// seul déclencheur ; à partir de `md`, la rangée d'onglets reste (5 chips tiennent largement sur
// une largeur de bureau, aucun débordement mesuré). Ce n'est PAS le `hidden md:block` que
// `.claude/rules/ui.md` interdit : les deux présentations exposent les 5 MÊMES liens dans le HTML
// servi (voir `SelectorTipoCompacto`, qui reprend le motif « toujours rendu, seulement masqué » de
// `LanguageSwitcher`) — on réorganise le même contenu, on ne le retire pas pour le mobile.
export type BarraNavegacionProps = {
  /** Items déjà construits pour Migas — aucune transformation ici. */
  migas: MigaItem[];
  /** aria-label du `<nav>` du fil. */
  migasEtiqueta: string;
  /** Transmis uniquement à `Migas` — `TypeNavLink` n'en a pas besoin (le Link localisé résout la
   *  locale tout seul, contrairement au préfixage manuel de `Migas`). */
  locale: Locale;
  /** Toujours les 5 types, dans l'ordre — jamais un sous-ensemble. */
  tipos: { tipo: TipoOferta; label: string; href: string }[];
  /** Absent sur la home : aucun type n'y est "le" sujet de la page. */
  tipoActivo?: TipoOferta;
  /** aria-label du `<nav>` des onglets. */
  tiposEtiqueta: string;
};

export function BarraNavegacion({
  migas,
  migasEtiqueta,
  locale,
  tipos,
  tipoActivo,
  tiposEtiqueta,
}: BarraNavegacionProps) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <Migas items={migas} etiqueta={migasEtiqueta} locale={locale} testId="migas" />

      {/* Desktop (>= md) : la rangée d'onglets. `overflow-x-auto` reste en filet défensif — un
          libellé traduit inhabituellement long ne doit jamais faire déborder la PAGE — mais ne se
          déclenche pas en usage normal à cette largeur. Pas de `tabIndex`/`role="region"` ajouté :
          cette échappatoire de `.claude/rules/ui.md` ne vaut que si le conteneur ne contient AUCUN
          élément focalisable, ce qui n'est pas le cas ici (les onglets sont de vrais liens). */}
      <nav aria-label={tiposEtiqueta} data-testid="selector-tipos" className="hidden gap-2 overflow-x-auto md:flex">
        {tipos.map(({ tipo, label, href }) => (
          <TypeNavLink
            key={tipo}
            tipo={tipo}
            label={label}
            href={href}
            activo={tipo === tipoActivo}
            testId={`selector-tipos-${tipo}`}
          />
        ))}
      </nav>

      {/* Mobile (< md) : le déclencheur compact — voir l'en-tête. */}
      <div className="md:hidden">
        <SelectorTipoCompacto
          tipos={tipos}
          tipoActivo={tipoActivo}
          etiqueta={tiposEtiqueta}
          testId="selector-tipos-compacto"
        />
      </div>
    </div>
  );
}
