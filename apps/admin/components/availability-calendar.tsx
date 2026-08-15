"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";
import type { DateClickArg } from "@fullcalendar/interaction";
import type { DatesSetArg, EventInput } from "@fullcalendar/core";
import "./availability-calendar.css";
import { createClient } from "@hifago/supabase/client";
import { Button, Input, Label, Modal, Switch } from "@hifago/ui";

type AvailabilityRow = { date: string; capacity: number; booked: number };
type CalendarRow = { date: string; open: boolean };
type SetAvailabilityResult = { ok: boolean; reason?: string; booked?: number };

// Même service pour l'admin (feature 5) et le socio (feature 17) — cf. cahier des charges socio
// §3d : "jamais deux vérités différentes du même calendrier". set_product_availability retourne
// désormais jsonb {ok, reason} (feature 17 a remplacé l'exception par un refus métier normal pour
// tout appelant non-admin) — messages mappés proprement, jamais un code brut affiché.
const AVAILABILITY_ERRORS: Record<string, string> = {
  not_authenticated: "No se pudo verificar tu sesión. Vuelve a intentarlo.",
  product_not_found: "No se encontró la actividad.",
  capability_suspended: "Tu capacidad de operador para este establecimiento no está activa.",
};

function messageFor(result: SetAvailabilityResult | null): string {
  if (result?.reason === "below_booked") {
    return `La capacidad no puede ser menor a las ${result.booked} plazas ya reservadas.`;
  }
  return (
    AVAILABILITY_ERRORS[result?.reason ?? ""] ??
    "No se pudo guardar la disponibilidad. Inténtalo de nuevo."
  );
}

// Un jour à la fois : closed (fermé, explicite ou via calendar_default_open) prime toujours sur
// configured (une ligne product_availability existe) qui prime sur unconfigured (aucune des deux
// tables n'a de ligne pour ce jour) — cf. plan feature 5.
function statusFor(
  dateStr: string,
  availabilityByDate: Map<string, AvailabilityRow>,
  calendarByDate: Map<string, boolean>,
  calendarDefaultOpen: boolean
) {
  const explicitOpen = calendarByDate.get(dateStr);
  const isOpen = explicitOpen ?? calendarDefaultOpen;
  if (!isOpen) {
    return { kind: "closed" as const };
  }
  const row = availabilityByDate.get(dateStr);
  if (row) {
    return { kind: "configured" as const, capacity: row.capacity, booked: row.booked };
  }
  return { kind: "unconfigured" as const };
}

