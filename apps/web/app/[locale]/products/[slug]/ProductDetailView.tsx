"use client";

import { useTranslations } from "next-intl";
import type { LodgingKind } from "@hifago/domain";
import { Link } from "@/i18n/navigation";
import { Card, buttonVariants } from "@hifago/ui";
import type { PriceTier } from "@/lib/products/reservationRange";
import { ProductPhotos } from "./ProductPhotos";
import { ReservationForm } from "./ReservationForm";
import { LodgingReservationForm } from "./LodgingReservationForm";
import { SlotReservationForm } from "./SlotReservationForm";

// Types dupliqués volontairement (même convention déjà en place dans ce dossier : chaque
// *ReservationForm.tsx définit sa propre AvailabilityRow/RateRow locale plutôt qu'un type
// partagé) — pas une invention propre à ce fichier.
type AvailabilityRow = { date: string; capacity: number; booked: number };
type DateRateRow = { date: string; price_cop: number };
type SlotRow = {
  slot_date: string;
  slot_start_time: string;
  capacity: number;
  booked: number;
  slot_duration_minutes: number;
};
type PhotoSlide = { id: string; alt: string; url: string };

// Contient tout le rendu HeroUI de la fiche produit (extrait de page.tsx, Server Component) — un
// Server Component de ce projet ne doit JAMAIS importer directement depuis "@hifago/ui"
// (CLAUDE.md §11.16, le barrel tire app-nav-shell/lucide-react et fait planter next build) : ce
// fichier "use client" est désormais le seul point d'import HeroUI de la route produit. Ajoute au
// passage le bloc "établissement" (feature 32) — jusqu'ici le nom de l'établissement n'atteignait
// que les *ReservationForm (via CartLine), jamais affiché visiblement au client.
export function ProductDetailView({
  name,
  description,
  photoSlides,
  priceDisplay,
  unit,
  capacity,
  unitCount,
  lodgingKind,
  reservationMode,
  occurrenceLabel,
  externalBookingUrl,
  productId,
  establishmentName,
  establishmentSlug,
  establishmentDescription,
  establishmentAddress,
  establishmentPhotoSlides,
  // Un seul de lodging/slot/date se rend jamais par appel (reservationMode le discrimine) — les
  // trois ex-props lodgingPriceCop/slotPriceCop/datePriceCop portaient systématiquement la même
  // valeur (product.price_cop) sous des noms différents, collapsées ici en une seule (/simplify).
  priceCop,
  lodgingPriceTiers,
  lodgingMaxQty,
  isPmsBacked,
  availability,
  productDateRates,
  productSlots,
}: {
  name: string;
  description: string | null;
  photoSlides: PhotoSlide[];
  priceDisplay: string | null;
  unit: string | null;
  /** Occupants d'UNE unité (Lobby : `capacity`). Facultatif — beaucoup de produits ne le portent pas. */
  capacity: number | null;
  /** Nombre d'unités de ce type (Lobby : `quantity`). Un TOTAL, jamais une disponibilité du jour. */
  unitCount: number | null;
  /** Nature du couchage. `whole_house` ne vient jamais de Lobby — toujours un choix du partenaire. */
  lodgingKind: LodgingKind | null;
  reservationMode: "evento" | "lodging" | "slot" | "date";
  occurrenceLabel: string | null;
  externalBookingUrl: string | null;
  productId: string;
  establishmentName: string;
  /** `null` sur un produit dont l'établissement n'a pas de page publique (statut non actif). */
  establishmentSlug: string | null;
  establishmentDescription: string | null;
  establishmentAddress: string | null;
  establishmentPhotoSlides: PhotoSlide[];
  priceCop: number;
  lodgingPriceTiers: PriceTier[] | null;
  lodgingMaxQty: number;
  isPmsBacked: boolean;
  availability: AvailabilityRow[];
  productDateRates: DateRateRow[];
  productSlots: SlotRow[];
}) {
  const t = useTranslations("ProductPage");
  const tCommon = useTranslations("Common");

  // `unit` est une unité de PRIX — à ne pas confondre avec lodgingKind, qui est une nature de
  // couchage (products.lodging_kind, migration 20260827120000). `per_two` reste délibérément sans
  // suffixe : « por dos personas » n'ajoute rien à un prix de chambre déjà décrit par la fiche.
  const unitSuffix =
    unit === "per_person" ? t("perPerson") : unit === "per_house" ? t("perHouse") : null;

  // Table explicite plutôt qu'une clé i18n construite dynamiquement : next-intl ne vérifierait plus
  // l'existence de la clé, et une valeur inattendue afficherait son propre nom brut au client.
  const lodgingKindLabel =
    lodgingKind === "dorm"
      ? t("lodgingKindDorm")
      : lodgingKind === "private"
        ? t("lodgingKindPrivate")
        : lodgingKind === "whole_house"
          ? t("lodgingKindWholeHouse")
          : null;

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 p-8">
      <Link href="/" className="text-sm text-muted hover:underline">
        {t("backToCatalog")}
      </Link>
      <Card>
        <Card.Header>
          <Card.Title className="text-2xl" data-testid="product-name">
            {name}
          </Card.Title>
          {description ? <Card.Description>{description}</Card.Description> : null}
        </Card.Header>
        <Card.Content className="flex flex-col gap-6">
          <ProductPhotos slides={photoSlides} />

          <p className="text-lg font-medium" data-testid="product-price">
            {priceDisplay}
            {reservationMode !== "evento" && unitSuffix ? (
              <span className="ml-1 text-sm font-normal text-muted">{unitSuffix}</span>
            ) : null}
          </p>

          {/* Capacité et nombre d'unités (2026-08-26). Chaque moitié est FACULTATIVE et rendue
              séparément : un produit peut porter l'une sans l'autre, et la plupart n'ont ni l'une
              ni l'autre — la ligne entière disparaît alors, plutôt que d'afficher un séparateur
              orphelin. `quantity` est libellé « en total » et non « disponibles » : c'est le parc
              total du type, jamais ce qui reste libre cette nuit (pour un logement PMS-backed,
              cette réponse-là vient de LobbyPMS en direct, cf. LodgingReservationForm). */}
          {lodgingKindLabel !== null || capacity !== null || unitCount !== null ? (
            <p className="text-sm text-muted" data-testid="product-lodging-facts">
              {[
                lodgingKindLabel,
                capacity !== null ? t("lodgingCapacity", { count: capacity }) : null,
                unitCount !== null ? t("lodgingUnitCount", { count: unitCount }) : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          ) : null}

          {reservationMode === "evento" ? (
            <div className="flex flex-col gap-3">
              {occurrenceLabel ? (
                <p data-testid="evento-occurrence" className="text-sm text-muted">
                  {occurrenceLabel}
                </p>
              ) : null}
              {externalBookingUrl ? (
                <a
                  href={externalBookingUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-testid="evento-reserve-link"
                  className={buttonVariants({ variant: "primary" })}
                >
                  {t("reserveExternal")}
                </a>
              ) : null}
            </div>
          ) : reservationMode === "lodging" ? (
            <LodgingReservationForm
              productId={productId}
              productName={name}
              establishmentName={establishmentName}
              priceCop={priceCop}
              priceTiers={lodgingPriceTiers}
              maxQty={lodgingMaxQty}
              lodgingKind={lodgingKind}
              isPmsBacked={isPmsBacked}
              availability={availability}
              rates={productDateRates}
            />
          ) : reservationMode === "slot" ? (
            <SlotReservationForm
              productId={productId}
              productName={name}
              establishmentName={establishmentName}
              priceCop={priceCop}
              slots={productSlots}
            />
          ) : (
            <ReservationForm
              productId={productId}
              productName={name}
              establishmentName={establishmentName}
              priceCop={priceCop}
              availability={availability}
            />
          )}

          <p className="text-xs text-muted">{tCommon("cancellationPolicy")}</p>
        </Card.Content>
      </Card>

      {establishmentName ? (
        <Card data-testid="establishment-info">
          <Card.Header>
            <Card.Title className="text-lg">{t("establishmentTitle")}</Card.Title>
          </Card.Header>
          <Card.Content className="flex flex-col gap-3">
            <ProductPhotos slides={establishmentPhotoSlides} />
            {/* T1 : le nom mène désormais à la page de l'établissement, qui regroupe toutes ses
                chambres et ses activités. Sans slug — établissement non actif, donc sans page
                publique — on garde le texte nu plutôt qu'un lien mort. */}
            <p className="font-medium" data-testid="establishment-name">
              {establishmentSlug ? (
                <Link href={`/establishments/${establishmentSlug}`} className="hover:underline">
                  {establishmentName}
                </Link>
              ) : (
                establishmentName
              )}
            </p>
            {establishmentDescription ? (
              <p className="text-sm text-muted">{establishmentDescription}</p>
            ) : null}
            {establishmentAddress ? (
              <p className="text-sm text-muted">{establishmentAddress}</p>
            ) : null}
          </Card.Content>
        </Card>
      ) : null}
    </main>
  );
}
