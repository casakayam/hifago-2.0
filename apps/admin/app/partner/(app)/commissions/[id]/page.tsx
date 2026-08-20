import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@hifago/supabase/server";
import { asLocalizedField, formatCop, resolveLocalizedField } from "@hifago/domain";
import { COMMISSION_STATE_LABELS } from "../commissionStateLabels";

// Fiche minimale (migration vers DataList, 2026-08-20, docs/specs/22-vue-referent-restreinte.md
// addendum) — nécessaire parce que DataList pointe TOUJOURS sa 1re colonne vers
// `${basePath}/${id}` sans échappatoire (packages/ui/src/components/data-list.tsx), pas parce
// qu'un référent a besoin d'un écran séparé : tous les champs affichés ici sont déjà visibles sur
// la ligne de liste, aucune donnée supplémentaire. Jamais un `Chip`/composant `@hifago/ui` importé
// ici (piège hifago/CLAUDE.md §11.16 : un Server Component qui importe quoi que ce soit du barrel
// `@hifago/ui` plante `next build` depuis que le barrel embarque AppNavShell) — état affiché en
// texte brut, même patron que `admin/tags/[id]/page.tsx` (fiche minimale existante, `<dl>` nu).
export default async function PartnerCommissionDetailPage({
  params,
}: PageProps<"/partner/commissions/[id]">) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: partnerId } = await supabase.rpc("partner_id_for_account", {
    uid: (await supabase.auth.getUser()).data.user?.id ?? "",
  });

  // Filtre explicite sur referrer_partner_id ET beneficiary_type, au-delà de la RLS — même
  // intention que page.tsx (liste) : un référent ne doit jamais atteindre la fiche d'une entrée
  // qui n'est pas la sienne, même en devinant un id.
  const { data: entry } = await supabase
    .from("ledger_entries")
    .select(
      `id, amount_cop, status,
       order_line:order_lines!inner(date, total_cop, holder_name, referrer_pct,
         product:products(name, establishment:establishments(name)))`
    )
    .eq("id", id)
    .eq("beneficiary_type", "referrer")
    .eq("referrer_partner_id", partnerId ?? "")
    .maybeSingle();

  if (!entry) {
    notFound();
  }

  const productName = resolveLocalizedField(asLocalizedField(entry.order_line?.product?.name), "es") ?? "—";
  const establishmentName =
    resolveLocalizedField(asLocalizedField(entry.order_line?.product?.establishment?.name), "es") ?? "—";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link href="/partner/commissions" className="text-sm text-muted hover:underline">
          ← Volver a Mis comisiones
        </Link>
        <h1 className="text-2xl font-semibold" data-testid="commission-detail-product">
          {productName}
        </h1>
      </div>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm">
        <div>
          <dt className="text-muted">Fecha</dt>
          <dd>{entry.order_line?.date ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-muted">Establecimiento</dt>
          <dd>{establishmentName}</dd>
        </div>
        <div>
          <dt className="text-muted">Cliente</dt>
          <dd>{entry.order_line?.holder_name ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-muted">Monto total</dt>
          <dd>{formatCop(entry.order_line?.total_cop ?? 0)}</dd>
        </div>
        <div>
          <dt className="text-muted">% referido</dt>
          <dd>{Math.round((entry.order_line?.referrer_pct ?? 0) * 100)}%</dd>
        </div>
        <div>
          <dt className="text-muted">Comisión referente</dt>
          <dd data-testid="commission-detail-amount">{formatCop(entry.amount_cop)}</dd>
        </div>
        <div>
          <dt className="text-muted">Estado</dt>
          <dd data-testid="commission-detail-state">
            {COMMISSION_STATE_LABELS[entry.status] ?? entry.status}
          </dd>
        </div>
      </dl>
    </div>
  );
}
