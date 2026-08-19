"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@hifago/supabase/client";
import { Button, Table, toast } from "@hifago/ui";
import { SearchableCombobox } from "@/components/searchable-combobox";

type OwnEstablishment = { id: string; name: string; status: string };
type AnyEstablishment = { id: string; name: string; ownerName: string };

export function EstablishmentsSection({
  partnerId,
  ownEstablishments,
  allEstablishments,
}: {
  partnerId: string;
  ownEstablishments: OwnEstablishment[];
  allEstablishments: AnyEstablishment[];
}) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleTransfer(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedId) return;
    setIsSubmitting(true);

    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("transfer_establishment", {
      p_establishment_id: selectedId,
      p_new_partner_id: partnerId,
    });

    setIsSubmitting(false);
    if (rpcError) {
      toast.danger("No se pudo transferir el establecimiento.");
      return;
    }
    toast.success("Establecimiento transferido.");
    setSelectedId(null);
    router.refresh();
  }

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-lg font-medium">Establecimientos</h2>

      <Table data-testid="own-establishments-table">
        <Table.ScrollContainer>
          <Table.Content aria-label="Establecimientos propios">
            <Table.Header>
              <Table.Column isRowHeader>Nombre</Table.Column>
              <Table.Column>Estado</Table.Column>
            </Table.Header>
            <Table.Body
              items={ownEstablishments}
              renderEmptyState={() => (
                <p className="p-4 text-center text-sm text-muted">Ningún establecimiento todavía.</p>
              )}
            >
              {(establishment) => (
                <Table.Row
                  id={establishment.id}
                  data-testid={`own-establishment-row-${establishment.id}`}
                >
                  <Table.Cell>{establishment.name}</Table.Cell>
                  <Table.Cell>{establishment.status}</Table.Cell>
                </Table.Row>
              )}
            </Table.Body>
          </Table.Content>
        </Table.ScrollContainer>
      </Table>

      {/* Sélecteur sur TOUT le registre (pas seulement les établissements "libres" — aucun ne
          l'est jamais, establishments.partner_id est not null) : transfer_establishment n'a qu'un
          seul chemin, premier rattachement et transfert confondus. */}
      <form onSubmit={handleTransfer} noValidate className="flex flex-wrap items-end gap-3">
        <div className="w-72">
          <SearchableCombobox
            items={allEstablishments}
            getKey={(establishment) => establishment.id}
            getLabel={(establishment) => establishment.name}
            value={selectedId}
            onChange={setSelectedId}
            label="Transferir un establecimiento a este partner"
            placeholder="Buscar establecimiento…"
            testId="transfer-establishment-search"
            renderItem={(establishment) => `${establishment.name} — actualmente: ${establishment.ownerName}`}
          />
        </div>
        <Button
          type="submit"
          isDisabled={isSubmitting || !selectedId}
          data-testid="transfer-establishment-button"
        >
          {isSubmitting ? "Transfiriendo…" : "Transferir"}
        </Button>
      </form>
    </section>
  );
}
