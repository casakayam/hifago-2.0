"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@hifago/supabase/client";
import {
  Button,
  Label,
  ListBox,
  Select,
  SimpleTable,
  SimpleTableBody,
  SimpleTableCell,
  SimpleTableHead,
  SimpleTableHeader,
  SimpleTableRow,
  toast,
} from "@hifago/ui";

type Capability = {
  id: string;
  role: string;
  status: string;
  establishmentName: string | null;
  agreementAccepted: boolean | null;
};
type Establishment = { id: string; name: string };

const STATUSES = ["active", "suspended"] as const;
const NO_ESTABLISHMENT = "__pending__";

export function CapabilitiesSection({
  partnerId,
  capabilities,
  ownEstablishments,
}: {
  partnerId: string;
  capabilities: Capability[];
  ownEstablishments: Establishment[];
}) {
  const router = useRouter();
  const [role, setRole] = useState<"referrer" | "operator">("referrer");
  const [establishmentId, setEstablishmentId] = useState(NO_ESTABLISHMENT);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [statusUpdating, setStatusUpdating] = useState<string | null>(null);

  async function handleStatusChange(capabilityId: string, newStatus: string) {
    setStatusUpdating(capabilityId);

    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("set_capability_status", {
      p_capability_id: capabilityId,
      p_new_status: newStatus,
    });

    setStatusUpdating(null);
    if (rpcError) {
      toast.danger("No se pudo cambiar el estado de la capacidad.");
      return;
    }
    toast.success("Estado de la capacidad actualizado.");
    router.refresh();
  }

  async function handleGrant(event: React.FormEvent) {
    event.preventDefault();
    setIsSubmitting(true);

    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("grant_capability", {
      p_partner_id: partnerId,
      p_role: role,
      p_establishment_id:
        role === "operator" && establishmentId !== NO_ESTABLISHMENT ? establishmentId : undefined,
    });

    setIsSubmitting(false);
    if (rpcError) {
      toast.danger("No se pudo otorgar la capacidad (¿ya existe para este rol/establecimiento?).");
      return;
    }
    toast.success("Capacidad otorgada.");
    setEstablishmentId(NO_ESTABLISHMENT);
    router.refresh();
  }

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-lg font-medium">Capacidades</h2>

      <SimpleTable data-testid="capabilities-table" aria-label="Capacidades">
        <SimpleTableHeader>
          <SimpleTableRow>
            <SimpleTableHead>Rol</SimpleTableHead>
            <SimpleTableHead>Establecimiento</SimpleTableHead>
            <SimpleTableHead>Contrato aceptado</SimpleTableHead>
            <SimpleTableHead>Estado</SimpleTableHead>
          </SimpleTableRow>
        </SimpleTableHeader>
        <SimpleTableBody>
          {capabilities.length > 0 ? (
            capabilities.map((capability) => (
              <SimpleTableRow key={capability.id} id={capability.id} data-testid={`capability-row-${capability.id}`}>
                <SimpleTableCell data-label="Rol">{capability.role}</SimpleTableCell>
                <SimpleTableCell data-label="Establecimiento">
                  {capability.establishmentName ?? "—"}
                </SimpleTableCell>
                <SimpleTableCell data-label="Contrato aceptado">
                  {capability.agreementAccepted === null
                    ? "Sin registro"
                    : capability.agreementAccepted
                      ? "Sí"
                      : "No"}
                </SimpleTableCell>
                <SimpleTableCell data-label="Estado">
                  <Select
                    className="w-40"
                    aria-label={`Estado de la capacidad ${capability.role}`}
                    value={capability.status}
                    isDisabled={statusUpdating === capability.id}
                    onChange={(value) => value && handleStatusChange(capability.id, value as string)}
                  >
                    <Select.Trigger data-testid={`capability-status-select-${capability.id}`}>
                      <Select.Value />
                      <Select.Indicator />
                    </Select.Trigger>
                    <Select.Popover>
                      <ListBox>
                        {STATUSES.map((status) => (
                          <ListBox.Item key={status} id={status} textValue={status}>
                            {status}
                            <ListBox.ItemIndicator />
                          </ListBox.Item>
                        ))}
                      </ListBox>
                    </Select.Popover>
                  </Select>
                </SimpleTableCell>
              </SimpleTableRow>
            ))
          ) : (
            <SimpleTableRow>
              <SimpleTableCell colSpan={4} className="text-center text-muted">
                Ninguna capacidad todavía.
              </SimpleTableCell>
            </SimpleTableRow>
          )}
        </SimpleTableBody>
      </SimpleTable>

      <form onSubmit={handleGrant} noValidate className="flex flex-wrap items-end gap-3">
        <Select
          className="w-40"
          value={role}
          onChange={(value) => value && setRole(value as "referrer" | "operator")}
        >
          <Label>Rol</Label>
          <Select.Trigger data-testid="grant-role-select">
            <Select.Value />
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover>
            <ListBox>
              <ListBox.Item id="referrer" textValue="referrer">
                referrer
                <ListBox.ItemIndicator />
              </ListBox.Item>
              <ListBox.Item id="operator" textValue="operator">
                operator
                <ListBox.ItemIndicator />
              </ListBox.Item>
            </ListBox>
          </Select.Popover>
        </Select>
        {role === "operator" ? (
          <Select
            className="w-56"
            value={establishmentId}
            onChange={(value) => value && setEstablishmentId(value as string)}
          >
            <Label>Establecimiento</Label>
            <Select.Trigger data-testid="grant-establishment-select">
              <Select.Value />
              <Select.Indicator />
            </Select.Trigger>
            <Select.Popover>
              <ListBox>
                <ListBox.Item id={NO_ESTABLISHMENT} textValue="— En attente —">
                  — En attente —
                  <ListBox.ItemIndicator />
                </ListBox.Item>
                {ownEstablishments.map((establishment) => (
                  <ListBox.Item key={establishment.id} id={establishment.id} textValue={establishment.name}>
                    {establishment.name}
                    <ListBox.ItemIndicator />
                  </ListBox.Item>
                ))}
              </ListBox>
            </Select.Popover>
          </Select>
        ) : null}
        <Button type="submit" isDisabled={isSubmitting} data-testid="grant-capability-button">
          {isSubmitting ? "Otorgando…" : "Otorgar capacidad"}
        </Button>
      </form>
    </section>
  );
}
