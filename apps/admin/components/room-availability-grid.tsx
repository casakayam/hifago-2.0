"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@hifago/supabase/client";
import { asLocalizedField, resolveLocalizedField, formatCop } from "@hifago/domain";
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
import { useDateRateEditor } from "./use-date-rate-editor";

export type RoomTypeRow = {
  id: string;
  name: unknown;
  kind: "dorm" | "private";
  priceCop: number;
};
type AvailabilityRow = { room_type_id: string; date: string; capacity: number; booked: number };
type RateRow = { room_type_id: string; date: string; price_cop: number };
type SetAvailabilityResult = { ok: boolean; reason?: string; booked?: number; max?: number };

const ERROR_MESSAGES: Record<string, string> = {
  not_authenticated: "No se pudo verificar tu sesión. Vuelve a intentarlo.",
  room_type_not_found: "No se encontró esta habitación.",
  not_found: "No se encontró esta habitación.",
  capability_suspended: "Tu capacidad de operador para este establecimiento no está activa.",
};

function capacityMessageFor(result: SetAvailabilityResult | null): string {
  if (result?.reason === "below_booked") {
    return `La capacidad no puede ser menor a las ${result.booked} reservas ya hechas.`;
  }
  if (result?.reason === "capacity_exceeds_physical") {
    return `La capacidad no puede superar ${result.max} (límite físico de la habitación).`;
  }
  if (result?.reason === "invalid_capacity") {
    return "La capacidad debe ser un número válido.";
  }
  return ERROR_MESSAGES[result?.reason ?? ""] ?? "No se pudo guardar el cupo. Inténtalo de nuevo.";
}

function RoomDateEditor({
  roomTypeId,
  roomName,
  date,
  initialCapacity,
  initialBooked,
  initialPrice,
  basePriceCop,
  onSaved,
}: {
  roomTypeId: string;
  roomName: string;
  date: string;
  initialCapacity: string;
  initialBooked: number;
  initialPrice: string;
  basePriceCop: number;
  onSaved: () => void;
}) {
  const [capacityInput, setCapacityInput] = useState(initialCapacity);
  const [isSavingCapacity, setIsSavingCapacity] = useState(false);
  const { priceInput, setPriceInput, isSavingPrice, handlePriceSubmit } = useDateRateEditor({
    entityType: "room_type",
    entityId: roomTypeId,
    date,
    initialPrice,
    notFoundLabel: "No se encontró esta habitación.",
    genericErrorLabel: "No se pudo guardar el precio. Inténtalo de nuevo.",
    onSaved,
  });

  async function handleCapacitySubmit(event: React.FormEvent) {
    event.preventDefault();
    const capacity = Number(capacityInput);
    if (!Number.isFinite(capacity) || capacity < 0) {
      toast.danger("La capacidad debe ser un número válido.");
      return;
    }
    setIsSavingCapacity(true);
    const supabase = createClient();
    const { data, error: rpcError } = await supabase.rpc("set_room_type_availability", {
      p_room_type_id: roomTypeId,
      p_date: date,
      p_capacity: capacity,
    });
    setIsSavingCapacity(false);
    const result = data as SetAvailabilityResult | null;
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
          {roomName} — {date}
        </Modal.Heading>
      </Modal.Header>
      <Modal.Body>
        <div className="flex flex-col gap-6">
          <form onSubmit={handleCapacitySubmit} noValidate className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="room-capacity">Cupo del día</Label>
              <Input
                id="room-capacity"
                type="number"
                min={0}
                required
                value={capacityInput}
                onChange={(event) => setCapacityInput(event.target.value)}
              />
            </div>
            {initialBooked > 0 ? (
              <p className="text-sm text-muted">{initialBooked} ya reservado(s) este día.</p>
            ) : null}
            <Button
              type="submit"
              size="sm"
              isDisabled={isSavingCapacity}
              data-testid="save-room-capacity-button"
            >
              {isSavingCapacity ? "Guardando…" : "Guardar cupo"}
            </Button>
          </form>
          <form
            onSubmit={handlePriceSubmit}
            noValidate
            className="flex flex-col gap-3 border-t border-border pt-4"
          >
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="room-price">
                Precio especial (COP) — vacío = precio normal ({formatCop(basePriceCop)})
              </Label>
              <Input
                id="room-price"
                type="number"
                min={0}
                value={priceInput}
                onChange={(event) => setPriceInput(event.target.value)}
              />
            </div>
            <Button
              type="submit"
              size="sm"
              variant="outline"
              isDisabled={isSavingPrice}
              data-testid="save-room-price-button"
            >
              {isSavingPrice ? "Guardando…" : "Guardar precio"}
            </Button>
          </form>
        </div>
      </Modal.Body>
    </>
  );
}

