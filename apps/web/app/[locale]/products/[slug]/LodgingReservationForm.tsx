"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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

// Spec 17 §0 Tranche 2, §10 point 6 — react-day-picker mode="range", tranché sur prototype réel
// (cf. docs/journal/2026-08.md). Une seule entité tarifée : le produit lui-même, via
// product_date_rates/price_tiers.
//
// Ce composant a eu un jumeau, HotelReservationForm.tsx, qui ajoutait un sélecteur de chambre
// avant le calendrier. T3 (2026-08-27) a supprimé l'étage hôtel : chaque chambre est devenue un
// produit, et ce formulaire les sert toutes.
type AvailabilityRow = { date: string; capacity: number; booked: number };
type RateRow = { date: string; price_cop: number };

export function LodgingReservationForm({
  productId,
  productName,
  establishmentName,
  priceCop,
  priceTiers,
  maxQty,
  isPmsBacked,
  availability,
  rates,
}: {
  productId: string;
  productName: string;
  establishmentName: string;
  priceCop: number;
  priceTiers: PriceTier[] | null;
  maxQty: number;
  isPmsBacked: boolean;
  availability: AvailabilityRow[];
  rates: RateRow[];
}) {
  const t = useTranslations("ProductPage");
  const { lines, addLine } = useCart();

  const [range, setRange] = useState<DateRange | undefined>();
  const [qty, setQty] = useState(1);
  const [justAdded, setJustAdded] = useState(false);

  // Spec 21 §13 (gap comblé) — un alojamiento PMS-backed n'a jamais de product_availability/
  // product_date_rates peuplées (Lobby fait foi, cf. page.tsx) : `availability` (prop SSR) reste
  // vide dans ce cas, remplacée ici par un fetch client mois par mois vers
  // /api/pms/night-availability. `visibleMonth` pilote le calendrier en mode contrôlé (inoffensif
  // pour un produit non-PMS, qui ignore ce state) ; `loadedMonthsRef` évite de refetcher un mois
  // déjà chargé (mémoire de session du composant, jamais persistée) ; `pmsAvailability` s'accumule
  // au fil de la navigation (jamais réinitialisée en changeant de mois) pour ne pas perdre les
  // nuits déjà résolues d'un mois précédemment visité.
  const [visibleMonth, setVisibleMonth] = useState(() => new Date());
  const [pmsAvailability, setPmsAvailability] = useState<Map<string, AvailabilityRow>>(new Map());
  const [pmsLoading, setPmsLoading] = useState(isPmsBacked);
  const [pmsError, setPmsError] = useState(false);
  const loadedMonthsRef = useRef<Set<string>>(new Set());

  const monthKey = useMemo(() => format(visibleMonth, "yyyy-MM"), [visibleMonth]);

  useEffect(() => {
    if (!isPmsBacked || loadedMonthsRef.current.has(monthKey)) return;
    let cancelled = false;
    setPmsLoading(true);
    setPmsError(false);

    fetch(`/api/pms/night-availability?productId=${encodeURIComponent(productId)}&month=${monthKey}`)
      .then((response) => response.json() as Promise<{ ok: boolean; nights?: AvailabilityRow[] }>)
      .then((result) => {
        if (cancelled) return;
        if (!result.ok) {
          // Échec (ou connecteur inactif) : nuits de ce mois OMISES, jamais une valeur fabriquée —
          // hasUnavailableNightInRange traite déjà toute nuit absente comme indisponible (fail-closed
          // gratuit, cf. reservationRange.ts).
          setPmsError(true);
          return;
        }
        loadedMonthsRef.current.add(monthKey);
        setPmsAvailability((prev) => {
          const next = new Map(prev);
          for (const row of result.nights ?? []) next.set(row.date, row);
          return next;
        });
      })
      .catch(() => {
        if (!cancelled) setPmsError(true);
      })
      .finally(() => {
        if (!cancelled) setPmsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isPmsBacked, monthKey, productId]);

  const effectiveAvailability = useMemo(
    () => (isPmsBacked ? [...pmsAvailability.values()] : availability),
    [isPmsBacked, pmsAvailability, availability]
  );

  const byDate = useMemo(
    () => new Map(effectiveAvailability.map((row) => [row.date, row])),
    [effectiveAvailability]
  );
  const rateByDate = useMemo(() => new Map(rates.map((row) => [row.date, row.price_cop])), [rates]);

  // Cupos déjà occupés par CE produit dans le panier en cours (pas encore en base) — même
  // raisonnement que ReservationForm.tsx (avertissement indicatif, jamais la vraie barrière, qui
  // reste create_order au moment du checkout). Filtré par productId, qui suffit à désambiguïser :
  // product_availability est propre à CE produit.
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
    for (const row of effectiveAvailability) {
      const inCart = inCartByDate.get(row.date) ?? 0;
      if (row.capacity - row.booked - inCart <= 0) full.push(parseISO(row.date));
    }
    return full;
  }, [effectiveAvailability, inCartByDate]);

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
        {isPmsBacked && pmsError ? (
          <p className="mb-2 text-sm text-danger" role="alert" data-testid="pms-availability-error">
            {t("pmsAvailabilityError")}
          </p>
        ) : null}
        {isPmsBacked && pmsLoading ? (
          <p className="mb-2 text-sm text-muted" aria-live="polite" data-testid="pms-availability-loading">
            {t("pmsAvailabilityLoading")}
          </p>
        ) : null}
        <Calendar
          mode="range"
          selected={range}
          onSelect={handleSelectRange}
          month={visibleMonth}
          onMonthChange={setVisibleMonth}
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
