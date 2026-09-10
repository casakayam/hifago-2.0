"use client";

import { useTranslations } from "next-intl";
import { Card } from "@hifago/ui";
import { Price } from "@/components/atoms/Price";
import { Title } from "@/components/atoms/Title";
import { BackLink } from "@/components/atoms/BackLink";
import { PhotoStrip } from "@/components/molecules/PhotoStrip";
import { Link } from "@/i18n/navigation";
import type { FichaProducto as DatosFicha } from "@/lib/catalog/tipos";
import type { Locale } from "@/messages";
import { BotonContacto } from "./BotonContacto";
import { ReservationForm } from "./ReservationForm";
import { LodgingReservationForm } from "./LodgingReservationForm";
import { SlotReservationForm } from "./SlotReservationForm";

// LE CORPS DE LA FICHE PRODUIT (spec 30 §5a). Ex-`ProductDetailView`, réécrit sur le socle.
//
// ⚠️ « use client » n'est pas un choix : un Server Component de ce dépôt ne peut pas importer
// `@hifago/ui` (le barrel tire app-nav-shell/lucide-react et fait planter `next build` —
// CLAUDE.md §11.16). Ce fichier reste donc le seul point d'entrée HeroUI de la route.
//
// ⚠️ IL NE POSE PLUS DE `<main>` : c'est `PageShell` qui le fait, une fois, depuis la page. Le
// `<main>` écrit à la main ici portait un `gap-4 p-8` que l'en-tête de `PageShell` qualifie
// nommément de « dérive, pas une décision » — soit 64 px de marge horizontale sur un téléphone de
// 390 px, un sixième de la largeur.
//
// ⚠️ ET IL PORTE ENFIN UN `<h1>`. `Card.Title` de HeroUI rend un `<h3>` : la fiche n'avait donc
// AUCUN titre de niveau 1, et sa hiérarchie mesurée en réel était h3 → h2 → h3. L'invariant 9 de
// la spec 27 était violé sur cette page depuis le début, et rien ne le vérifiait.
//
// ⚠️ Le lien « retour au catalogue » est CONSERVÉ à côté du fil d'Ariane — ce n'est pas un doublon,
// et cet en-tête a affirmé le contraire jusqu'au 2026-09-09. La raison est écrite UNE SEULE FOIS,
// juste au-dessus du `BackLink` dans le corps : ne pas la recopier ici, deux énoncés de la même
// décision finissent par diverger — c'est exactement ce qui s'est passé.

/** Ce que la page a dû composer elle-même, parce que ça se traduit. */
export type EtiquetasFicha = {
  /** La date ou la récurrence d'un evento, déjà mise en phrase. `null` hors evento. */
  ocurrencia: string | null;
};

