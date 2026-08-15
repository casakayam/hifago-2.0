import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@hifago/supabase/server";
import { asLocalizedField, resolveLocalizedField } from "@hifago/domain";
import { buttonVariants } from "@hifago/ui";
import { EditProductForm } from "./EditProductForm";
import { ProductStatusBlock } from "./ProductStatusBlock";
import { ProductPhotosBlock } from "./ProductPhotosBlock";
import { ProductTagsBlock } from "./ProductTagsBlock";

export default async function EditProductPage({
  params,
}: PageProps<"/admin/products/[id]/edit">) {
  const { id } = await params;
  const supabase = await createClient();

  // RLS (products_select_public) : l'admin voit aussi les activités non publiées.
  const { data: product } = await supabase
    .from("products")
    .select(
      "id, name, description, price_cop, price_tiers, min_qty, max_qty, category, type, establishment_id, sellable",
    )
    .eq("id", id)
    .maybeSingle();

  if (!product) {
    notFound();
  }

  const { data: media } = await supabase
    .from("product_media")
    .select("id, storage_path")
    .eq("product_id", product.id)
    .order("sort", { ascending: true });

  const photos = (media ?? []).map((m) => ({
    id: m.id,
    url: supabase.storage.from("catalog-media").getPublicUrl(m.storage_path).data.publicUrl,
  }));

  // Spec 08 — tags : réservés au type "activity" (écran partagé conservé, champ conditionnel).
  const isActivity = product.type === "activity";
  const { data: tagsRaw } = isActivity
    ? await supabase.from("catalog_tags").select("id, label").order("slug")
    : { data: [] as { id: string; label: unknown }[] };
  const allTags = (tagsRaw ?? []).map((tag) => ({
    id: tag.id,
    label: resolveLocalizedField(asLocalizedField(tag.label), "es") ?? tag.id,
  }));
  const { data: assignments } = isActivity
    ? await supabase.from("product_tag_assignments").select("tag_id").eq("product_id", product.id)
    : { data: [] as { tag_id: string }[] };
  const initialTagIds = (assignments ?? []).map((a) => a.tag_id);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Editar actividad</h1>
        <Link
          href={`/admin/products/${product.id}/availability`}
          className={buttonVariants({ variant: "outline" })}
        >
          Calendario &amp; cupos
        </Link>
      </div>
      {/* Bloc Statut séparé du formulaire d'édition — action distincte (feature 4), pas un champ
          de plus dans le même submit. */}
      <ProductStatusBlock productId={product.id} initialSellable={product.sellable} />
      {isActivity ? (
        <ProductTagsBlock productId={product.id} allTags={allTags} initialTagIds={initialTagIds} />
      ) : null}
      <ProductPhotosBlock productId={product.id} initialPhotos={photos} />
      <EditProductForm product={product} />
    </div>
  );
}
