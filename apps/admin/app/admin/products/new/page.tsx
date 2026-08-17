import { createClient } from "@hifago/supabase/server";
import { asLocalizedField, resolveLocalizedField } from "@hifago/domain";
import { ProductForm } from "@/components/product-form";

export default async function NewProductPage({
  searchParams,
}: PageProps<"/admin/products/new">) {
  const supabase = await createClient();

  // RLS (establishments_select) : l'admin voit tous les établissements, nécessaire pour le
  // sélecteur.
  const { data: establishments } = await supabase
    .from("establishments")
    .select("id, name, partner_id")
    .order("created_at", { ascending: false });

  const { data: tagsRaw } = await supabase.from("catalog_tags").select("id, label").order("slug");
  const allTags = (tagsRaw ?? []).map((tag) => ({
    id: tag.id,
    label: resolveLocalizedField(asLocalizedField(tag.label), "es") ?? tag.id,
  }));

  const resolvedSearchParams = await searchParams;
  const establishmentParam = resolvedSearchParams?.establishment;
  // Pré-rempli si venu de la liste établissements (?establishment=<id>), mais toujours modifiable
  // dans le formulaire — cf. plan feature 2.
  const initialEstablishmentId =
    typeof establishmentParam === "string" ? establishmentParam : "";

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Nueva actividad</h1>
      <ProductForm
        establishments={establishments ?? []}
        initialEstablishmentId={initialEstablishmentId}
        allTags={allTags}
      />
    </div>
  );
}
