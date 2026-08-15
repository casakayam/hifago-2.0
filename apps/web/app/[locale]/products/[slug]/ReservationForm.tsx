"use client";

import { useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
// Calendar/CalendarDayButton restent volontairement sur react-day-picker (pas le Calendar HeroUI
// v3, encore "in progress" et d'API CalendarDate totalement différente) : logique de
// modifiers/disabled/DayButton custom (dates pleines/dernière place, attribut data-date ciblé par
// plusieurs specs Playwright) qu'un remplacement ne pourrait pas reproduire à l'identique sans
// risquer une régression — décision à trancher séparément (cf. hifago/CLAUDE.md, point ouvert).
import {
  Button,
  DayPickerCalendar as Calendar,
  DayPickerCalendarDayButton as CalendarDayButton,
  Input,
  Label,
  TextField,
} from "@hifago/ui";
import { useCart } from "@/lib/cart/CartContext";

type AvailabilityRow = { date: string; capacity: number; booked: number };

export function ReservationForm({
  productId,
  productName,
  establishmentName,
  priceCop,
  availability,
}: {
  productId: string;
  productName: string;
  establishmentName: string;
  priceCop: number;
  availability: AvailabilityRow[];
}) {
  const t = useTranslations("ProductPage");
  const { lines, addLine } = useCart();
  const [selectedDate, setSelectedDate] = useState<Date | undefined>();
  const [qty, setQty] = useState(1);
  const [justAdded, setJustAdded] = useState(false);

  const byDate = useMemo(
    () => new Map(availability.map((row) => [row.date, row])),
    [availability]
  );

  // Cupos déjà occupés par CE produit/CETTE date dans le panier en cours (pas encore en base) —
  // le plafond client reste indicatif (jamais la vraie barrière, qui reste exclusivement
  // create_order au moment du checkout), mais ignorer ce qui est déjà dans le panier laisserait
  // ajouter deux fois la même dernière place sans le moindre avertissement visuel.
  const inCartByDate = useMemo(() => {
    const map = new Map<string, number>();
    for (const line of lines) {
      if (line.productId !== productId) continue;
      map.set(line.date, (map.get(line.date) ?? 0) + line.qty);
    }
    return map;
  }, [lines, productId]);

  const { fullDates, lastSpotDates } = useMemo(() => {
    const full: Date[] = [];
    const lastSpot: Date[] = [];
    for (const row of availability) {
      const remaining = row.capacity - row.booked - (inCartByDate.get(row.date) ?? 0);
      if (remaining <= 0) full.push(parseISO(row.date));
      else if (remaining === 1) lastSpot.push(parseISO(row.date));
    }
    return { fullDates: full, lastSpotDates: lastSpot };
  }, [availability, inCartByDate]);

  const selectedIso = selectedDate ? format(selectedDate, "yyyy-MM-dd") : null;
  const selectedRow = selectedIso ? byDate.get(selectedIso) : undefined;
  const remaining = selectedRow
    ? selectedRow.capacity - selectedRow.booked - (inCartByDate.get(selectedRow.date) ?? 0)
    : 0;

  // Ouvre le calendrier sur le mois de la première date configurée plutôt que sur le mois
  // courant — sans ça, un visiteur (ou un test e2e) devrait naviguer manuellement jusqu'à la
  // première disponibilité réelle.
  const defaultMonth = availability[0] ? parseISO(availability[0].date) : undefined;

  function handleSelectDate(date: Date | undefined) {
    setSelectedDate(date);
    setQty(1);
    setJustAdded(false);
  }

  function handleAddToCart() {
    if (!selectedIso || remaining < 1) return;

    // Purement local : aucun aller-retour réseau, le panier n'existe qu'en mémoire côté client
    // (cf. lib/cart/CartContext.tsx). La vraie barrière de capacité reste exclusivement
    // create_order, appelée uniquement depuis /checkout.
    addLine({
      productId,
      productName,
      establishmentName,
      date: selectedIso,
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
          onSelect={handleSelectDate}
          disabled={[
            { before: new Date() },
            (date) => !byDate.has(format(date, "yyyy-MM-dd")),
          ]}
          modifiers={{ lastSpot: lastSpotDates, full: fullDates }}
          modifiersClassNames={{
            lastSpot: "ring-2 ring-accent",
            full: "line-through opacity-60",
          }}
          components={{
            // data-date (ISO, indépendant de la locale) : cible stable pour les tests e2e, la
            // locale d'affichage du calendrier ne doit jamais faire flancher un sélecteur de test.
            DayButton: (dayButtonProps) => (
              <CalendarDayButton
                {...dayButtonProps}
                data-date={format(dayButtonProps.day.date, "yyyy-MM-dd")}
              />
            ),
          }}
        />
      </div>

      {selectedRow ? (
        <p className="text-sm text-muted" aria-live="polite">
          {remaining <= 0
            ? t("full")
            : remaining === 1
              ? t("lastSpot")
              : t("spotsLeft", { count: remaining })}
        </p>
      ) : (
        <p className="text-sm text-muted">{t("selectDate")}</p>
      )}

      <TextField
        className="max-w-32"
        name="qty"
        value={String(qty)}
        isDisabled={!selectedRow}
        onChange={(value) => {
          const next = Number(value);
          setQty(Math.min(Math.max(next, 1), Math.max(remaining, 1)));
        }}
      >
        <Label>{t("quantityLabel")}</Label>
        <Input id="qty" type="number" min={1} max={Math.max(remaining, 1)} />
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
        isDisabled={!selectedRow || remaining < 1}
      >
        {t("addToCart")}
      </Button>
    </div>
  );
}