export function FichaProducto({
  ficha,
  etiquetas,
  locale,
}: {
  ficha: DatosFicha;
  etiquetas: EtiquetasFicha;
  locale: Locale;
}) {
  const t = useTranslations("ProductPage");
  const tCommon = useTranslations("Common");

  const alojamiento = ficha.alojamiento;

  // `unidad` est une unité de PRIX — à ne pas confondre avec `lodgingKind`, qui est une nature de
  // couchage. `per_two` reste délibérément SANS suffixe : « por dos personas » n'ajoute rien à un
  // prix de chambre que la fiche décrit déjà.
  const sufijoUnidad =
    ficha.unidad === "per_person"
      ? t("perPerson")
      : ficha.unidad === "per_house"
        ? t("perHouse")
        : null;

  // Table explicite plutôt qu'une clé i18n construite dynamiquement : next-intl ne vérifierait plus
  // l'existence de la clé, et une valeur inattendue afficherait son propre nom brut au visiteur.
  const etiquetaCouchage =
    alojamiento?.lodgingKind === "dorm"
      ? t("lodgingKindDorm")
      : alojamiento?.lodgingKind === "private"
        ? t("lodgingKindPrivate")
        : alojamiento?.lodgingKind === "whole_house"
          ? t("lodgingKindWholeHouse")
          : null;

  const faits = [
    etiquetaCouchage,
    alojamiento?.capacity != null ? t("lodgingCapacity", { count: alojamiento.capacity }) : null,
    alojamiento?.unitCount != null ? t("lodgingUnitCount", { count: alojamiento.unitCount }) : null,
  ].filter(Boolean);

  return (
    <>
      {/* ⚠️ CE LIEN N'EST PAS UN DOUBLON DU FIL D'ARIANE, et il faut dire pourquoi avant que
          quelqu'un le supprime en le prenant pour tel.
          `Migas` rend des `<a href>` NATIFS : `Breadcrumbs.Item` de HeroUI étend le `Link` de
          react-aria, pas le `Link` de `@/i18n/navigation` (c'est écrit dans le composant, et c'est
          pour ça que le préfixe de langue y est posé à la main). Cliquer le fil provoque donc une
          navigation COMPLÈTE — qui vide le panier, tenu en mémoire par `CartContext`.
          Mesuré le 2026-09-08 : retirer ce lien fait échouer `cart-multi-establishment.spec.ts`,
          dont le commentaire dit déjà « un page.goto() direct réinitialiserait le panier ».
          Deux corrections de fond existent, aucune ne relève de ce lot : brancher un
          `RouterProvider` react-aria (absent de la version installée), ou rendre le panier
          persistant — ce que le cahier §2b.6 décide depuis le 2026-09-07 et que le backlog porte
          déjà. Ce lien disparaîtra avec la seconde. */}
      <BackLink href="/" label={t("backToCatalog")} testId="volver-al-catalogo" />

      <Card>
        <Card.Header>
          {/* Le titre VISIBLE de la page. `Title as="h1"` et non `Card.Title`, qui rend un h3. */}
          <Title as="h1" testId="product-name">
            {ficha.nombre}
          </Title>
          {ficha.descripcion ? <Card.Description>{ficha.descripcion}</Card.Description> : null}
        </Card.Header>

        <Card.Content className="flex flex-col gap-6">
          {/* `PhotoStrip` et non un emballage local : `ProductPhotos` faisait exactement la même
              chose (le même `Carousel`, la même variante `gallery`) en codant son conteneur et son
              `next/image` à la main. Le README l'interdit et cite ce cas précis. La molécule gère
              en plus le cas ZÉRO photo — l'aplat gris, au bon ratio, plutôt qu'un trou. */}
          <PhotoStrip
            photos={ficha.fotos.map((foto, index) => ({
              id: `${ficha.slug}-${index}`,
              // Le `alt` est composé ICI, jamais dans la couche de données : il se traduit.
              alt: t("fotoAlt", { nombre: ficha.nombre, indice: index + 1, total: ficha.fotos.length }),
              url: foto.url,
            }))}
            loading="priority"
            sizes="(min-width: 768px) 768px, 100vw"
            testId="product-photos"
          />

          {/* Aucun prix connu → AUCUNE ligne. Jamais « 0 COP », qui prétendrait la gratuité d'une
              offre dont le prix se négocie. */}
          {ficha.precio ? (
            <p className="text-lg font-medium" data-testid="product-price">
              {ficha.precio.tipo === "texto" ? (
                ficha.precio.label
              ) : (
                <Price amountCop={ficha.precio.cop} locale={locale} />
              )}
              {/* Aucun suffixe sur une vitrine ni sur un evento : leur prix est un libellé libre,
                  pas un tarif à l'unité. */}
              {ficha.modoReserva !== "evento" && ficha.modoReserva !== "vitrina" && sufijoUnidad ? (
                <span className="ml-1 text-sm font-normal text-muted">{sufijoUnidad}</span>
              ) : null}
            </p>
          ) : null}

          {/* Chaque moitié est FACULTATIVE et rendue séparément : un produit peut porter l'une sans
              l'autre, et la plupart n'ont ni l'une ni l'autre — la ligne entière disparaît alors,
              plutôt que d'afficher un séparateur orphelin. `unitCount` est libellé « en total » et
              jamais « disponibles » : c'est le parc du type, pas ce qui reste libre cette nuit. */}
          {faits.length > 0 ? (
            <p className="text-sm text-muted" data-testid="product-lodging-facts">
              {faits.join(" · ")}
            </p>
          ) : null}

          {/* ⚠️ L'OCCURRENCE EST INDÉPENDANTE DU MODE DE RÉSERVATION. Elle était rendue dans la
              seule branche `evento`, comme si la date d'un événement dépendait de la façon dont on
              le réserve. C'est une propriété du TYPE : elle s'affiche pour tout evento. */}
          {etiquetas.ocurrencia ? (
            <p data-testid="evento-occurrence" className="text-sm text-muted">
              {etiquetas.ocurrencia}
            </p>
          ) : null}

          {ficha.modoReserva === "vitrina" || ficha.modoReserva === "evento" ? (
            // La vitrine : le calendrier laisse SA PLACE au bouton de contact, sans bandeau ni
            // texte explicatif (cahier §2e). ⚠️ Un evento SANS url n'affiche donc rien ici — un
            // cul-de-sac, inchangé depuis toujours et désormais nommé (spec 30 §10.5).
            ficha.urlExterna ? (
              <BotonContacto
                href={ficha.urlExterna}
                etiqueta={t("reserveExternal")}
                testId="vitrina-contact-link"
              />
            ) : null
          ) : ficha.modoReserva === "lodging" && alojamiento ? (
            <LodgingReservationForm
              productId={ficha.id}
              priceCop={ficha.precio?.tipo === "monto" ? ficha.precio.cop : 0}
              priceTiers={alojamiento.priceTiers as never}
              maxQty={alojamiento.maxQty}
              lodgingKind={alojamiento.lodgingKind as never}
              isPmsBacked={alojamiento.esPmsBacked}
              availability={ficha.disponibilidad}
              rates={ficha.tarifas}
            />
          ) : ficha.modoReserva === "slot" ? (
            <SlotReservationForm productId={ficha.id} slots={ficha.franjas} />
          ) : (
            <ReservationForm productId={ficha.id} availability={ficha.disponibilidad} />
          )}

          <p className="text-xs text-muted">{tCommon("cancellationPolicy")}</p>
        </Card.Content>
      </Card>

      {ficha.establecimiento ? (
        <Card data-testid="establishment-info">
          <Card.Header>
            <Card.Title data-testid="establishment-name">
              {ficha.establecimiento.slug ? (
                <Link
                  href={`/establecimientos/${ficha.establecimiento.slug}`}
                  className="hover:underline"
                >
                  {ficha.establecimiento.nombre}
                </Link>
              ) : (
                ficha.establecimiento.nombre
              )}
            </Card.Title>
          </Card.Header>
          <Card.Content className="flex flex-col gap-4">
            <PhotoStrip
              photos={ficha.establecimiento.fotos.map((foto, index) => ({
                id: `est-${ficha.establecimiento?.slug ?? ficha.slug}-${index}`,
                alt: t("fotoAlt", {
                  nombre: ficha.establecimiento?.nombre ?? "",
                  indice: index + 1,
                  total: ficha.establecimiento?.fotos.length ?? 0,
                }),
                url: foto.url,
              }))}
              loading="lazy"
              sizes="(min-width: 768px) 768px, 100vw"
              testId="establishment-photos"
            />
            {ficha.establecimiento.descripcion ? (
              <p className="text-sm text-muted">{ficha.establecimiento.descripcion}</p>
            ) : null}
            {ficha.establecimiento.direccion ? (
              <p className="text-sm text-muted" data-testid="establishment-address">
                {ficha.establecimiento.direccion}
              </p>
            ) : null}
          </Card.Content>
        </Card>
      ) : null}
    </>
  );
}
