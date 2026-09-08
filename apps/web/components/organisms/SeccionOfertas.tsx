import { Link } from "@/i18n/navigation";
import { Title } from "@/components/atoms/Title";
import { TarjetaOferta } from "@/components/molecules/TarjetaOferta";
import type { Locale } from "@/messages";
import type { TarjetaOferta as OfertaTarjeta } from "@/lib/catalog/tipos";

// Une section de l'accueil : un titre, ses cartes, et le lien qui mène au listing complet
// (2026-09-08, lot D — docs/specs/28-vitrine-accueil-et-resultats.md §5 « Une section » et §7).
//
// POURQUOI CE COMPOSANT EXISTE. L'accueil en rend CINQ (activités, alojamientos, transportes,
// camps, eventos — l'ordre de `ORDEN_SECCIONES`), et les pages de listing en rendront une seule.
// Écrire cinq fois la même grille dans `page.tsx` mettrait la règle « 1 colonne, 2 à `md`, 3 à
// `lg` » à cinq endroits, et le lien « Ver más » avec elle. La spec 28 le nomme pour cette raison
// même, dans sa liste des composants manquants du lot.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// ⚠️ PAS DE "use client" ICI, ET C'EST LA DÉCISION STRUCTURANTE DU FICHIER
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// Cette section n'a AUCUN état, aucun gestionnaire d'événement, et ne traduit rien : tous ses
// libellés (`titulo`, `labelVerMas`) lui arrivent déjà traduits, parce que seule la page sait que
// le « Ver más » des activités mène à un index de tags (spec 29) et porte donc un autre mot.
//
// Elle n'importe donc RIEN de `@hifago/ui` — pas même `cn` — et reste un Server Component
// (CLAUDE.md §11.16, `apps/web/components/README.md`). Conséquence directe et voulue : le HTML de
// cinq sections × huit cartes est SERVI, pas hydraté — c'est lui que Google indexe, et c'est le
// contenu principal de la page d'accueil. Poser `"use client"` ici ferait descendre toute la
// section dans le navigateur pour zéro interactivité ; seule la carte en a besoin, et c'est elle
// qui le porte. Le test `SeccionOfertas.test.tsx` vérifie cette absence sur le texte du fichier :
// une règle que rien ne vérifie n'est pas une règle (CLAUDE.md §11.20).
export type SeccionOfertasProps = {
  /** Déjà traduit. */
  titulo: string;
  tituloAs?: "h2";
  /** Critères de recherche déjà inclus. */
  hrefVerMas: string;
  /** Déjà traduit — il DIFFÈRE pour les activités (leur « Ver más » mène à un index de tags). */
  labelVerMas: string;
  variante: "grilla" | "lista";
  tarjetas: OfertaTarjeta[];
  locale: Locale;
  /** Vrai pour la PREMIÈRE section de la page : sa première carte porte le LCP. */
  prioridad?: boolean;
  testId?: string;
};

// ⚠️ Les deux jeux de classes sont écrits EN TOUTES LETTRES, jamais composés à la volée : Tailwind
// v4 scanne le TEXTE source, une classe fabriquée par interpolation n'est simplement pas générée
// et la grille s'affiche en une colonne sans que rien ne le signale.
//
// Grille : une colonne en mobile (`grid-cols-1` explicite plutôt qu'implicite — c'est la valeur
// qu'on relit pour vérifier le mobile d'abord), deux à partir de `md`, trois à partir de `lg`.
// Aucune largeur en dur : ce sont les colonnes qui s'ajoutent, jamais le conteneur qui se fige.
const CLASES_GRILLA = "grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3";

// Liste : la variante des activités, dont la carte est un `Card layout="row"` (visuel à gauche,
// texte à droite — spec 28 §5). Une rangée large n'a rien à gagner à être mise en grille : elle
// s'empile, aux deux gabarits, avec un écart un peu plus serré que la grille.
const CLASES_LISTA = "flex flex-col gap-3";

export function SeccionOfertas({
  titulo,
  tituloAs,
  hrefVerMas,
  labelVerMas,
  variante,
  tarjetas,
  locale,
  prioridad,
  testId,
}: SeccionOfertasProps) {
  return (
    // `aria-label={titulo}` : un <section> sans nom accessible n'est PAS un repère de navigation,
    // c'est une simple div pour un lecteur d'écran. Nommée, chacune des cinq sections de l'accueil
    // devient atteignable directement — et le nom est exactement le titre visible, jamais un
    // libellé parallèle qui divergerait à la première retouche.
    <section className="flex flex-col gap-4" aria-label={titulo} data-testid={testId}>
      {/* Le NIVEAU vient de la page, jamais deviné ici : c'est ce qui garantit un seul <h1> et une
          hiérarchie sans saut. `h2` par défaut parce que c'est le seul usage prévu (sous le <h1>
          masqué de l'accueil), et le type le dit — `tituloAs` n'accepte rien d'autre. */}
      <Title as={tituloAs ?? "h2"} testId={testId ? `${testId}-titulo` : undefined}>
        {titulo}
      </Title>

      <ul className={variante === "grilla" ? CLASES_GRILLA : CLASES_LISTA}>
        {tarjetas.map((tarjeta, index) => (
          // `tarjeta.clave` : la clé vient de la donnée (spec 28 §0), jamais de l'index — deux
          // recherches successives réordonnent les cartes, et React réutiliserait les mauvaises.
          <li key={tarjeta.clave}>
            <TarjetaOferta
              oferta={tarjeta}
              variante={variante}
              locale={locale}
              // ⚠️ UNE SEULE carte prioritaire dans toute la page, et c'est la première de la
              // première section. `prioridad` sans `index === 0` poserait huit préchargements sur
              // la première section — sept d'entre eux sous la ligne de flottaison, exactement la
              // régression Core Web Vitals que la prop `loading` de PhotoStrip existe pour éviter.
              prioridad={prioridad === true && index === 0}
            />
          </li>
        ))}
      </ul>

      {/* ⚠️ Le `Link` de `@/i18n/navigation`, jamais `next/link` ni `<a href>` : lui seul conserve
          le préfixe de langue, et ce lien est le maillage interne qui fait découvrir les pages de
          listing à un crawler. `min-h-11` = 44 px de cible tactile ; `self-start` pour que la zone
          cliquable s'arrête au texte au lieu de courir sur toute la largeur. */}
      <Link
        href={hrefVerMas}
        className="inline-flex min-h-11 items-center self-start rounded-[var(--radius)] text-base underline-offset-4 hover:underline focus-visible:status-focused"
        data-testid={testId ? `${testId}-ver-mas` : undefined}
      >
        {labelVerMas}
      </Link>
    </section>
  );
}
