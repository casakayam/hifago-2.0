"use client";

import { useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import { useTranslations } from "next-intl";
import {
  Button,
  DayPickerCalendar as Calendar,
  Input,
  Label,
  TextField,
  dateTaggedDayButtonComponents,
} from "@hifago/ui";
import { startOfTodayInBogota } from "@hifago/domain";
import { useCart } from "@/lib/cart/CartContext";
import { useAddToCart } from "@/lib/cart/useAddToCart";
import { mesPorDefecto, ultimoDiaReservable } from "@/lib/reservas/calendario";
import { limitarCantidad, pisoCantidad, topeCantidad } from "@/lib/reservas/cantidad";
import {
  CLAVE_PLAZAS,
  agregarEnCarrito,
  estadoDisponibilidad,
  plazasRestantes,
} from "@/lib/reservas/disponibilidad";

// Evento réservable en ligne (2026-09-15) — colocalisé comme SlotReservationForm/
// LodgingReservationForm (un seul consommateur, FichaProducto.tsx), jamais dans components/.
//
// ⚠️ Calendrier react-day-picker, MÊME composant que ReservationForm.tsx (retour Gabriel,
// 2026-09-15) : un premier essai affichait une liste de cartes plutôt qu'un calendrier, au motif
// qu'un evento a peu de dates connues à l'avance — mais `ReservationForm.tsx` (camp) prouve déjà
// que ce même calendrier gère très bien des dates rares (départs à des mois d'écart, `disabled`
// exclut tout le reste) : aucune raison de diverger, même widget partout. La "liste d'éditions" de
// `ReservationForm.tsx` est un ajout SOUS le calendrier, réservé au camp — jamais un remplacement.
//
// Trois modes de capacité, jamais mélangés dans le même rendu :
//  - 'unlimited' : aucun badge, jamais de jour barré — rien à protéger, par construction.
//  - 'metered'   : badge places restantes + jour barré dans le calendrier si complet, EXACTEMENT le
//    même calcul que les trois autres formulaires (plazasRestantes/estadoDisponibilidad).
//  - 'rsvp'      : badge « X/Y inscritos » (compteur décidé explicitement par Jérôme, jamais
//    silencieux), JAMAIS de jour barré même au-delà de Y — un aforo informatif, pas un plafond.

type EventoOccurrence = {
  date: string;
  capacity: number | null;
  booked: number | null;
  registeredQty: number | null;
};

export function EventoReservationForm({
  productId,
  minQty = 1,
  maxQty,
  capacityMode,
  occurrences,
}: {
  productId: string;
  /** `products.min_qty`, replié à 1 — même convention que `ReservationForm`. */
  minQty?: number;
  /**
   * `products.max_qty`, déjà replié à 20 par la couche catalogue — le plafond que `create_order`
   * applique réellement (`qty_cap_exceeded`), et le seul que le champ quantité doive afficher.
   *
   * ⚠️ Il sert AUSSI de valeur « pas de contrainte » aux modes unlimited/rsvp, qui n'ont aucune
   * capacité à décompter : un champ quantité a besoin d'UN maximum pour exister. Une constante
   * locale inventée ici (99, première version) prétendait un plafond que la base ne connaît pas et
   * contredisait en silence le 20 appliqué partout ailleurs.
   */
  maxQty: number;
  capacityMode: "unlimited" | "metered" | "rsvp";
  occurrences: EventoOccurrence[];
}) {
  const t = useTranslations("ProductPage");
  const { lines } = useCart();
  const addToCart = useAddToCart();
  // Même borne haute que les trois autres formulaires (six mois, décidé le 2026-08-28) — purement
  // défensive ici : `occurrences` est déjà bornée par cette même fenêtre côté requête
  // (`get_event_occurrence_availability`, `producto.ts`), le prédicat `disabled` ci-dessous exclut
  // de toute façon tout jour hors de l'ensemble connu.
  const dernierJourReservable = useMemo(() => ultimoDiaReservable(), []);

  // ⚠️ Jamais pré-sélectionné (contrairement à l'ancienne liste de cartes) : react-day-picker en
  // `mode="single"` DÉSÉLECTIONNE un jour déjà sélectionné au reclic — une date choisie d'office
  // ferait donc que le premier clic visible du visiteur sur ce jour l'efface au lieu de le confirmer.
  // Même comportement "vide au départ" que `ReservationForm.tsx`.
  const [selectedDate, setSelectedDate] = useState<string | undefined>(undefined);
  const [qty, setQty] = useState(minQty);

  const byDate = useMemo(() => new Map(occurrences.map((row) => [row.date, row])), [occurrences]);

  // Cupos déjà occupés par CE produit/CETTE date dans le panier en cours (pas encore en base) —
  // même garde-fou que les trois autres formulaires, mode 'metered' seulement (les deux autres
  // n'ont rien à protéger).
  const inCartByDate = useMemo(
    () => agregarEnCarrito(lines, (line) => line.productId === productId, (line) => line.date),
    [lines, productId]
  );

  function remainingFor(row: EventoOccurrence | undefined): number {
    if (capacityMode !== "metered" || !row || row.capacity == null) return maxQty;
    return plazasRestantes(
      { capacity: row.capacity, booked: row.booked ?? 0 },
      inCartByDate.get(row.date) ?? 0
    );
  }

  const fullDates = useMemo(() => {
    if (capacityMode !== "metered") return [];
    const full: Date[] = [];
    for (const row of occurrences) {
      if (estadoDisponibilidad(remainingFor(row)) === "completo") full.push(parseISO(row.date));
    }
    return full;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- remainingFor referme sur inCartByDate, déjà dans les deps
  }, [occurrences, capacityMode, inCartByDate]);

  const selectedRow = selectedDate ? byDate.get(selectedDate) : undefined;
  const remaining = remainingFor(selectedRow);
  // Pas de test sur `capacityMode` : `remainingFor` rend déjà `maxQty` (> 0) hors mode 'metered',
  // donc « completo » y est inatteignable par construction. Le garder faisait croire à deux règles
  // là où il n'y en a qu'une.
  const isFull = Boolean(selectedRow) && estadoDisponibilidad(remaining) === "completo";

  // Même repli que les trois autres formulaires : ouvrir sur le mois de la première occurrence,
  // jamais `undefined` (react-day-picker retomberait sur le mois du NAVIGATEUR).
  const defaultMonth = mesPorDefecto(occurrences[0]?.date);

  function handleSelectDate(date: Date | undefined) {
    if (!date) {
      setSelectedDate(undefined);
      setQty(minQty);
      return;
    }
    const iso = format(date, "yyyy-MM-dd");
    if (!byDate.has(iso)) return;
    setSelectedDate(iso);
    setQty(minQty);
  }

  async function handleAddToCart() {
    if (!selectedDate || isFull) return;
    await addToCart({ productId, date: selectedDate, qty });
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="mb-2 text-sm font-medium">{t("availabilityTitle")}</h2>
        <Calendar
          mode="single"
          defaultMonth={defaultMonth}
          selected={selectedDate ? parseISO(selectedDate) : undefined}
          // Même piège fuseau que les trois autres formulaires (lot du 2026-08-28) : le jour
          // "aujourd'hui" et la borne basse doivent venir de GUATAPÉ, jamais du navigateur.
          today={startOfTodayInBogota()}
          onSelect={handleSelectDate}
          disabled={[
            { before: startOfTodayInBogota() },
            { after: dernierJourReservable },
            (date) => !byDate.has(format(date, "yyyy-MM-dd")),
          ]}
          modifiers={{ full: fullDates }}
          modifiersClassNames={{ full: "line-through opacity-60" }}
          // data-date (ISO) : cible stable pour les tests, indépendante de la locale d'affichage.
          components={dateTaggedDayButtonComponents}
        />
      </div>

      {capacityMode === "metered" && selectedRow ? (
        <p className="text-sm text-muted" aria-live="polite">
          {t(CLAVE_PLAZAS[estadoDisponibilidad(remaining)], { count: remaining })}
        </p>
      ) : capacityMode === "rsvp" && selectedRow?.capacity != null ? (
        <p className="text-sm text-muted" aria-live="polite" data-testid="evento-rsvp-count">
          {t("rsvpCount", { registered: selectedRow.registeredQty ?? 0, max: selectedRow.capacity })}
        </p>
      ) : !selectedRow ? (
        <p className="text-sm text-muted">{t("selectDate")}</p>
      ) : null}

      <TextField
        className="max-w-32"
        name="qty"
        value={String(qty)}
        isDisabled={!selectedDate}
        onChange={(value) => setQty(limitarCantidad(Number(value), minQty, remaining))}
      >
        <Label>{t("quantityLabel")}</Label>
        <Input id="qty" type="number" min={pisoCantidad(minQty, remaining)} max={topeCantidad(remaining)} />
      </TextField>
      {minQty > 1 ? (
        <p className="text-xs text-muted" data-testid="min-qty-hint">
          {t("minQtyHint", { count: minQty })}
        </p>
      ) : null}

      <Button data-testid="add-to-cart-button" onPress={handleAddToCart} isDisabled={!selectedDate || isFull}>
        {t("addToCart")}
      </Button>
    </div>
  );
}
