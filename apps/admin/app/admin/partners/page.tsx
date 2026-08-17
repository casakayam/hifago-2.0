import Link from "next/link";
import { createClient } from "@hifago/supabase/server";
import { resolveListParams } from "@hifago/domain";
import { buttonVariants } from "@hifago/ui";
import { PartnersTable, type PartnerRow } from "./PartnersTable";
import { PARTNERS_FILTER_DEFINITIONS } from "@/lib/lists/filters";
import { PARTNERS_DEFAULT_SORT, PARTNERS_SORT_WHITELIST } from "@/lib/lists/sortable-columns";

// docs/specs/10-listes-standardisees-admin-socio.md (lot 4) — DataList, tri/filtres serveur.
export default async function AdminPartnersPage({
  searchParams,
}: PageProps<"/admin/partners">) {
  const resolvedSearchParams = await searchParams;
  const { page, pageSize, from, to, sort, filters, extraParams } = resolveListParams(
    resolvedSearchParams,
    {
      sortWhitelist: PARTNERS_SORT_WHITELIST,
      defaultSort: PARTNERS_DEFAULT_SORT,
      filters: PARTNERS_FILTER_DEFINITIONS,
    }
  );

  const supabase = await createClient();

  // RLS (partners_select) : l'admin voit tous les partenaires. partner_capabilities(role, status)
  // et establishments(count) : agrégations embarquées PostgREST, juste assez pour choisir quelle
  // fiche ouvrir. `partner_capabilities!inner` uniquement quand le filtre `role` est actif (une
  // ressource embarquée ne se filtre qu'avec !inner en PostgREST) — sinon un simple embed suffit
  // pour le calcul d'activeRoles.
  const capabilitiesRelation = filters.role ? "partner_capabilities!inner(role, status)" : "partner_capabilities(role, status)";
  let query = supabase
    .from("partners")
    .select(`id, display_name, status, ${capabilitiesRelation}, establishments(count)`, {
      count: "exact",
    })
    .order(sort.column, { ascending: sort.direction === "asc" })
    .range(from, to);

  if (filters.q) {
    query = query.or(`display_name.ilike.%${filters.q}%,email.ilike.%${filters.q}%`);
  }
  if (filters.status) {
    query = query.eq("status", filters.status);
  }
  if (filters.entity_type) {
    query = query.eq("entity_type", filters.entity_type);
  }
  if (filters.role) {
    query = query.eq("partner_capabilities.role", filters.role);
  }
  if (filters.city) {
    query = query.ilike("partner_city", `%${filters.city}%`);
  }

  const { data: partners, count } = await query;

  const rows: PartnerRow[] = (partners ?? []).map((partner) => ({
    id: partner.id,
    displayName: partner.display_name,
    status: partner.status,
    activeRoles: (partner.partner_capabilities ?? [])
      .filter((capability) => capability.status === "active")
      .map((capability) => capability.role)
      .join(", "),
    establishmentsCount: partner.establishments?.[0]?.count ?? 0,
  }));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Partners</h1>
        <Link href="/admin/partners/new" className={buttonVariants()} data-testid="new-partner-link">
          Nuevo partner
        </Link>
      </div>
      <PartnersTable
        rows={rows}
        page={page}
        pageSize={pageSize}
        totalCount={count ?? 0}
        sort={sort}
        filterValues={filters}
        extraParams={extraParams}
      />
    </div>
  );
}
