"use client";

import { useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import { useTranslations } from "next-intl";
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
import { startOfTodayInBogota } from "@hifago/domain";
import { useCart } from "@/lib/cart/CartContext";

// Spec 18 §0 Tranche 1 : produit à créneaux horaires (product_slot_rules côté admin, ex. jetski —
// cf. hifago/docs/journal/2026-08.md entrée 2026-08-18, motivé par un produit réel bloqué faute de
// cet écran). Pendant de ReservationForm.tsx (capacité par date seule) mais capacité par
// (date, heure) : fichier neuf plutôt qu'un "mode" ajouté à ReservationForm, même pattern déjà
// établi par LodgingReservationForm.tsx/HotelReservationForm.tsx (une shape de réservation = un
// composant dédié).
type SlotRow = {
  slot_date: string;
  slot_start_time: string; // "HH:MM:SS" tel que renvoyé par get_product_slots (colonne Postgres time)
  capacity: number;
  booked: number;
  slot_duration_minutes: number;
};

// Normalise "HH:MM:SS" (ou déjà "HH:MM") → "HH:MM" — même convention que slotRules.ts côté admin
// (toTimeInputValue/slotRulesFromColumn) : le panier/create_order ne manipulent jamais les
// secondes, cf. CartLine.slotStartTime.
function toHHMM(time: string): string {
  return time.slice(0, 5);
}

function addMinutesToHHMM(time: string, minutes: number): string {
  const [h, m] = toHHMM(time).split(":").map(Number);
  const total = h * 60 + m + minutes;
  const endH = Math.floor(total / 60) % 24;
  const endM = total % 60;
  return `${String(endH).padStart(2, "0")}:${String(endM).padStart(2, "0")}`;
}

// Fonction pure (comme resolveTierPrice dans Lodging/HotelReservationForm) plutôt qu'une closure
// interne au composant : évite tout piège de dépendances useMemo/useCallback, le seul état externe
// dont elle a besoin (inCartByKey) est passé explicitement.
function remainingForSlot(slot: SlotRow, inCartByKey: Map<string, number>): number {
  const key = `${slot.slot_date}|${toHHMM(slot.slot_start_time)}`;
  return slot.capacity - slot.booked - (inCartByKey.get(key) ?? 0);
}

export function SlotReservationForm({
  productId,
  productName,
  establishmentName,
  priceCop,
  slots,
}: {
  productId: string;
  productName: string;
  establishmentName: string;
  priceCop: number;
  slots: SlotRow[];
}) {
  const t = useTranslations("ProductPage");
  const { lines, addLine } = useCart();
  const [selectedDate, setSelectedDate] = useState<Date | undefined>();
  const [selectedSlotStartTime, setSelectedSlotStartTime] = useState<string | undefined>();
  const [qty, setQty] = useState(1);
  const [justAdded, setJustAdded] = useState(false);

  const byDate = useMemo(() => {
    const map = new Map<string, SlotRow[]>();
    for (const slot of slots) {
      const list = map.get(slot.slot_date);
      if (list) list.push(slot);
      else map.set(slot.slot_date, [slot]);
    }
    return map;
  }, [slots]);

  // Cupos déjà occupés par CE produit/CETTE date/CE créneau dans le panier en cours (pas encore en
  // base) — même raisonnement que ReservationForm.tsx (avertissement indicatif, jamais la vraie
  // barrière, qui reste create_order au moment du checkout). Clé composée (date + heure) plutôt que
  // date seule : deux créneaux différents la même date sont deux cupos indépendants.
  const inCartByKey = useMemo(() => {
    const map = new Map<string, number>();
    for (const line of lines) {
      if (line.productId !== productId || !line.slotStartTime) continue;
      const key = `${line.date}|${line.slotStartTime}`;
      map.set(key, (map.get(key) ?? 0) + line.qty);
    }
    return map;
  }, [lines, productId]);

  const fullDates = useMemo(() => {
    const full: Date[] = [];
    for (const [date, daySlots] of byDate) {
      if (daySlots.every((slot) => remainingForSlot(slot, inCartByKey) <= 0)) {
        full.push(parseISO(date));
      }
    }
    return full;
  }, [byDate, inCartByKey]);

  // Ouvre le calendrier sur le mois du premier créneau configuré plutôt que sur le mois courant —
  // même raisonnement que ReservationForm.tsx.
  // Même repli que ReservationForm.tsx : `undefined` renverrait react-day-picker sur le mois du
  // navigateur (cf. le commentaire détaillé là-bas).
  const defaultMonth = slots[0] ? parseISO(slots[0].slot_date) : startOfTodayInBogota();

  const selectedIso = selectedDate ? format(selectedDate, "yyyy-MM-dd") : null;
  const daySlots = selectedIso ? (byDate.get(selectedIso) ?? []) : [];
  const selectedSlot = selectedSlotStartTime
    ? daySlots.find((slot) => toHHMM(slot.slot_start_time) === selectedSlotStartTime)
    : undefined;
  const slotRemaining = selectedSlot ? remainingForSlot(selectedSlot, inCartByKey) : 0;

  function handleSelectDate(date: Date | undefined) {
    setSelectedDate(date);
    setSelectedSlotStartTime(undefined);
    setQty(1);
    setJustAdded(false);
  }

  function handleSelectSlot(slot: SlotRow) {
    if (remainingForSlot(slot, inCartByKey) < 1) return;
    setSelectedSlotStartTime(toHHMM(slot.slot_start_time));
    setQty(1);
  }

  function handleAddToCart() {
    if (!selectedIso || !selectedSlot || slotRemaining < 1) return;

    // Purement local : aucun aller-retour réseau, le panier n'existe qu'en mémoire côté client
    // (cf. lib/cart/CartContext.tsx). La vraie barrière de capacité reste exclusivement
    // create_order, appelée uniquement depuis /checkout.
    addLine({
      productId,
      productName,
      establishmentName,
      date: selectedIso,
      slotStartTime: toHHMM(selectedSlot.slot_start_time),
      qty,
      priceCop,
    });
    setJustAdded(true);
    setQty(1);
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="mb-2 text-sm font-medium">{t("availabilityTitle")}</h2>
        <Calendar
          mode="single"
          defaultMonth={defaultMonth}
          selected={selectedDate}
          // Le jour « aujourd'hui » mis en avant par react-day-picker vient sinon de son propre
          // `dateLib.today()` = `new Date()` du runtime (DayPicker.js:167), donc du NAVIGATEUR.
          // Sans cette prop, le correctif de `disabled` ci-dessous et le surlignage se
          // contrediraient pour un visiteur hors Colombie : le 27 resterait cliquable mais le 28
          // serait peint comme « aujourd'hui ».
          today={startOfTodayInBogota()}
          onSelect={handleSelectDate}
          disabled={[
            // Minuit à GUATAPÉ, jamais l'heure du NAVIGATEUR (lot fuseau, 2026-08-28) : un visiteur
            // européen ouvrant la fiche le 1er du mois à 2 h du matin voyait le dernier jour du mois
            // précédent barré, alors qu'à Guatapé il était encore réservable.
            { before: startOfTodayInBogota() },
            (date) => {
              const daySlotsForDate = byDate.get(format(date, "yyyy-MM-dd"));
              if (!daySlotsForDate) return true;
              return daySlotsForDate.every((slot) => remainingForSlot(slot, inCartByKey) <= 0);
            },
          ]}
          modifiers={{ full: fullDates }}
          modifiersClassNames={{ full: "line-through opacity-60" }}
          // data-date (ISO, indépendant de la locale) : cible stable pour les tests e2e, même
          // convention que ReservationForm.tsx. Référence module-scope (packages/ui), jamais
          // reconstruite ici à chaque rendu — cf. sa doc.
          components={dateTaggedDayButtonComponents}
        />
      </div>

      {selectedSlot ? (
        <p className="text-sm text-muted" aria-live="polite" data-testid="slot-summary">
          {slotRemaining <= 0
            ? t("full")
            : slotRemaining === 1
              ? t("lastSpot")
              : t("spotsLeft", { count: slotRemaining })}
        </p>
      ) : selectedIso ? (
        <p className="text-sm text-muted">{t("selectSlotTime")}</p>
      ) : (
        <p className="text-sm text-muted">{t("selectSlotDate")}</p>
      )}

      {selectedIso ? (
        <div className="flex flex-wrap gap-2">
          {daySlots.map((slot) => {
            const slotStart = toHHMM(slot.slot_start_time);
            const slotEnd = addMinutesToHHMM(slot.slot_start_time, slot.slot_duration_minutes);
            const slotRemainingCount = remainingForSlot(slot, inCartByKey);
            const isFull = slotRemainingCount <= 0;
            const isSelected = selectedSlotStartTime === slotStart;
            return (
              <button
                key={slotStart}
                type="button"
                data-testid={`slot-chip-${selectedIso}-${slotStart}`}
                onClick={() => handleSelectSlot(slot)}
                disabled={isFull}
                aria-pressed={isSelected}
                className={cn(
                  "flex flex-col rounded-lg border px-3 py-2 text-left text-sm transition-colors",
                  isFull
                    ? "cursor-not-allowed border-border opacity-50 line-through"
                    : isSelected
                      ? "border-accent bg-surface-secondary"
                      : "border-border hover:bg-surface-secondary"
                )}
              >
                <span className="font-medium">
                  {slotStart}–{slotEnd}
                </span>
                <span className="text-muted">
                  {isFull
                    ? t("full")
                    : slotRemainingCount === 1
                      ? t("lastSpot")
                      : t("spotsLeft", { count: slotRemainingCount })}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}

      <TextField
        className="max-w-32"
        name="qty"
        value={String(qty)}
        isDisabled={!selectedSlot}
        onChange={(value) => {
          const next = Number(value);
          setQty(Math.min(Math.max(next, 1), Math.max(slotRemaining, 1)));
        }}
      >
        <Label>{t("quantityLabel")}</Label>
        <Input id="qty" type="number" min={1} max={Math.max(slotRemaining, 1)} />
      </TextField>

      {justAdded ? (
        <p role="status" data-testid="added-to-cart" className="text-sm font-medium text-accent">
          {t("addedToCart")}{" "}
          <Link href="/checkout" className="underline" data-testid="go-to-checkout-link">
            {t("goToCheckout")}
          </Link>
        </p>
      ) : null}

      <Button
        data-testid="add-to-cart-button"
        onPress={handleAddToCart}
        isDisabled={!selectedSlot || slotRemaining < 1}
      >
        {t("addToCart")}
      </Button>
    </div>
  );
}
