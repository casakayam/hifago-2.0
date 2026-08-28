"use client";

import { useEffect, useMemo, useRef, useState, type ComponentProps } from "react";
import { format, parseISO } from "date-fns";
import { useTranslations } from "next-intl";
import type { DateRange } from "react-day-picker";
import { Link } from "@/i18n/navigation";
import {
  Button,
  DayPickerCalendar as Calendar,
  DayPickerCalendarDayButton,
  Input,
  Label,
  TextField,
} from "@hifago/ui";
import { formatCop, type LodgingKind } from "@hifago/domain";
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
  lodgingKind,
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
  lodgingKind: LodgingKind | null;
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

  const qtyMax = Math.max(maxQty, 1);

  // Cupos restants par nuit — une seule dérivation, lue par le barré du calendrier ET par le
  // compteur affiché dans la case. Ne dépend PAS de `qty` : c'est un fait de disponibilité, pas un
  // verdict sur la demande en cours.
  const remainingByDate = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of effectiveAvailability) {
      map.set(row.date, row.capacity - row.booked - (inCartByDate.get(row.date) ?? 0));
    }
    return map;
  }, [effectiveAvailability, inCartByDate]);

  // Nuits que la quantité demandée ne peut pas prendre. Le seuil est `qty`, jamais 0 — c'est le
  // correctif du 2026-08-28. Avant, le calendrier ne barrait que les nuits COMPLÈTES : une nuit à 2
  // places restantes s'affichait normale, se laissait sélectionner, et n'était refusée qu'après
  // coup par range-unavailable-warning. Le verdict arrivait donc APRÈS le choix au lieu de le
  // guider, et rien ne disait quelle nuit coinçait ni combien il restait.
  const unavailableDates = useMemo(() => {
    const dates: Date[] = [];
    for (const [date, remaining] of remainingByDate) {
      if (remaining < qty) dates.push(parseISO(date));
    }
    return dates;
  }, [remainingByDate, qty]);

  // Compteur de restant dans la case du jour. Affiché UNIQUEMENT quand il contraint réellement le
  // choix (`remaining < qtyMax`) : sur un logement à 20 cupos ouverts tous les jours, imprimer
  // « 20 » sur trente cases n'informe personne et abîme la lecture du calendrier.
  //
  // Mémoïsé sur la map, et c'est indispensable : react-day-picker démonte et remonte toute la
  // grille quand le TYPE du composant `DayButton` change (cf. la doc de
  // dateTaggedDayButtonComponents dans packages/ui/src/components/legacy-calendar.tsx, qui existe
  // précisément pour ça). Recréer ce type à chaque frappe dans le champ quantité aurait défait
  // exactement l'optimisation qu'elle documente. `data-date` est repris tel quel : c'est la cible
  // stable des tests e2e, indépendante de la locale d'affichage.
  const dayButtonComponents = useMemo(() => {
    function RemainingDayButton(props: ComponentProps<typeof DayPickerCalendarDayButton>) {
      const iso = format(props.day.date, "yyyy-MM-dd");
      const remaining = remainingByDate.get(iso);
      return (
        <DayPickerCalendarDayButton {...props} data-date={iso}>
          {props.children}
          {remaining !== undefined && remaining > 0 && remaining < qtyMax ? (
            <span data-testid="night-remaining">{remaining}</span>
          ) : null}
        </DayPickerCalendarDayButton>
      );
    }
    return { DayButton: RemainingDayButton };
  }, [remainingByDate, qtyMax]);

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

  // La quantité N'EST PLUS remise à 1 ici. Elle l'était à chaque clic sur le calendrier, ce qui
  // rendait impossible le seul geste qui compte : poser d'abord le nombre de places, puis regarder
  // quelles nuits l'acceptent. Le champ est désormais saisissable AVANT les dates, et sa valeur
  // survit à la sélection.
  function handleSelectRange(next: DateRange | undefined) {
    setRange(next);
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

  // Nommer l'unité de `qty` là où elle se saisit. « Cantidad » ne disait pas de QUOI, alors que la
  // réponse dépend du produit : un dortoir se vend au lit, une privée ou une maison à l'unité (même
  // règle que cuposPerUnit et que le garde-fou capacity_exceeds_physical). `lodging_kind` étant
  // facultatif, l'intitulé neutre reste le repli.
  const quantityLabel =
    lodgingKind === "dorm"
      ? t("quantityLabelBeds")
      : lodgingKind === "private"
        ? t("quantityLabelRooms")
        : lodgingKind === "whole_house"
          ? t("quantityLabelHouses")
          : t("quantityLabel");

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
          modifiers={{ unavailable: unavailableDates }}
          modifiersClassNames={{ unavailable: "line-through opacity-60" }}
          components={dayButtonComponents}
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

      {/* Plus de `isDisabled` : le champ se saisit avant les dates, c'est tout l'intérêt du
          correctif — le calendrier se barre au fur et à mesure qu'on monte la quantité. */}
      <TextField
        className="max-w-32"
        name="qty"
        value={String(qty)}
        onChange={(value) => {
          const next = Number(value);
          setQty(Number.isNaN(next) ? 1 : Math.min(Math.max(next, 1), qtyMax));
        }}
      >
        <Label>{quantityLabel}</Label>
        <Input id="qty" type="number" min={1} max={qtyMax} data-testid="lodging-qty-input" />
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
