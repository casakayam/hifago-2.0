"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Card, buttonVariants } from "@hifago/ui";
import type { PriceTier } from "@/lib/products/reservationRange";
import { ProductPhotos } from "./ProductPhotos";
import { ReservationForm } from "./ReservationForm";
import { HotelReservationForm, type RoomTypeOption } from "./HotelReservationForm";
import { LodgingReservationForm } from "./LodgingReservationForm";
import { SlotReservationForm } from "./SlotReservationForm";

// Types dupliqués volontairement (même convention déjà en place dans ce dossier : chaque
// *ReservationForm.tsx définit sa propre AvailabilityRow/RateRow locale plutôt qu'un type
// partagé) — pas une invention propre à ce fichier.
type AvailabilityRow = { date: string; capacity: number; booked: number };
type DateRateRow = { date: string; price_cop: number };
type RoomAvailabilityRow = { room_type_id: string; date: string; capacity: number; booked: number };
type RoomRateRow = { room_type_id: string; date: string; price_cop: number };
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
  reservationMode,
  occurrenceLabel,
  externalBookingUrl,
  productId,
  establishmentName,
  establishmentDescription,
  establishmentAddress,
  establishmentPhotoSlides,
  roomTypes,
  roomAvailability,
  roomRates,
  // Un seul de lodging/slot/date se rend jamais par appel (reservationMode le discrimine) — les
  // trois ex-props lodgingPriceCop/slotPriceCop/datePriceCop portaient systématiquement la même
  // valeur (product.price_cop) sous des noms différents, collapsées ici en une seule (/simplify).
  priceCop,
  lodgingPriceTiers,
  lodgingMaxQty,
  availability,
  productDateRates,
  productSlots,
}: {
  name: string;
  description: string | null;
  photoSlides: PhotoSlide[];
  priceDisplay: string | null;
  unit: string | null;
  reservationMode: "evento" | "hotel" | "lodging" | "slot" | "date";
  occurrenceLabel: string | null;
  externalBookingUrl: string | null;
  productId: string;
  establishmentName: string;
  establishmentDescription: string | null;
  establishmentAddress: string | null;
  establishmentPhotoSlides: PhotoSlide[];
  roomTypes: RoomTypeOption[];
  roomAvailability: RoomAvailabilityRow[];
  roomRates: RoomRateRow[];
  priceCop: number;
  lodgingPriceTiers: PriceTier[] | null;
  lodgingMaxQty: number;
  availability: AvailabilityRow[];
  productDateRates: DateRateRow[];
  productSlots: SlotRow[];
}) {
  const t = useTranslations("ProductPage");
  const tCommon = useTranslations("Common");

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
            {reservationMode !== "evento" && unit === "per_person" ? (
              <span className="ml-1 text-sm font-normal text-muted">{t("perPerson")}</span>
            ) : null}
          </p>

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
          ) : reservationMode === "hotel" ? (
            <HotelReservationForm
              productId={productId}
              productName={name}
              establishmentName={establishmentName}
              roomTypes={roomTypes}
              availability={roomAvailability}
              rates={roomRates}
            />
          ) : reservationMode === "lodging" ? (
            <LodgingReservationForm
              productId={productId}
              productName={name}
              establishmentName={establishmentName}
              priceCop={priceCop}
              priceTiers={lodgingPriceTiers}
              maxQty={lodgingMaxQty}
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
            <p className="font-medium" data-testid="establishment-name">
              {establishmentName}
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
