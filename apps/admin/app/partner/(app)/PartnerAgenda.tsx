"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Calendar, Willow, type CalendarInstanceApi } from "@svar-ui/react-calendar";
// "style.css" (export par défaut) ne porte que 119 sélecteurs .wx-* — un sous-ensemble sans les
// boutons/toolbar/icônes (constaté en comparant dist/index.css à dist-full/index.css : 119 vs 309
// sélecteurs uniques). "all.css" est le CSS complet du thème Willow — c'est celui qu'il faut.
import "@svar-ui/react-calendar/all.css";
import { Button } from "@hifago/ui";
import type { AgendaEvent } from "@/lib/agenda/positionOrderLines";
import { AddReservationDialog, type ProductOption } from "./AddReservationDialog";

const MOBILE_BREAKPOINT_QUERY = "(max-width: 767px)";

// Spec 20 §0/§10 point 11 — @svar-ui/react-calendar retenu après un premier essai MUI X Scheduler
// abandonné (aucun callback de clic public, cf. docs/04-architecture-cible.md révision
// 2026-08-18). `<Editor>` de SVAR n'est jamais monté ici : onSelectEvent/onAddEvent pilotent
// intégralement notre propre UI (fiche + AddReservationDialog), rien de l'édition intégrée SVAR
// n'est utilisé. move-event/update-event/delete-event sont bloquées via api.intercept — sans ça,
// un glisser-déposer accidentel modifierait visuellement une réservation sans jamais passer par
// modify_order_line/set_order_line_status (cf. spec 20 §10 point 11).
export function PartnerAgenda({
  events,
  productOptions,
}: {
  events: AgendaEvent[];
  productOptions: ProductOption[];
}) {
  const router = useRouter();
  const apiRef = useRef<CalendarInstanceApi | null>(null);
  const [view, setView] = useState<"day" | "week" | "month">("month");
  const [addDialog, setAddDialog] = useState<{ date: Date } | null>(null);

  useEffect(() => {
    const mql = window.matchMedia(MOBILE_BREAKPOINT_QUERY);
    const applyFromViewport = () => setView(mql.matches ? "day" : "month");
    applyFromViewport();
    mql.addEventListener("change", applyFromViewport);
    return () => mql.removeEventListener("change", applyFromViewport);
  }, []);

  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    api.intercept("move-event", () => false);
    api.intercept("update-event", () => false);
    api.intercept("delete-event", () => false);
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button
          size="sm"
          data-testid="new-reservation-button"
          onPress={() => setAddDialog({ date: new Date() })}
        >
          Nueva reserva
        </Button>
      </div>
      <Willow>
        <div className="h-[70vh] min-h-[420px] md:h-[700px]">
          <Calendar
            ref={apiRef}
            events={events}
            view={view}
            views={["day", "week", "month"]}
            onViewChange={(ev: { view: string }) => setView(ev.view as "day" | "week" | "month")}
            onSelectEvent={(ev: { id: string | number | null }) => {
              if (ev.id !== null) {
                router.push(`/partner/reservations/${ev.id}`);
              }
            }}
            onAddEvent={(ev: { event: { start?: Date } }) => {
              setAddDialog({ date: ev.event.start ?? new Date() });
            }}
          />
        </div>
      </Willow>

      {addDialog ? (
        <AddReservationDialog
          initialDate={addDialog.date}
          productOptions={productOptions}
          open={addDialog !== null}
          onOpenChange={(open) => {
            if (!open) setAddDialog(null);
          }}
          onSuccess={() => {
            setAddDialog(null);
            router.refresh();
          }}
        />
      ) : null}
    </div>
  );
}
