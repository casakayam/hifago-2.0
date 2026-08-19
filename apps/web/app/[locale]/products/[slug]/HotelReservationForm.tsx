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
  cn,
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

// Spec 17 §0 Tranche 2, §10 point 6 (tranché sur prototype réel le 2026-08-17, cf.
// docs/journal/2026-08.md) : react-day-picker mode="range" retenu plutôt que RangeCalendar HeroUI
// — mêmes raisons que ReservationForm.tsx en mode single (styles range déjà écrits dans
// legacy-calendar.tsx, jamais exercés avant ce composant). Écran neuf (pas un simple changement de
// mode sur ReservationForm) : sélecteur de chambre, disponibilité par chambre, validation nuit par
// nuit — la notion de "dernière place" n'a plus de sens évident sur une plage entière, remplacée
// ici par un avertissement explicite si la plage traverse une nuit indisponible.
export type RoomTypeOption = {
  id: string;
  name: string;
  kind: "dorm" | "private";
  capacity: number;
  priceCop: number;
  priceTiers: PriceTier[] | null;
  minQty: number;
  maxQty: number;
};
type AvailabilityRow = { room_type_id: string; date: string; capacity: number; booked: number };
type RateRow = { room_type_id: string; date: string; price_cop: number };

export function HotelReservationForm({
  productId,
  productName,
  establishmentName,
  roomTypes,
  availability,
  rates,
}: {
  productId: string;
  productName: string;
  establishmentName: string;
  roomTypes: RoomTypeOption[];
  availability: AvailabilityRow[];
  rates: RateRow[];
}) {
  const t = useTranslations("ProductPage");
  const { lines, addLine } = useCart();

  const [selectedRoomId, setSelectedRoomId] = useState<string | undefined>(roomTypes[0]?.id);
  const [range, setRange] = useState<DateRange | undefined>();
  const [qty, setQty] = useState(1);
  const [justAdded, setJustAdded] = useState(false);

  const selectedRoom = roomTypes.find((r) => r.id === selectedRoomId);

  const byKey = useMemo(
    () => new Map(availability.map((row) => [`${row.room_type_id}|${row.date}`, row])),
    [availability]
  );
  const rateByKey = useMemo(
    () => new Map(rates.map((row) => [`${row.room_type_id}|${row.date}`, row.price_cop])),
    [rates]
  );

  // Cupos déjà occupés par CE type de chambre/CETTE nuit dans le panier en cours (pas encore en
  // base) — même raisonnement que ReservationForm.tsx (avertissement indicatif, jamais la vraie
  // barrière, qui reste create_order au moment du checkout).
  const inCartByKey = useMemo(
    () =>
      buildInCartNightsMap(
        lines,
        (line) => Boolean(line.roomTypeId),
        (line, night) => `${line.roomTypeId}|${night}`
      ),
    [lines]
  );

  const { fullDates } = useMemo(() => {
    const full: Date[] = [];
    if (!selectedRoomId) return { fullDates: full };
    for (const row of availability) {
      if (row.room_type_id !== selectedRoomId) continue;
      const inCart = inCartByKey.get(`${row.room_type_id}|${row.date}`) ?? 0;
      if (row.capacity - row.booked - inCart <= 0) full.push(parseISO(row.date));
    }
    return { fullDates: full };
  }, [availability, selectedRoomId, inCartByKey]);

  const nights = useMemo(() => nightsInRange(range), [range]);
  const hasUnavailableNight =
    selectedRoomId !== undefined &&
    hasUnavailableNightInRange(
      nights,
      qty,
      (night) => byKey.get(`${selectedRoomId}|${night}`),
      (night) => inCartByKey.get(`${selectedRoomId}|${night}`) ?? 0
    );

  const canAdd = selectedRoom !== undefined && nights.length > 0 && !hasUnavailableNight;

  // Estimation d'affichage (jamais la vraie barrière) : palier de quantité déjà résolu côté
  // client (mécanique publique, pas de secret) puis override exact par nuit si posé côté admin —
  // stay_rates (saison/week-end) volontairement ignoré ici (nécessiterait de dupliquer toute la
  // logique serveur pour un simple confort d'affichage) : create_order reste la seule source de
  // vérité du total réellement facturé, cf. CartLine.priceCop.
  const estimatedUnitPriceCop = useMemo(() => {
    if (!selectedRoom || nights.length === 0) return 0;
    const tierPrice = resolveTierPrice(selectedRoom.priceTiers, selectedRoom.priceCop, qty);
    return estimateNightsTotal(nights, tierPrice, (night) => rateByKey.get(`${selectedRoom.id}|${night}`));
  }, [selectedRoom, nights, qty, rateByKey]);

  function handleSelectRoom(roomId: string) {
    setSelectedRoomId(roomId);
    setRange(undefined);
    setQty(1);
    setJustAdded(false);
  }

  function handleSelectRange(next: DateRange | undefined) {
    setRange(next);
    setQty(1);
    setJustAdded(false);
  }

  function handleAddToCart() {
    if (!selectedRoom || !range?.from || !range?.to || !canAdd) return;
    addLine({
      productId,
      productName,
      establishmentName,
      date: format(range.from, "yyyy-MM-dd"),
      endDate: format(range.to, "yyyy-MM-dd"),
      roomTypeId: selectedRoom.id,
      roomTypeName: selectedRoom.name,
      qty,
      priceCop: estimatedUnitPriceCop,
    });
    setJustAdded(true);
    setRange(undefined);
    setQty(1);
  }

  const qtyLabel = selectedRoom?.kind === "private" ? t("roomsQtyLabel") : t("bedsQtyLabel");
  const maxQty = selectedRoom ? Math.max(selectedRoom.maxQty, 1) : 20;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="mb-2 text-sm font-medium">{t("roomTypeTitle")}</h2>
        <div className="flex flex-col gap-2">
          {roomTypes.map((room) => (
            <button
              key={room.id}
              type="button"
              data-testid={`room-type-option-${room.id}`}
              onClick={() => handleSelectRoom(room.id)}
              aria-pressed={room.id === selectedRoomId}
              className={cn(
                "flex items-center justify-between rounded-lg border p-3 text-left text-sm transition-colors",
                room.id === selectedRoomId
                  ? "border-accent bg-surface-secondary"
                  : "border-border hover:bg-surface-secondary"
              )}
            >
              <span>
                <span className="font-medium">{room.name}</span>
                <span className="ml-2 text-muted">
                  {room.kind === "dorm" ? t("dormKind") : t("privateKind")}
                </span>
              </span>
              <span className="font-medium">{formatCop(room.priceCop)}</span>
            </button>
          ))}
        </div>
      </div>

      {selectedRoomId ? (
        <div>
          <h2 className="mb-2 text-sm font-medium">{t("availabilityTitle")}</h2>
          <Calendar
            key={selectedRoomId}
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
      ) : null}

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
        isDisabled={!selectedRoom}
        onChange={(value) => {
          const next = Number(value);
          setQty(Math.min(Math.max(next, 1), maxQty));
        }}
      >
        <Label>{qtyLabel}</Label>
        <Input id="qty" type="number" min={1} max={maxQty} />
      </TextField>

      {canAdd ? (
        <p className="text-sm font-medium" data-testid="hotel-estimated-price">
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