function addDays(dateStr: string, days: number): string {
  const date = new Date(`${dateStr}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// Champs du formulaire dans un composant séparé, avec son propre état local (capacité, ouvert,
// erreur, soumission) — sans cette extraction, chaque frappe dans le champ capacité re-rendait
// AvailabilityCalendar en entier, donc <FullCalendar> (qui n'a pas de shouldComponentUpdate :
// `componentDidUpdate` réinitialise systématiquement ses options), remontant toute la grille du
// mois à chaque caractère tapé.
function AvailabilityFormFields({
  selectedDate,
  entityId,
  mode,
  initialCapacity,
  initialOpen,
  onSaved,
}: {
  selectedDate: string;
  entityId: string;
  mode: "product" | "resource";
  initialCapacity: string;
  initialOpen: boolean;
  onSaved: () => void;
}) {
  const [capacityInput, setCapacityInput] = useState(initialCapacity);
  const [openInput, setOpenInput] = useState(initialOpen);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    const capacity = Number(capacityInput);
    if (!Number.isFinite(capacity) || capacity < 0) {
      setError("La capacidad debe ser un número válido.");
      return;
    }

    setIsSubmitting(true);
    const supabase = createClient();
    // set_provider_resource_capacity n'a pas de p_open (pas de notion de fermeture calendaire pour
    // une ressource partagée) — seul set_product_availability en a besoin.
    const { data, error: rpcError } =
      mode === "resource"
        ? await supabase.rpc("set_provider_resource_capacity", {
            p_establishment_id: entityId,
            p_date: selectedDate,
            p_capacity: capacity,
          })
        : await supabase.rpc("set_product_availability", {
            p_product_id: entityId,
            p_date: selectedDate,
            p_capacity: capacity,
            p_open: openInput,
          });

    setIsSubmitting(false);

    const result = data as SetAvailabilityResult | null;
    if (rpcError || !result?.ok) {
      setError(messageFor(result));
      return;
    }

    onSaved();
  }

  return (
    <form onSubmit={handleSubmit} className="contents">
      <Modal.Header>
        <Modal.Heading>{selectedDate}</Modal.Heading>
      </Modal.Header>
      <Modal.Body>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="capacity">Capacidad</Label>
            <Input
              id="capacity"
              name="capacity"
              type="number"
              min={0}
              required
              value={capacityInput}
              onChange={(event) => setCapacityInput(event.target.value)}
            />
          </div>
          {mode === "product" ? (
            <Switch isSelected={openInput} onChange={setOpenInput}>
              <Switch.Content>
                <Switch.Control>
                  <Switch.Thumb />
                </Switch.Control>
                {openInput ? "Abierto" : "Cerrado"}
              </Switch.Content>
            </Switch>
          ) : null}
          {error ? (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : null}
        </div>
      </Modal.Body>
      <Modal.Footer>
        <Button type="submit" isDisabled={isSubmitting} data-testid="save-availability-button">
          {isSubmitting ? "Guardando…" : "Guardar"}
        </Button>
      </Modal.Footer>
    </form>
  );
}

export function AvailabilityCalendar({
  entityId,
  mode = "product",
  calendarDefaultOpen = true,
  availability,
  calendar = [],
}: {
  entityId: string;
  // Feature 20 : "resource" adapte le même composant à la clé établissement (ressource partagée
  // d'un camp, provider_resource_calendar → set_provider_resource_capacity) plutôt que produit
  // (product_availability → set_product_availability) — même écran, même geste admin, seule la clé
  // et la RPC cible changent. Aucune notion "open" pour une ressource partagée (juste une
  // capacité) : le Switch reste caché en mode "resource".
  mode?: "product" | "resource";
  calendarDefaultOpen?: boolean;
  availability: AvailabilityRow[];
  calendar?: CalendarRow[];
}) {
  const router = useRouter();

  const availabilityByDate = useMemo(
    () => new Map(availability.map((row) => [row.date, row])),
    [availability]
  );
  const calendarByDate = useMemo(
    () => new Map(calendar.map((row) => [row.date, row.open])),
    [calendar]
  );

  // Bornes du mois actuellement affiché (mises à jour par FullCalendar via datesSet à chaque
  // navigation) — nécessaire pour afficher un badge sur CHAQUE jour visible, y compris ceux sans
  // aucune ligne en base (cf. plan : "chaque jour affiche son état").
  const [visibleRange, setVisibleRange] = useState<{ start: string; end: string } | null>(null);

  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  // Mémorise la dernière date sélectionnée : le contenu du formulaire reste affiché pendant
  // l'animation de fermeture du Modal (isOpen passe à false avant le démontage), plutôt que de
  // disparaître instantanément dès que selectedDate repasse à null. Pattern React documenté
  // ("Adjusting state during rendering") plutôt qu'une ref : `react-hooks/refs` interdit toute
  // lecture/écriture de `.current` pendant le rendu.
  const [displayDate, setDisplayDate] = useState<string | null>(null);
  if (selectedDate !== null && selectedDate !== displayDate) {
    setDisplayDate(selectedDate);
  }

  function handleDatesSet(arg: DatesSetArg) {
    setVisibleRange({ start: arg.startStr.slice(0, 10), end: arg.endStr.slice(0, 10) });
  }

  function openFormFor(dateStr: string) {
    setSelectedDate(dateStr);
  }

  function handleDateClick(info: DateClickArg) {
    openFormFor(info.dateStr);
  }

  // Chaque jour affiche un badge (event) qui recouvre l'essentiel de la cellule (cf. plan :
  // "chaque jour affiche son état") — un clic y atterrit plus souvent que sur la cellule vide
  // elle-même, et FullCalendar ne route pas ce clic vers dateClick. Sans ce handler, le
  // formulaire ne s'ouvrirait quasiment jamais en pratique.
  function handleEventClick(info: { event: { startStr: string } }) {
    openFormFor(info.event.startStr.slice(0, 10));
  }

  const events: EventInput[] = useMemo(() => {
    if (!visibleRange) return [];
    const items: EventInput[] = [];
    for (let dateStr = visibleRange.start; dateStr < visibleRange.end; dateStr = addDays(dateStr, 1)) {
      const status = statusFor(dateStr, availabilityByDate, calendarByDate, calendarDefaultOpen);
      let title = "Sin configurar";
      let className = "availability-badge availability-badge--unconfigured";
      if (status.kind === "closed") {
        title = "Cerrado";
        className = "availability-badge availability-badge--closed";
      } else if (status.kind === "configured") {
        title = `${status.booked}/${status.capacity}`;
        className = "availability-badge availability-badge--configured";
      }
      items.push({
        start: dateStr,
        allDay: true,
        title,
        display: "list-item",
        classNames: [className],
      });
    }
    return items;
  }, [visibleRange, availabilityByDate, calendarByDate, calendarDefaultOpen]);

  return (
    <>
      <FullCalendar
        plugins={[dayGridPlugin, interactionPlugin]}
        initialView="dayGridMonth"
        height="auto"
        events={events}
        datesSet={handleDatesSet}
        dateClick={handleDateClick}
        eventClick={handleEventClick}
      />

      <Modal>
        <Modal.Backdrop
          isOpen={selectedDate !== null}
          onOpenChange={(open) => {
            if (!open) setSelectedDate(null);
          }}
        >
          <Modal.Container>
            <Modal.Dialog>
              <Modal.CloseTrigger />
              {displayDate !== null ? (
                <AvailabilityFormFields
                  key={displayDate}
                  selectedDate={displayDate}
                  entityId={entityId}
                  mode={mode}
                  initialCapacity={(() => {
                    const row = availabilityByDate.get(displayDate);
                    return row ? String(row.capacity) : "";
                  })()}
                  initialOpen={calendarByDate.get(displayDate) ?? calendarDefaultOpen}
                  onSaved={() => {
                    setSelectedDate(null);
                    router.refresh();
                  }}
                />
              ) : null}
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    </>
  );
}
