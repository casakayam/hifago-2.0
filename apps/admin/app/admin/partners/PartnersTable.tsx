"use client";

import Link from "next/link";
import { buttonVariants, Table } from "@hifago/ui";

type PartnerRow = {
  id: string;
  display_name: string;
  status: string;
  activeRoles: string;
  establishments: { count: number }[] | null;
};

// Composant client dédié : Table.Body/Table.Content de HeroUI attendent des enfants sous forme de
// fonction (render prop) — non sérialisable à travers la frontière Server→Client Component. La
// page (Server Component) ne passe ici que des données déjà sérialisées (rows).
export function PartnersTable({ rows }: { rows: PartnerRow[] }) {
  return (
    <Table>
      <Table.ScrollContainer>
        <Table.Content aria-label="Partners">
          <Table.Header>
            <Table.Column isRowHeader>Nombre</Table.Column>
            <Table.Column>Estado</Table.Column>
            <Table.Column>Capacidades activas</Table.Column>
            <Table.Column>Establecimientos</Table.Column>
            <Table.Column></Table.Column>
          </Table.Header>
          <Table.Body
            items={rows}
            renderEmptyState={() => (
              <p className="p-4 text-center text-sm text-muted">Ningún partner todavía.</p>
            )}
          >
            {(partner) => (
              <Table.Row id={partner.id} data-testid={`partner-row-${partner.id}`}>
                <Table.Cell>{partner.display_name}</Table.Cell>
                <Table.Cell>{partner.status}</Table.Cell>
                <Table.Cell>{partner.activeRoles || "—"}</Table.Cell>
                <Table.Cell>{partner.establishments?.[0]?.count ?? 0}</Table.Cell>
                <Table.Cell>
                  <Link
                    href={`/admin/partners/${partner.id}`}
                    className={buttonVariants({ variant: "outline", size: "sm" })}
                    data-testid={`partner-detail-link-${partner.id}`}
                  >
                    Ver
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
