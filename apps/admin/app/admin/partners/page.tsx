import Link from "next/link";
import { createClient } from "@hifago/supabase/server";
import { resolvePageParams } from "@hifago/domain";
import { buttonVariants, ServerPagination } from "@hifago/ui";
import { PartnersTable } from "./PartnersTable";

export default async function AdminPartnersPage({
  searchParams,
}: PageProps<"/admin/partners">) {
  const resolvedSearchParams = await searchParams;
  const { page, pageSize, from, to } = resolvePageParams(resolvedSearchParams);

  const supabase = await createClient();

  // RLS (partners_select) : l'admin voit tous les partenaires. partner_capabilities(role, status)
  // et establishments(count) : agrégations embarquées PostgREST, juste assez pour choisir quelle
  // fiche ouvrir — pas une vraie liste détaillée (cf. plan feature 23, "juste assez pour atteindre
  // la fiche détail"). Pagination serveur (G15, spec 02) : .range() + count exact plutôt que tout
  // charger, comme jusqu'ici.
  const { data: partners, count } = await supabase
    .from("partners")
    .select("id, display_name, status, partner_capabilities(role, status), establishments(count)", {
      count: "exact",
    })
    .order("display_name")
    .range(from, to);

  const rows = (partners ?? []).map((partner) => ({
    ...partner,
    activeRoles: (partner.partner_capabilities ?? [])
      .filter((capability) => capability.status === "active")
      .map((capability) => capability.role)
      .join(", "),
  }));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Partners</h1>
        <Link href="/admin/partners/new" className={buttonVariants()} data-testid="new-partner-link">
          Nuevo partner
        </Link>
      </div>

      <PartnersTable rows={rows} />

      <ServerPagination page={page} pageSize={pageSize} totalCount={count ?? 0} basePath="/admin/partners" />
    </div>
  );
}
