"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@hifago/supabase/client";
import { Button, Label, ListBox, Select, Table } from "@hifago/ui";

type Capability = {
  id: string;
  role: string;
  status: string;
  establishmentName: string | null;
  agreementAccepted: boolean | null;
};
type Establishment = { id: string; name: string };

const STATUSES = ["onboarding", "pending_review", "active", "suspended"] as const;
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
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [statusUpdating, setStatusUpdating] = useState<string | null>(null);

  async function handleStatusChange(capabilityId: string, newStatus: string) {
    setStatusUpdating(capabilityId);
    setError(null);

    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("set_capability_status", {
      p_capability_id: capabilityId,
      p_new_status: newStatus,
    });

    setStatusUpdating(null);
    if (rpcError) {
      setError("No se pudo cambiar el estado de la capacidad.");
      return;
    }
    router.refresh();
  }

  async function handleGrant(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
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
      setError("No se pudo otorgar la capacidad (¿ya existe para este rol/establecimiento?).");
      return;
    }
    setEstablishmentId(NO_ESTABLISHMENT);
    router.refresh();
  }

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-lg font-medium">Capacidades</h2>

      <Table data-testid="capabilities-table">
        <Table.ScrollContainer>
          <Table.Content aria-label="Capacidades">
            <Table.Header>
              <Table.Column isRowHeader>Rol</Table.Column>
              <Table.Column>Establecimiento</Table.Column>
              <Table.Column>Contrato aceptado</Table.Column>
              <Table.Column>Estado</Table.Column>
            </Table.Header>
            <Table.Body
              items={capabilities}
              renderEmptyState={() => (
                <p className="p-4 text-center text-sm text-muted">Ninguna capacidad todavía.</p>
              )}
            >
              {(capability) => (
                <Table.Row id={capability.id} data-testid={`capability-row-${capability.id}`}>
                  <Table.Cell>{capability.role}</Table.Cell>
                  <Table.Cell>{capability.establishmentName ?? "—"}</Table.Cell>
                  <Table.Cell>
                    {capability.agreementAccepted === null
                      ? "Sin registro"
                      : capability.agreementAccepted
                        ? "Sí"
                        : "No"}
                  </Table.Cell>
                  <Table.Cell>
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
                  </Table.Cell>
                </Table.Row>
              )}
            </Table.Body>
          </Table.Content>
        </Table.ScrollContainer>
      </Table>

      <form onSubmit={handleGrant} className="flex flex-wrap items-end gap-3">
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
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </section>
  );
}
