"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Card } from "@/components/atoms/Card";
import { Price } from "@/components/atoms/Price";
import { PhotoStrip } from "@/components/molecules/PhotoStrip";
import type { Locale } from "@/messages";
import type { TarjetaOferta as OfertaTarjeta } from "@/lib/catalog/tipos";

// La carte d'une offre dans l'accueil-résultats (2026-09-08, lot D — spec 28 §5, Tranche 1).
//
// Elle n'invente rien : elle CÂBLE trois briques déjà construites — `Card` (2026-09-02),
// `PhotoStrip` (2026-09-04) et `Price` (2026-09-01) — sur une ligne de `search_catalog` telle que
// `lib/catalog/buscar.ts` la sert. Son existence tient à trois décisions qu'il fallait bien poser
// QUELQUE PART, et qui ne peuvent tenir ni dans un atome ni dans la couche de données :
//
//   1. ⚠️ LE TEXTE ALTERNATIF EST CALCULÉ ICI (spec 28 §6, corrigé à l'implémentation le
//      2026-09-07). `product_media` ne porte aucune colonne de texte alternatif — il est donc
//      calculé, « <nom de l'offre>, foto <i> de <n> ». Mais c'est du texte d'INTERFACE : le mettre
//      dans `lib/catalog/` y ferait entrer next-intl et rendrait la couche de données intestable
//      sans contexte i18n. La carte reçoit déjà `nombre` et connaît le rang de chaque photo — elle
//      a tout ce qu'il faut. C'est la raison pour laquelle cette molécule appelle `useTranslations`
//      là où un atome ne traduirait rien (components/README.md, « Traductions »).
//
//   2. LE PRIX A QUATRE FORMES, et une seule est un montant. `PrecioTarjeta` distingue `monto`,
//      `desde`, `texto` et `null` (spec 28 §0). ⚠️ `texto` n'est JAMAIS formaté en COP : un evento
//      porte un `price_label` en texte libre (règle métier du cahier admin §3c, déjà écrite dans
//      l'en-tête de l'atome `Price`, qui refuse explicitement de connaître ce cas). Et `null` ne
//      rend AUCUN bloc — jamais « desde 0 », jamais un conteneur vide qui laisserait un écart sous
//      le titre.
//
//   3. `sizes` DÉPEND DE LA VARIANTE, et personne d'autre ne peut le savoir. `PhotoStrip` exige
//      `sizes` et `loading` par le type, précisément parce qu'une bande ne connaît pas la largeur
//      du conteneur qui l'accueille. Ici on la connaît : la grille de `SeccionOfertas` (1 colonne,
//      2 dès `md`, 3 dès `lg`) pour `grilla`, la vignette de 64 px de `Card layout="row"` pour
//      `lista`. `prioridad` suit la même logique d'un cran plus haut : UNE seule carte de la page
//      la reçoit, la première de la première section — c'est elle le LCP (spec 28 §0, invariant 6).
//
// `"use client"` obligatoire : ce fichier appelle `useTranslations` et rend `Card` et `PhotoStrip`,
// qui importent le barrel `@hifago/ui` — dont le graphe casse `next build` dès qu'il atteint un
// Server Component (CLAUDE.md §11.16).
//
// ⚠️ CE QU'ELLE NE RÉSOUT PAS, et c'est volontaire : en variante `lista`, le visuel de `Card` fait
// 64 px — dimensionné pour la ligne produit d'une fiche établissement, trop petit pour un
// carrousel. C'est le point ouvert de la spec 28 §10 (agrandir le visuel de la variante `row`,
// renoncer au carrousel sur cette variante, ou faire de la carte d'activité une molécule à part),
// une décision VISUELLE qui modifie un atome partagé — donc un lot à part, après arbitrage.
// La carte est rendue telle quelle en attendant.

export type TarjetaOfertaProps = {
  oferta: OfertaTarjeta;
  /** "grilla" = carte empilée (photos à fleur de carte) ; "lista" = Card layout="row". */
  variante: "grilla" | "lista";
  /** UNE SEULE carte de la page la reçoit : la première de la première section (le LCP). */
  prioridad?: boolean;
  locale: Locale;
};

