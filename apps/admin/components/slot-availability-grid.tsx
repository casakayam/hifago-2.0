"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@hifago/supabase/client";
import {
  Button,
  Input,
  Label,
  Modal,
  toast,
  SimpleTable,
  SimpleTableHeader,
  SimpleTableBody,
  SimpleTableRow,
  SimpleTableHead,
  SimpleTableCell,
} from "@hifago/ui";
import { ROW_CLASS, CELL_CLASS, STICKY_CELL_CLASS } from "./availability-grid-shared";

export type SlotAvailabilityRow = {
  slot_date: string;
  slot_start_time: string;
  capacity: number;
  booked: number;
  slot_duration_minutes: number;
};
type SetSlotCapacityResult = { ok: boolean; reason?: string; booked?: number };

const ERROR_MESSAGES: Record<string, string> = {
  not_authenticated: "No se pudo verificar tu sesión. Vuelve a intentarlo.",
  product_not_found: "No se encontró este horario.",
  capability_suspended: "Tu capacidad de operador para este establecimiento no está activa.",
};

function capacityMessageFor(result: SetSlotCapacityResult | null): string {
  if (result?.reason === "below_booked") {
    return `La capacidad no puede ser menor a las ${result.booked} reservas ya hechas.`;
  }
  if (result?.reason === "invalid_capacity") {
    return "La capacidad debe ser un número válido.";
  }
  if (result?.reason === "slot_not_found") {
    return "Este horario ya no corresponde a ninguna regla activa.";
  }
  return ERROR_MESSAGES[result?.reason ?? ""] ?? "No se pudo guardar el cupo. Inténtalo de nuevo.";
}

function SlotDateEditor({
  productId,
  slotStartTime,
  date,
  initialCapacity,
  initialBooked,
  onSaved,
}: {
  productId: string;
  slotStartTime: string;
  date: string;
  initialCapacity: string;
  initialBooked: number;
  onSaved: () => void;
}) {
  const [capacityInput, setCapacityInput] = useState(initialCapacity);
  const [isSaving, setIsSaving] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const capacity = Number(capacityInput);
    if (!Number.isFinite(capacity) || capacity < 0) {
      toast.danger("La capacidad debe ser un número válido.");
      return;
    }
    setIsSaving(true);
    const supabase = createClient();
    const { data, error: rpcError } = await supabase.rpc("set_product_slot_capacity", {
      p_product_id: productId,
      p_date: date,
      p_slot_start_time: slotStartTime,
      p_capacity: capacity,
    });
    setIsSaving(false);
    const result = data as SetSlotCapacityResult | null;
    if (rpcError || !result?.ok) {
      toast.danger(capacityMessageFor(result));
      return;
    }
    toast.success("Cupo actualizado.");
    onSaved();
  }

  return (
    <>
      <Modal.Header>
        <Modal.Heading>
          {slotStartTime.slice(0, 5)} — {date}
        </Modal.Heading>
      </Modal.Header>
      <Modal.Body>
        <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="slot-capacity">Cupo del horario</Label>
            <Input
              id="slot-capacity"
              type="number"
              min={0}
              required
              value={capacityInput}
              onChange={(event) => setCapacityInput(event.target.value)}
            />
          </div>
          {initialBooked > 0 ? (
            <p className="text-sm text-muted">{initialBooked} ya reservado(s) este horario.</p>
          ) : null}
          <Button
            type="submit"
            size="sm"
            isDisabled={isSaving}
            data-testid="save-slot-capacity-button"
          >
            {isSaving ? "Guardando…" : "Guardar cupo"}
          </Button>
        </form>
      </Modal.Body>
    </>
  );
}

export function SlotAvailabilityGrid({
  productId,
  dates,
  slots,
}: {
  productId: string;
  dates: string[];
  slots: SlotAvailabilityRow[];
}) {
  const router = useRouter();

  // Lignes = horaires distincts observés dans `slots` (virtuels + matérialisés, déjà fusionnés par
  // get_product_slots côté SQL) — jamais une prop "règles" séparée, ce composant ne connaît que le
  // résultat déjà résolu pour la plage de dates affichée.
  const rows = useMemo(
    () => Array.from(new Set(slots.map((row) => row.slot_start_time))).sort(),
    [slots],
  );

  const slotByKey = useMemo(
    () => new Map(slots.map((row) => [`${row.slot_date}|${row.slot_start_time}`, row])),
    [slots],
  );

  const [selected, setSelected] = useState<{ slotStartTime: string; date: string } | null>(null);
  const selectedKey = selected ? `${selected.date}|${selected.slotStartTime}` : null;

  if (rows.length === 0) {
    return <p className="text-sm text-muted">Este producto todavía no tiene horarios definidos.</p>;
  }

  return (
    <>
      <SimpleTable className="max-md:table">
        <SimpleTableHeader className="max-md:table-header-group">
          <SimpleTableRow className={ROW_CLASS}>
            <SimpleTableHead className={STICKY_CELL_CLASS}>Horario</SimpleTableHead>
            {dates.map((date) => (
              <SimpleTableHead key={date} className="max-md:table-cell">
                {date.slice(5)}
              </SimpleTableHead>
            ))}
          </SimpleTableRow>
        </SimpleTableHeader>
        <SimpleTableBody className="max-md:table-row-group">
          {rows.map((slotStartTime) => (
            <SimpleTableRow
              key={slotStartTime}
              className={ROW_CLASS}
              data-testid={`slot-row-${slotStartTime}`}
            >
              <SimpleTableCell className={`${STICKY_CELL_CLASS} font-medium`}>
                {slotStartTime.slice(0, 5)}
              </SimpleTableCell>
              {dates.map((date) => {
                const key = `${date}|${slotStartTime}`;
                const row = slotByKey.get(key);
                return (
                  <SimpleTableCell key={date} className={`${CELL_CLASS} p-1`}>
                    <button
                      type="button"
                      data-testid={`slot-cell-${slotStartTime}-${date}`}
                      className="flex w-full items-center justify-center rounded-md px-2 py-1 text-xs hover:bg-surface-secondary"
                      onClick={() => setSelected({ slotStartTime, date })}
                    >
                      {row ? `${row.booked}/${row.capacity}` : "—"}
                    </button>
                  </SimpleTableCell>
                );
              })}
            </SimpleTableRow>
          ))}
        </SimpleTableBody>
      </SimpleTable>

      <Modal>
        <Modal.Backdrop
          isOpen={selected !== null}
          onOpenChange={(open) => {
            if (!open) setSelected(null);
          }}
        >
          <Modal.Container>
            <Modal.Dialog>
              <Modal.CloseTrigger />
              {selected ? (
                <SlotDateEditor
                  key={selectedKey ?? undefined}
                  productId={productId}
                  slotStartTime={selected.slotStartTime}
                  date={selected.date}
                  initialCapacity={(() => {
                    const row = slotByKey.get(selectedKey ?? "");
                    return row ? String(row.capacity) : "";
                  })()}
                  initialBooked={slotByKey.get(selectedKey ?? "")?.booked ?? 0}
                  onSaved={() => {
                    setSelected(null);
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
