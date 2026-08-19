"use client";

import { useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import { useTranslations } from "next-intl";
import type { DateRange } from "react-day-picker";
import { Link } from "@/i18n/navigation";
import {
  Button,
  DayPickerCalendar as Calendar,
  Input,
  Label,
  TextField,
  dateTaggedDayButtonComponents,
} from "@hifago/ui";
import { formatCop } from "@hifago/domain";
import { useCart } from "@/lib/cart/CartContext";
import {
  buildInCartNightsMap,
  estimateNightsTotal,
  hasUnavailableNightInRange,
  nightsInRange,
  resolveTierPrice,
  type PriceTier,
} from "@/lib/products/reservationRange";

// Spec 17 §0 Tranche 2, §10 point 6 — même choix que HotelReservationForm.tsx (react-day-picker
// mode="range", tranché sur prototype réel, cf. docs/journal/2026-08.md) : un alojamiento n'a pas
// de chambre (pas de sélecteur, pas de room_type_id — cf. CartLine.priceCop et create_order,
// branche end_date sans room_type_id réservée au type lodging), donc ce composant est le pendant
// direct de HotelReservationForm.tsx MOINS le sélecteur de chambre : une seule "entité" tarifée
// (le produit lui-même, product_date_rates/price_tiers au lieu de room_type_date_rates/room_tiers).
type AvailabilityRow = { date: string; capacity: number; booked: number };
type RateRow = { date: string; price_cop: number };

export function LodgingReservationForm({
  productId,
  productName,
  establishmentName,
  priceCop,
  priceTiers,
  maxQty,
  availability,
  rates,
}: {
  productId: string;
  productName: string;
  establishmentName: string;
  priceCop: number;
  priceTiers: PriceTier[] | null;
  maxQty: number;
  availability: AvailabilityRow[];
  rates: RateRow[];
}) {
  const t = useTranslations("ProductPage");
  const { lines, addLine } = useCart();

  const [range, setRange] = useState<DateRange | undefined>();
  const [qty, setQty] = useState(1);
  const [justAdded, setJustAdded] = useState(false);

  const byDate = useMemo(() => new Map(availability.map((row) => [row.date, row])), [availability]);
  const rateByDate = useMemo(() => new Map(rates.map((row) => [row.date, row.price_cop])), [rates]);

  // Cupos déjà occupés par CE produit dans le panier en cours (pas encore en base) — même
  // raisonnement que ReservationForm.tsx/HotelReservationForm.tsx (avertissement indicatif, jamais
  // la vraie barrière, qui reste create_order au moment du checkout). Filtré par productId (pas de
  // room_type_id ici pour désambiguïser : product_availability est propre à CE produit).
  const inCartByDate = useMemo(
    () =>
      buildInCartNightsMap(
        lines,
        (line) => line.productId === productId,
        (_line, night) => night
      ),
    [lines, productId]
  );

  const fullDates = useMemo(() => {
    const full: Date[] = [];
    for (const row of availability) {
      const inCart = inCartByDate.get(row.date) ?? 0;
      if (row.capacity - row.booked - inCart <= 0) full.push(parseISO(row.date));
    }
    return full;
  }, [availability, inCartByDate]);

  const nights = useMemo(() => nightsInRange(range), [range]);
  const hasUnavailableNight = hasUnavailableNightInRange(
    nights,
    qty,
    (night) => byDate.get(night),
    (night) => inCartByDate.get(night) ?? 0
  );

  const canAdd = nights.length > 0 && !hasUnavailableNight;

  // Estimation d'affichage (jamais la vraie barrière) : palier de quantité déjà résolu côté client
  // (mécanique publique, pas de secret) puis override exact par nuit si posé côté admin —
  // stay_rates (saison/week-end) volontairement ignoré ici, mêmes raisons que
  // HotelReservationForm.tsx : create_order reste la seule source de vérité du total réellement
  // facturé, cf. CartLine.priceCop.
  const estimatedUnitPriceCop = useMemo(() => {
    if (nights.length === 0) return 0;
    const tierPrice = resolveTierPrice(priceTiers, priceCop, qty);
    return estimateNightsTotal(nights, tierPrice, (night) => rateByDate.get(night));
  }, [nights, qty, priceTiers, priceCop, rateByDate]);

  function handleSelectRange(next: DateRange | undefined) {
    setRange(next);
    setQty(1);
    setJustAdded(false);
  }

  function handleAddToCart() {
    if (!range?.from || !range?.to || !canAdd) return;
    addLine({
      productId,
      productName,
      establishmentName,
      date: format(range.from, "yyyy-MM-dd"),
      endDate: format(range.to, "yyyy-MM-dd"),
      qty,
      priceCop: estimatedUnitPriceCop,
    });
    setJustAdded(true);
    setRange(undefined);
    setQty(1);
  }

  const qtyMax = Math.max(maxQty, 1);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="mb-2 text-sm font-medium">{t("availabilityTitle")}</h2>
        <Calendar
          mode="range"
          selected={range}
          onSelect={handleSelectRange}
          disabled={[{ before: new Date() }]}
          modifiers={{ full: fullDates }}
          modifiersClassNames={{ full: "line-through opacity-60" }}
          // Référence module-scope (packages/ui), jamais reconstruite ici à chaque rendu — cf. sa doc.
          components={dateTaggedDayButtonComponents}
        />
      </div>

      {nights.length > 0 ? (
        hasUnavailableNight ? (
          <p className="text-sm text-danger" role="alert" data-testid="range-unavailable-warning">
            {t("rangeUnavailable")}
          </p>
        ) : (
          <p className="text-sm text-muted" aria-live="polite">
            {t("nightsCount", { count: nights.length })}
          </p>
        )
      ) : (
        <p className="text-sm text-muted">{t("selectRange")}</p>
      )}

      <TextField
        className="max-w-32"
        name="qty"
        value={String(qty)}
        isDisabled={nights.length === 0}
        onChange={(value) => {
          const next = Number(value);
          setQty(Math.min(Math.max(next, 1), qtyMax));
        }}
      >
        <Label>{t("quantityLabel")}</Label>
        <Input id="qty" type="number" min={1} max={qtyMax} />
      </TextField>

      {canAdd ? (
        <p className="text-sm font-medium" data-testid="lodging-estimated-price">
          {t("estimatedTotal")}: {formatCop(estimatedUnitPriceCop * qty)}
        </p>
      ) : null}

      {justAdded ? (
        <p role="status" data-testid="added-to-cart" className="text-sm font-medium text-accent">
          {t("addedToCart")}{" "}
          <Link href="/checkout" className="underline" data-testid="go-to-checkout-link">
            {t("goToCheckout")}
          </Link>
        </p>
      ) : null}

      <Button data-testid="add-to-cart-button" onPress={handleAddToCart} isDisabled={!canAdd}>
        {t("addToCart")}
      </Button>
    </div>
  );
}