// Chaînes littérales complètes, jamais construites : Tailwind ne les compile pas, mais `sizes` est
// lu par le navigateur et une valeur fausse sert l'image la plus grande à un téléphone.
//
// `SIZES_GRILLA` est repris tel quel de la spec 28 §5 (« `sizes` suit la grille ») et correspond
// aux points de rupture de `SeccionOfertas`. `SIZES_LISTA` est la largeur EXACTE de la vignette de
// `Card layout="row"` (`w-16`), donc 64 px — voir la réserve de l'en-tête : si le visuel de la
// variante `row` est agrandi par le lot d'arbitrage, cette valeur doit bouger avec lui.
const SIZES_GRILLA = "(min-width: 1024px) 33vw, (min-width: 768px) 50vw, 100vw";
const SIZES_LISTA = "64px";

export function TarjetaOferta({ oferta, variante, prioridad, locale }: TarjetaOfertaProps) {
  const t = useTranslations("HomePage");

  // `id` = le rang, et non l'URL : `search_catalog` peut servir deux fois la même photo (une carte
  // groupée reprend les médias du premier couchage), et le `Carousel` a besoin de clés distinctes.
  const fotos = oferta.fotos.map((foto, indice) => ({
    id: String(indice),
    url: foto.url,
    alt: t("fotoAlt", {
      nombre: oferta.nombre,
      indice: indice + 1,
      total: oferta.fotos.length,
    }),
  }));

  // Suite d'`if` plutôt qu'une chaîne de ternaires : les quatre formes du prix sont une règle
  // métier, elles se lisent mieux à plat. `undefined` (et non `null`) parce que c'est ce que `Card`
  // teste pour ne PAS ouvrir de `Card.Content` — un bloc vide laisserait un écart sous le titre.
  const { precio } = oferta;
  let contenido: ReactNode = undefined;

  if (precio?.tipo === "monto") {
    contenido = (
      <Price amountCop={precio.cop} locale={locale} testId={`${oferta.testId}-precio`} />
    );
  } else if (precio?.tipo === "desde") {
    // Le libellé et le montant dans UN SEUL élément : c'est le prix complet, pas deux informations
    // voisines — un lecteur d'écran doit lire « Desde 180.000 COP » d'une traite.
    contenido = (
      <span className="font-medium" data-testid={`${oferta.testId}-precio`}>
        {t("precioDesde")} <Price amountCop={precio.cop} locale={locale} />
      </span>
    );
  } else if (precio?.tipo === "texto") {
    // ⚠️ Le label tel quel, JAMAIS `formatCop` : c'est un texte libre saisi par le partenaire
    // (« Entrada libre », « Consultar »), pas un nombre. Le passer à `Price` rendrait « 0 COP ».
    contenido = (
      <span className="font-medium" data-testid={`${oferta.testId}-precio`}>
        {precio.label}
      </span>
    );
  }

  // La CAPACITÉ, sur les seules cartes qui la portent — les chambres d'une fiche établissement
  // (« photo · nom · capacité · prix », entretien du 2026-09-07). `search_catalog` ne la rend pas,
  // donc elle est `null` sur l'accueil et les listings et la ligne n'y apparaît jamais.
  //
  // Sous le prix et non à sa place : les deux se lisent ensemble pour choisir une chambre.
  const contenidoCompleto =
    oferta.capacidad !== null ? (
      <span className="flex flex-col gap-0.5">
        {contenido}
        <span className="text-sm font-normal text-muted" data-testid={`${oferta.testId}-capacidad`}>
          {t("capacidadPersonas", { count: oferta.capacidad })}
        </span>
      </span>
    ) : (
      contenido
    );

  return (
    <Card
      href={oferta.href}
      title={oferta.nombre}
      titleAs="h3"
      subtitle={oferta.establecimiento ?? undefined}
      layout={variante === "lista" ? "row" : "stack"}
      testId={oferta.testId}
      media={
        // Rendue même sans photo : `PhotoStrip` pose alors le substitut de l'atome `Image`, au même
        // ratio — la carte garde sa forme au lieu de se tasser (spec 28 §0, « Offre sans photo »).
        <PhotoStrip
          photos={fotos}
          loading={prioridad ? "priority" : "lazy"}
          sizes={variante === "lista" ? SIZES_LISTA : SIZES_GRILLA}
          testId={`${oferta.testId}-fotos`}
        />
      }
    >
      {contenidoCompleto}
    </Card>
  );
}
