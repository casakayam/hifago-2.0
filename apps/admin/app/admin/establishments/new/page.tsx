import { createClient } from "@hifago/supabase/server";
import { NewEstablishmentForm } from "./NewEstablishmentForm";

export default async function NewEstablishmentPage({
  searchParams,
}: PageProps<"/admin/establishments/new">) {
  const supabase = await createClient();

  // RLS (partners_select) : l'admin voit tous les partenaires, nécessaire pour le sélecteur.
  const { data: partners } = await supabase
    .from("partners")
    .select("id, display_name")
    .order("display_name");

  // ?partner_id= optionnel (docs/specs/05-invitations-onboarding-dashboard-partenaire.md §5.6) —
  // préremplit le partner propriétaire depuis le badge « Falta establecimiento » de
  // /admin/invitations, sans changer le comportement par défaut (aucun param = formulaire vide).
  const resolvedSearchParams = await searchParams;
  const partnerIdParam = resolvedSearchParams?.partner_id;
  const defaultPartnerId = typeof partnerIdParam === "string" ? partnerIdParam : null;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Nuevo establecimiento</h1>
      <NewEstablishmentForm partners={partners ?? []} defaultPartnerId={defaultPartnerId} />
    </div>
  );
}
