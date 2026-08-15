import { createClient } from "@hifago/supabase/server";
import { asLocalizedField, formatCop, resolveLocalizedField } from "@hifago/domain";
import { KpiCard } from "@hifago/ui";
import { SalesChart } from "./charts/SalesChart";
import { CommissionsChart } from "./charts/CommissionsChart";
import { TopPartnersChart } from "./charts/TopPartnersChart";
import { CatalogHealthChart } from "./charts/CatalogHealthChart";
import { AdminAlerts } from "./AdminAlerts";
import { RecentList } from "./RecentList";
import { computeDateWindow } from "./dateWindow";

// Feature 27 (docs/specs/02-admin-accueil-et-navigation.md §5.2) — remplace le simple
// `redirect("/admin/establishments")` qui faisait office de page d'accueil jusqu'ici. Reprend/
// améliore les 3 KPIs du dashboard legacy (`public/admin.js:208-234`) + ajoute les graphiques
// d'évolution décidés au cahier des charges admin §2 (indicateurs tranchés dans la spec, le
// principe seul était acté). Commissions toujours qualifiées « generadas », jamais « a pagar » —
// aucun ledger dû/payé n'existe encore côté hifago (spec §1, constat 1).

const TERMINAL_NON_CANCELLED = ["confirmed", "fulfilled", "no_show"];

