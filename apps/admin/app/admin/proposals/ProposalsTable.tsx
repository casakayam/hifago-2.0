"use client";

import Link from "next/link";
import { buttonVariants, Table } from "@hifago/ui";

type ProposalRow = {
  id: string;
  created_at: string;
  kind: string;
  entityType: "product" | "establishment";
  displayName: string;
  partner: { display_name: string } | null;
};

const KIND_LABELS: Record<string, string> = {
  content: "Contenido",
  photos: "Fotos",
  create: "Creación",
  edit: "Edición",
};

// Composant client dédié : Table.Body/Table.Content de HeroUI attendent des enfants sous forme de
// fonction (render prop) — non sérialisable à travers la frontière Server→Client Component.
// Fusion product_proposals ∪ establishment_proposals (docs/specs/06-gestion-etablissement.md) —
// même table, même écran, distingués par entityType pour router vers le bon détail (?entity=).
export function ProposalsTable({ proposals }: { proposals: ProposalRow[] }) {
  return (
    <Table>
      <Table.ScrollContainer>
        <Table.Content aria-label="Propuestas pendientes">
          <Table.Header>
            <Table.Column isRowHeader>Actividad / Establecimiento</Table.Column>
            <Table.Column>Tipo</Table.Column>
            <Table.Column>Partner</Table.Column>
            <Table.Column>Enviada</Table.Column>
            <Table.Column id="actions" />
          </Table.Header>
          <Table.Body
            items={proposals}
            renderEmptyState={() => (
              <p className="py-4 text-center text-sm text-muted">Ninguna propuesta pendiente.</p>
            )}
          >
            {(proposal) => (
              <Table.Row id={proposal.id} data-testid={`proposal-row-${proposal.id}`}>
                <Table.Cell>{proposal.displayName}</Table.Cell>
                <Table.Cell data-testid={`proposal-kind-${proposal.id}`}>
                  {KIND_LABELS[proposal.kind] ?? proposal.kind}
                </Table.Cell>
                <Table.Cell>{proposal.partner?.display_name ?? "—"}</Table.Cell>
                <Table.Cell>{new Date(proposal.created_at).toLocaleDateString("es")}</Table.Cell>
                <Table.Cell>
                  <Link
                    href={
                      proposal.entityType === "establishment"
                        ? `/admin/proposals/${proposal.id}?entity=establishment`
                        : `/admin/proposals/${proposal.id}`
                    }
                    className={buttonVariants({ variant: "outline", size: "sm" })}
                    data-testid={`review-link-${proposal.id}`}
                  >
                    Revisar
                  </Link>
                </Table.Cell>
              </Table.Row>
            )}
          </Table.Body>
        </Table.Content>
      </Table.ScrollContainer>
    </Table>
  );
}
