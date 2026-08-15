import { notFound } from "next/navigation";
import { createClient } from "@hifago/supabase/server";
import { asLocalizedField, resolveLocalizedField } from "@hifago/domain";
import { EditProposalForm } from "./EditProposalForm";
import { ProductPhotosSocioBlock } from "./ProductPhotosSocioBlock";

export default async function EditProductProposalPage({
  params,
}: PageProps<"/partner/products/[id]/edit">) {
  const { id } = await params;
  const supabase = await createClient();

  // products_select_own (feature 15) : la RLS ne renvoie cette fiche que si elle appartient au
  // partenaire connecté (ou si elle est publiée) — un produit d'un autre partenaire ressort donc
  // ici comme "introuvable", jamais un refus explicite qui en révèlerait l'existence.
  const { data: product } = await supabase
    .from("products")
    .select("id, name, description, price_cop, category")
    .eq("id", id)
    .maybeSingle();

  if (!product) {
    notFound();
  }

  // Au plus une proposition pending par produit/partenaire à la fois côté écran (le plafond de 10
  // est un plafond global par partenaire, pas par produit — mais rien n'empêche plusieurs
  // pending sur des produits différents ; ici on n'affiche que celle de CE produit, s'il y en a une).
  const { data: pendingProposal } = await supabase
    .from("product_proposals")
    .select("id, payload, created_at")
    .eq("product_id", id)
    .eq("status", "pending")
    .eq("kind", "content")
    .order("created_at", { ascending: false })
    .maybeSingle();

  const { data: media } = await supabase
    .from("product_media")
    .select("id, storage_path")
    .eq("product_id", id)
    .order("sort", { ascending: true });

  const photos = (media ?? []).map((m) => ({
    id: m.id,
    url: supabase.storage.from("catalog-media").getPublicUrl(m.storage_path).data.publicUrl,
  }));

  const { data: pendingPhotosProposal } = await supabase
    .from("product_proposals")
    .select("payload")
    .eq("product_id", id)
    .eq("status", "pending")
    .eq("kind", "photos")
    .maybeSingle();

  const pendingPhotosCount = (
    (pendingPhotosProposal?.payload as { photos?: unknown[] } | null)?.photos ?? []
  ).length;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">
        Proponer edición — {resolveLocalizedField(asLocalizedField(product.name), "es") ?? product.id}
      </h1>

      <ProductPhotosSocioBlock
        productId={product.id}
        initialPhotos={photos}
        initialPendingCount={pendingPhotosCount}
      />

      <EditProposalForm
        productId={product.id}
        initialNameEs={asLocalizedField(product.name)?.es ?? ""}
        initialNameEn={asLocalizedField(product.name)?.en ?? ""}
        initialDescriptionEs={asLocalizedField(product.description)?.es ?? ""}
        initialDescriptionEn={asLocalizedField(product.description)?.en ?? ""}
        // price_cop nullable depuis la feature 21 (evento vitrine) — jamais le cas ici en
        // pratique : un evento n'a pas de proposition socio (admin-direct seulement).
        initialPriceCop={product.price_cop ?? 0}
        initialCategory={product.category}
        pendingProposal={pendingProposal}
      />
    </div>
  );
}