export default async function AdminHomePage({
  searchParams,
}: PageProps<"/admin">) {
  const resolvedSearchParams = await searchParams;
  const windowParam = resolvedSearchParams?.window;
  const windowDays = windowParam === "90" ? 90 : 30;

  const supabase = await createClient();
  const { since, todayIso, days } = computeDateWindow(windowDays);

  const [
    revenueRes,
    commissionsRes,
    establishmentsCountRes,
    pendingActionRes,
    windowLinesRes,
    proposalsPendingRes,
    reconciliationOpenRes,
    operatorPendingRes,
    recentPartnersRes,
    recentEstablishmentsRes,
    catalogSellableRes,
    catalogDraftRes,
    catalogProposalPendingRes,
    catalogProposalRejectedRes,
  ] = await Promise.all([
    supabase
      .from("order_lines")
      .select("total_cop")
      .in("status", TERMINAL_NON_CANCELLED),
    supabase
      .from("order_lines")
      .select("referrer_commission_cop, app_commission_cop, referrer_partner_id")
      .eq("status", "fulfilled"),
    supabase.from("establishments").select("id", { count: "exact", head: true }).eq("status", "active"),
    supabase
      .from("order_lines")
      .select("id", { count: "exact", head: true })
      .eq("status", "confirmed")
      .lt("date", todayIso),
    supabase
      .from("order_lines")
      .select("date, status, total_cop, referrer_commission_cop, app_commission_cop")
      .gte("date", since)
      .in("status", TERMINAL_NON_CANCELLED),
    supabase.from("product_proposals").select("id", { count: "exact", head: true }).eq("status", "pending"),
    supabase
      .from("pms_reconciliation_entries")
      .select("id", { count: "exact", head: true })
      .in("status", ["open", "retrying"]),
    supabase
      .from("partner_capabilities")
      .select("id", { count: "exact", head: true })
      .eq("role", "operator")
      .in("status", ["onboarding", "pending_review"]),
    supabase.from("partners").select("id, display_name").order("created_at", { ascending: false }).limit(5),
    supabase
      .from("establishments")
      .select("id, name, partners(display_name)")
      .order("created_at", { ascending: false })
      .limit(5),
    supabase.from("products").select("id", { count: "exact", head: true }).eq("sellable", true),
    supabase.from("products").select("id", { count: "exact", head: true }).eq("sellable", false),
    supabase.from("product_proposals").select("id", { count: "exact", head: true }).eq("status", "pending"),
    supabase.from("product_proposals").select("id", { count: "exact", head: true }).eq("status", "rejected"),
  ]);

  // Top partenaires par volume : agrégation en mémoire (dataset "vue d'ensemble", pas une liste
  // paginée) — PostgREST ne fait pas de GROUP BY, et une RPC dédiée serait disproportionnée pour
  // un aperçu top-5. Volume = ventes des établissements du partenaire (le vendeur), pas le
  // référent qui a apporté la commande — c'est la lecture « qui a généré le plus » du cahier des
  // charges §2, la même que la table « Détail par Hostel » du legacy.
  const { data: volumeByPartnerRows } = await supabase
    .from("order_lines")
    .select("total_cop, status, products(establishment_id, establishments(partner_id, partners(display_name)))")
    .in("status", TERMINAL_NON_CANCELLED);

  const volumeByPartner = new Map<string, { name: string; total: number }>();
  for (const row of volumeByPartnerRows ?? []) {
    const partner = row.products?.establishments?.partners;
    const partnerId = row.products?.establishments?.partner_id;
    if (!partnerId || !partner) continue;
    const entry = volumeByPartner.get(partnerId) ?? { name: partner.display_name, total: 0 };
    entry.total += row.total_cop ?? 0;
    volumeByPartner.set(partnerId, entry);
  }
  const topPartners = Array.from(volumeByPartner.values())
    .sort((a, b) => b.total - a.total)
    .slice(0, 8);

  const totalRevenue = (revenueRes.data ?? []).reduce((sum, row) => sum + (row.total_cop ?? 0), 0);
  const commissionRows = commissionsRes.data ?? [];
  const totalReferrerCommission = commissionRows.reduce((sum, row) => sum + (row.referrer_commission_cop ?? 0), 0);
  const totalAppCommission = commissionRows.reduce((sum, row) => sum + (row.app_commission_cop ?? 0), 0);
  const totalCommission = totalReferrerCommission + totalAppCommission;

  // Répartition par bénéficiaire (chips, même esprit que « commission par payeur » du legacy).
  const commissionByPartner = new Map<string, number>();
  for (const row of commissionRows) {
    if (!row.referrer_partner_id) continue;
    commissionByPartner.set(
      row.referrer_partner_id,
      (commissionByPartner.get(row.referrer_partner_id) ?? 0) + (row.referrer_commission_cop ?? 0)
    );
  }

  // Séries journalières pour les 2 premiers graphiques — un seau par jour dans la fenêtre
  // (`days` déjà calculé par computeDateWindow, cf. import).
  const salesByDay = new Map(days.map((day) => [day, 0]));
  const referrerCommissionByDay = new Map(days.map((day) => [day, 0]));
  const appCommissionByDay = new Map(days.map((day) => [day, 0]));
  for (const row of windowLinesRes.data ?? []) {
    if (!salesByDay.has(row.date)) continue;
    salesByDay.set(row.date, (salesByDay.get(row.date) ?? 0) + (row.total_cop ?? 0));
    if (row.status === "fulfilled") {
      referrerCommissionByDay.set(
        row.date,
        (referrerCommissionByDay.get(row.date) ?? 0) + (row.referrer_commission_cop ?? 0)
      );
      appCommissionByDay.set(row.date, (appCommissionByDay.get(row.date) ?? 0) + (row.app_commission_cop ?? 0));
    }
  }
  const salesSeries = days.map((day) => ({ day, ventas: salesByDay.get(day) ?? 0 }));
  const commissionsSeries = days.map((day) => ({
    day,
    referente: referrerCommissionByDay.get(day) ?? 0,
    app: appCommissionByDay.get(day) ?? 0,
  }));

  const catalogHealth = [
    { name: "Publicado", value: catalogSellableRes.count ?? 0 },
    { name: "Borrador", value: catalogDraftRes.count ?? 0 },
    { name: "En revisión", value: catalogProposalPendingRes.count ?? 0 },
    { name: "Rechazado", value: catalogProposalRejectedRes.count ?? 0 },
  ];

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-2xl font-semibold">Inicio</h1>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard testId="kpi-revenue" label="Ingresos generados" value={formatCop(totalRevenue)} />
        <KpiCard
          testId="kpi-commissions"
          label="Comisiones generadas"
          value={formatCop(totalCommission)}
          sublabel={
            commissionByPartner.size > 0 ? (
              <div className="flex flex-wrap gap-1">
                {Array.from(commissionByPartner.entries())
                  .sort((a, b) => b[1] - a[1])
                  .slice(0, 3)
                  .map(([partnerId, amount]) => (
                    <a
                      key={partnerId}
                      href={`/admin/partners/${partnerId}`}
                      className="rounded bg-surface-secondary px-1.5 py-0.5 text-[11px] hover:underline"
                    >
                      {formatCop(amount)}
                    </a>
                  ))}
              </div>
            ) : undefined
          }
        />
        <KpiCard
          testId="kpi-establishments"
          label="Establecimientos activos"
          value={String(establishmentsCountRes.count ?? 0)}
        />
        <KpiCard
          testId="kpi-pending-orders"
          label="Pedidos pendientes de acción"
          value={String(pendingActionRes.count ?? 0)}
          sublabel="Fecha de servicio ya pasada, aún sin resolver"
        />
      </div>

      <AdminAlerts
        proposalsPending={proposalsPendingRes.count ?? 0}
        reconciliationOpen={reconciliationOpenRes.count ?? 0}
        operatorPending={operatorPendingRes.count ?? 0}
      />

      <div className="flex items-center gap-2 text-sm">
        <span className="text-muted">Ventana:</span>
        <a
          href="/admin?window=30"
          className={windowDays === 30 ? "font-semibold underline" : "text-muted hover:underline"}
          data-testid="window-30"
        >
          30 días
        </a>
        <a
          href="/admin?window=90"
          className={windowDays === 90 ? "font-semibold underline" : "text-muted hover:underline"}
          data-testid="window-90"
        >
          90 días
        </a>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <SalesChart data={salesSeries} />
        <CommissionsChart data={commissionsSeries} />
        <TopPartnersChart data={topPartners} />
        <CatalogHealthChart data={catalogHealth} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <RecentList
          title="Partners recientes"
          href="/admin/partners"
          items={(recentPartnersRes.data ?? []).map((partner) => ({
            id: partner.id,
            label: partner.display_name,
            href: `/admin/partners/${partner.id}`,
          }))}
        />
        <RecentList
          title="Establecimientos recientes"
          href="/admin/establishments"
          items={(recentEstablishmentsRes.data ?? []).map((establishment) => ({
            id: establishment.id,
            label:
              resolveLocalizedField(asLocalizedField(establishment.name), "es") ?? establishment.id,
            sublabel: establishment.partners?.display_name,
            href: `/admin/establishments/${establishment.id}`,
          }))}
        />
        <RecentList title="Clientes recientes" href="/admin/clients" items={[]} emptyHint="Ver /admin/clients" />
      </div>
    </div>
  );
}
