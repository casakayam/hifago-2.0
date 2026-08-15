import { redirect } from "next/navigation";
import { createClient } from "@hifago/supabase/server";
import { ProductsTable } from "./ProductsTable";

export default async function PartnerProductsPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login?next=/partner/products");
  }

  // partner_id_for_account (même RPC que la garde admin/layout.tsx utilise pour is_admin) — pas
  // une jointure ni un filtre manuel sur establishments, cf. plan feature 15.
  const { data: partnerId } = await supabase.rpc("partner_id_for_account", { uid: user.id });

  // products_select_own (feature 15, additive à products_select_public) : couvre aussi les
  // fiches sellable=false de ce partenaire, pas seulement les publiées — sans elle, cette liste
  // serait vide pour toute fiche pas encore publiée.
  const { data: products } = await supabase
    .from("products")
    .select("id, name, price_cop, category, sellable")
    .eq("partner_id", partnerId ?? "")
    .order("created_at", { ascending: false });

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Mis actividades</h1>

      <ProductsTable products={products ?? []} />
    </div>
  );
}
