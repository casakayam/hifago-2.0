import Link from "next/link";
import { createClient } from "@hifago/supabase/server";
import { resolvePageParams } from "@hifago/domain";
import { buttonVariants, Chip, Input, Label, ServerPagination, Table } from "@hifago/ui";

// docs/specs/02-admin-accueil-et-navigation.md §5.4 — même patron que /admin/proposals ou
// /admin/reconciliation, lien vers campaigns/new et campaigns/[id]. `comm_campaigns`
// (20260814230000_campaign_engine.sql) ne porte aucune colonne nom/libellé — seulement
// audience/channel/message_template/status — donc la recherche locale (`?q=`) porte sur
// `message_template`, seul champ texte libre de la campagne, en l'absence d'un vrai titre.
const AUDIENCE_LABELS: Record<string, string> = {
  clients: "Clientes",
  referrers: "Referentes",
  providers: "Prestadores",
  partners: "Socios (referentes y prestadores)",
  all: "Todos",
};
const CHANNEL_LABELS: Record<string, string> = { whatsapp: "WhatsApp", email: "Correo electrónico" };
const CAMPAIGN_STATUS_LABELS: Record<string, string> = {
  draft: "Borrador",
  sending: "Enviando",
  completed: "Completada",
};
const CAMPAIGN_STATUS_CHIP_COLOR: Record<string, "default" | "accent" | "success"> = {
  draft: "default",
  sending: "accent",
  completed: "success",
};

export default async function AdminCampaignsPage({
  searchParams,
}: PageProps<"/admin/campaigns">) {
  const resolvedSearchParams = await searchParams;
  const searchParam = resolvedSearchParams?.q;
  const search = typeof searchParam === "string" && searchParam.trim() ? searchParam.trim() : null;

  const { page, pageSize, from, to } = resolvePageParams(resolvedSearchParams);

  const supabase = await createClient();

  // comm_campaigns_select_admin (feature 25) : lecture admin seule, RLS déjà en place — pas de RPC
  // nécessaire (spec 02 §7).
  let query = supabase
    .from("comm_campaigns")
    .select("id, audience, channel, status, message_template, created_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, to);
  if (search) {
    query = query.ilike("message_template", `%${search}%`);
  }
  const { data: campaigns, count } = await query;

  const campaignIds = (campaigns ?? []).map((campaign) => campaign.id);
  // Progression d'envoi par campagne : même donnée que campaigns/[id]/page.tsx (comptage des
  // statuts de comm_campaign_targets en JS), mais une seule requête groupée sur la page courante
  // plutôt qu'une requête par ligne.
  const targetCounts: Record<string, { total: number; sent: number }> = {};
  if (campaignIds.length > 0) {
    const { data: targets } = await supabase
      .from("comm_campaign_targets")
      .select("campaign_id, status")
      .in("campaign_id", campaignIds);
    for (const target of targets ?? []) {
      if (!targetCounts[target.campaign_id]) {
        targetCounts[target.campaign_id] = { total: 0, sent: 0 };
      }
      const bucket = targetCounts[target.campaign_id];
      bucket.total += 1;
      if (target.status === "sent") bucket.sent += 1;
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Campañas</h1>
        <Link href="/admin/campaigns/new" className={buttonVariants()} data-testid="new-campaign-link">
          Nueva campaña
        </Link>
      </div>

      <form method="GET" className="flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="q">Buscar por mensaje</Label>
          <Input id="q" name="q" defaultValue={search ?? ""} data-testid="campaigns-search-input" />
        </div>
        <button
          type="submit"
          className="rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-surface-secondary"
          data-testid="campaigns-search-submit"
        >
          Buscar
        </button>
      </form>

      <Table>
        <Table.ScrollContainer>
          <Table.Content aria-label="Campañas">
            <Table.Header>
              <Table.Column isRowHeader>Audiencia</Table.Column>
              <Table.Column>Canal</Table.Column>
              <Table.Column>Estado</Table.Column>
              <Table.Column>Progreso</Table.Column>
              <Table.Column>Creada</Table.Column>
              <Table.Column></Table.Column>
            </Table.Header>
            <Table.Body>
              {campaigns && campaigns.length > 0 ? (
                campaigns.map((campaign) => {
                  const counts = targetCounts[campaign.id];
                  return (
                    <Table.Row key={campaign.id} data-testid={`campaign-row-${campaign.id}`}>
                      <Table.Cell>{AUDIENCE_LABELS[campaign.audience] ?? campaign.audience}</Table.Cell>
                      <Table.Cell>{CHANNEL_LABELS[campaign.channel] ?? campaign.channel}</Table.Cell>
                      <Table.Cell>
                        <Chip variant="soft" color={CAMPAIGN_STATUS_CHIP_COLOR[campaign.status] ?? "default"}>
                          {CAMPAIGN_STATUS_LABELS[campaign.status] ?? campaign.status}
                        </Chip>
                      </Table.Cell>
                      <Table.Cell>{counts ? `${counts.sent}/${counts.total}` : "—"}</Table.Cell>
                      <Table.Cell>{new Date(campaign.created_at).toLocaleDateString("es")}</Table.Cell>
                      <Table.Cell>
                        <Link
                          href={`/admin/campaigns/${campaign.id}`}
                          className={buttonVariants({ variant: "outline", size: "sm" })}
                          data-testid={`campaign-detail-link-${campaign.id}`}
                        >
                          Ver
                        </Link>
                      </Table.Cell>
                    </Table.Row>
                  );
                })
              ) : (
                <Table.Row>
                  <Table.Cell colSpan={6} className="text-center text-muted">
                    Ninguna campaña encontrada.
                  </Table.Cell>
                </Table.Row>
              )}
            </Table.Body>
          </Table.Content>
        </Table.ScrollContainer>
      </Table>

      <ServerPagination
        page={page}
        pageSize={pageSize}
        totalCount={count ?? 0}
        basePath="/admin/campaigns"
        extraParams={search ? { q: search } : undefined}
      />
    </div>
  );
}
