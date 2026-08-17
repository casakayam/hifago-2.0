"use client";

import { DataList, type DataListAction, type DataListColumn, type DataListSort, viewAction } from "@hifago/ui";
import { RevokeInvitationButton } from "./RevokeInvitationButton";
import { InvitationStatusChip } from "./InvitationStatusChip";
import { ONBOARDING_PATH_LABELS } from "./invitationLabels";
import { INVITATIONS_FILTERS } from "@/lib/lists/filters";

export type InvitationRow = {
  id: string;
  promoCode: string;
  onboardingPath: string;
  status: string;
  createdAt: string;
  expiresAt: string;
  consumedAt: string | null;
  // Résolu côté serveur (page.tsx) : partenaire Prestador consommé sans établissement — null si
  // non applicable (statut différent, ou établissement déjà rattaché).
  missingEstablishmentPartnerId: string | null;
};

export type InvitationsListProps = {
  rows: InvitationRow[];
  page: number;
  pageSize: number;
  totalCount: number;
  sort: DataListSort;
  filterValues: Record<string, string>;
  extraParams: Record<string, string>;
};

// docs/specs/10-listes-standardisees-admin-socio.md §5.3/§5.4 — nouvelle fiche détail
// /admin/invitations/[id] (n'existait pas), clic ligne désormais possible.
export function InvitationsList({
  rows,
  page,
  pageSize,
  totalCount,
  sort,
  filterValues,
  extraParams,
}: InvitationsListProps) {
  const columns: DataListColumn<InvitationRow>[] = [
    { id: "promo_code", header: "Código", sortable: true, cell: (row) => row.promoCode },
    {
      id: "onboarding_path",
      header: "Tipo",
      sortable: true,
      cell: (row) => ONBOARDING_PATH_LABELS[row.onboardingPath] ?? row.onboardingPath,
    },
    {
      id: "status",
      header: "Estado",
      sortable: true,
      cell: (row) => <InvitationStatusChip status={row.status} />,
    },
    {
      id: "created_at",
      header: "Creada",
      sortable: true,
      cell: (row) => new Date(row.createdAt).toLocaleDateString("es"),
    },
    {
      id: "expires_at",
      header: "Expira",
      sortable: true,
      cell: (row) => new Date(row.expiresAt).toLocaleDateString("es"),
    },
    {
      id: "consumed_at",
      header: "Consumida",
      sortable: true,
      cell: (row) => (row.consumedAt ? new Date(row.consumedAt).toLocaleDateString("es") : "—"),
    },
  ];

  const actions: DataListAction<InvitationRow>[] = [
    viewAction("/admin/invitations", "invitation"),
    {
      id: "missing-establishment",
      label: "Falta establecimiento",
      isVisible: (row) => row.missingEstablishmentPartnerId !== null,
      href: (row) => `/admin/establishments/new?partner_id=${row.missingEstablishmentPartnerId}`,
      testId: (row) => `invitation-missing-establishment-${row.id}`,
      variant: "outline",
    },
    {
      id: "revoke",
      label: "Revocar",
      isVisible: (row) => row.status === "pending",
      render: (row) => <RevokeInvitationButton invitationId={row.id} />,
    },
  ];

  return (
    <DataList
      rows={rows}
      getRowId={(row) => row.id}
      columns={columns}
      actions={actions}
      basePath="/admin/invitations"
      page={page}
      pageSize={pageSize}
      totalCount={totalCount}
      sort={sort}
      filters={INVITATIONS_FILTERS}
      filterValues={filterValues}
      extraParams={extraParams}
      ariaLabel="Invitaciones"
      rowTestIdPrefix="invitation"
      emptyMessage="Ninguna invitación encontrada."
      emptyTestId="no-invitations"
    />
  );
}