export function RoomAvailabilityGrid({
  roomTypes,
  dates,
  availability,
  rates,
}: {
  roomTypes: RoomTypeRow[];
  dates: string[];
  availability: AvailabilityRow[];
  rates: RateRow[];
}) {
  const router = useRouter();

  const availByKey = useMemo(
    () => new Map(availability.map((row) => [`${row.room_type_id}|${row.date}`, row])),
    [availability]
  );
  const rateByKey = useMemo(
    () => new Map(rates.map((row) => [`${row.room_type_id}|${row.date}`, row.price_cop])),
    [rates]
  );
  const [selected, setSelected] = useState<{ roomTypeId: string; roomName: string; date: string } | null>(
    null
  );

  const selectedKey = selected ? `${selected.roomTypeId}|${selected.date}` : null;
  const selectedRoom = selected ? roomTypes.find((r) => r.id === selected.roomTypeId) : undefined;

  if (roomTypes.length === 0) {
    return <p className="text-sm text-muted">Este hotel todavía no tiene habitaciones definidas.</p>;
  }

  return (
    <>
      <SimpleTable className="max-md:table">
        <SimpleTableHeader className="max-md:table-header-group">
          <SimpleTableRow className={ROW_CLASS}>
            <SimpleTableHead className={STICKY_CELL_CLASS}>Habitación</SimpleTableHead>
            {dates.map((date) => (
              <SimpleTableHead key={date} className="max-md:table-cell">
                {date.slice(5)}
              </SimpleTableHead>
            ))}
          </SimpleTableRow>
        </SimpleTableHeader>
        <SimpleTableBody className="max-md:table-row-group">
          {roomTypes.map((room) => {
            const roomName = resolveLocalizedField(asLocalizedField(room.name), "es") ?? room.id;
            return (
              <SimpleTableRow key={room.id} className={ROW_CLASS} data-testid={`room-row-${room.id}`}>
                <SimpleTableCell className={`${STICKY_CELL_CLASS} font-medium`}>{roomName}</SimpleTableCell>
                {dates.map((date) => {
                  const key = `${room.id}|${date}`;
                  const row = availByKey.get(key);
                  const rate = rateByKey.get(key);
                  return (
                    <SimpleTableCell key={date} className={`${CELL_CLASS} p-1`}>
                      <button
                        type="button"
                        data-testid={`room-cell-${room.id}-${date}`}
                        className="flex w-full flex-col items-center rounded-md px-2 py-1 text-xs hover:bg-surface-secondary"
                        onClick={() => setSelected({ roomTypeId: room.id, roomName, date })}
                      >
                        <span>{row ? `${row.booked}/${row.capacity}` : "—"}</span>
                        {rate ? <span className="text-accent">{rate.toLocaleString("es-CO")}</span> : null}
                      </button>
                    </SimpleTableCell>
                  );
                })}
              </SimpleTableRow>
            );
          })}
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
              {selected && selectedRoom ? (
                <RoomDateEditor
                  key={selectedKey ?? undefined}
                  roomTypeId={selected.roomTypeId}
                  roomName={selected.roomName}
                  date={selected.date}
                  initialCapacity={(() => {
                    const row = availByKey.get(selectedKey ?? "");
                    return row ? String(row.capacity) : "";
                  })()}
                  initialBooked={availByKey.get(selectedKey ?? "")?.booked ?? 0}
                  initialPrice={(() => {
                    const price = rateByKey.get(selectedKey ?? "");
                    return price ? String(price) : "";
                  })()}
                  basePriceCop={selectedRoom.priceCop}
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
