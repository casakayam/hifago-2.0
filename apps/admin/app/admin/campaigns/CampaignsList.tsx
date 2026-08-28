"use client";

import { Chip, DataList, type DataListAction, type DataListColumn, type DataListSort, viewAction } from "@hifago/ui";
import { AUDIENCE_LABELS, CAMPAIGN_STATUS_CHIP_COLOR, CAMPAIGN_STATUS_LABELS, CHANNEL_LABELS } from "./campaignLabels";
import { CAMPAIGNS_FILTERS } from "@/lib/lists/filters";
import { formatDateInBogota } from "@hifago/domain";

export type CampaignRow = {
  id: string;
  audience: string;
  channel: string;
  status: string;
  progress: string;
  createdAt: string;
};

export type CampaignsListProps = {
  rows: CampaignRow[];
  page: number;
  pageSize: number;
  totalCount: number;
  sort: DataListSort;
  filterValues: Record<string, string>;
  extraParams: Record<string, string>;
};

// docs/specs/10-listes-standardisees-admin-socio.md §5.3 — pas d'Editar/Eliminar : aucune RPC
// update_campaign/delete_campaign n'existe (seules create_campaign et process_campaign_batch).
export function CampaignsList({
  rows,
  page,
  pageSize,
  totalCount,
  sort,
  filterValues,
  extraParams,
}: CampaignsListProps) {
  const columns: DataListColumn<CampaignRow>[] = [
    {
      id: "audience",
      header: "Audiencia",
      sortable: true,
      cell: (row) => AUDIENCE_LABELS[row.audience] ?? row.audience,
    },
    {
      id: "channel",
      header: "Canal",
      sortable: true,
      cell: (row) => CHANNEL_LABELS[row.channel] ?? row.channel,
    },
    {
      id: "status",
      header: "Estado",
      sortable: true,
      cell: (row) => (
        <Chip variant="soft" color={CAMPAIGN_STATUS_CHIP_COLOR[row.status] ?? "default"}>
          {CAMPAIGN_STATUS_LABELS[row.status] ?? row.status}
        </Chip>
      ),
    },
    // Agrégat JS d'une 2e requête (comm_campaign_targets) — non triable, un tri serveur ne peut
    // pas la produire.
    { id: "progress", header: "Progreso" },
    {
      id: "created_at",
      header: "Creada",
      sortable: true,
      cell: (row) => formatDateInBogota(row.createdAt, "es"),
    },
  ];

  const actions: DataListAction<CampaignRow>[] = [viewAction("/admin/campaigns", "campaign")];

  return (
    <DataList
      rows={rows}
      getRowId={(row) => row.id}
      columns={columns}
      actions={actions}
      basePath="/admin/campaigns"
      page={page}
      pageSize={pageSize}
      totalCount={totalCount}
      sort={sort}
      filters={CAMPAIGNS_FILTERS}
      filterValues={filterValues}
      extraParams={extraParams}
      ariaLabel="Campañas"
      rowTestIdPrefix="campaign"
      emptyMessage="Ninguna campaña encontrada."
      emptyTestId="no-campaigns"
    />
  );
}
