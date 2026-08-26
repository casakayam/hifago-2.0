import { notFound } from "next/navigation";
import { createClient } from "@hifago/supabase/server";
import { asLocalizedField, resolveLocalizedField } from "@hifago/domain";
import { EditProposalForm } from "./EditProposalForm";
import { PhotosSocioBlock } from "@/components/photos-socio-block";

export default async function EditProductProposalPage({
  params,
}: PageProps<"/partner/products/[id]/edit">) {
  const { id } = await params;
  const supabase = await createClient();

  // products_select_own (feature 15) : la RLS ne renvoie cette fiche que si elle appartient au
  // partenaire connecté (ou si elle est publiée) — un produit d'un autre partenaire ressort donc
  // ici comme "introuvable", jamais un refus explicite qui en révèlerait l'existence.
  // Colonnes étendues (spec 15 bis, 2026-08-17) : parité de champs avec ProductForm en mode
  // édition — address/lat/lon/price_tiers/min_qty/max_qty/check_in_time/check_out_time/capacity/
  // stay_rates, plus `type` pour le gating (ProductTypeFields).
  const { data: product } = await supabase
    .from("products")
    .select(
      "id, type, name, description, address, lat, lon, price_cop, price_tiers, min_qty, max_qty, check_in_time, check_out_time, capacity, quantity, default_capacity, stay_rates, establishment_id, lobby_category_id, lobby_product_id, establishment:establishments(lobby_connector_active, lobby_has_token)"
    )
    .eq("id", id)
    .maybeSingle();

  if (!product) {
    notFound();
  }

  // 3 lectures indépendantes (aucune ne dépend du résultat d'une autre, seulement de `id` déjà
  // connu) — lancées en parallèle plutôt qu'en séquence, même raisonnement documenté dans le
  // admin/products/[id]/edit/page.tsx voisin (5 lectures indépendantes, Promise.all).
  const [{ data: pendingProposal }, { data: media }, { data: pendingPhotosProposal }] =
    await Promise.all([
      // Au plus une proposition pending par produit/partenaire à la fois côté écran (le plafond de
      // 10 est un plafond global par partenaire, pas par produit — mais rien n'empêche plusieurs
      // pending sur des produits différents ; ici on n'affiche que celle de CE produit, s'il y en a
      // une).
      supabase
        .from("product_proposals")
        .select("id, payload, created_at")
        .eq("product_id", id)
        .eq("status", "pending")
        .eq("kind", "content")
        .order("created_at", { ascending: false })
        .maybeSingle(),
      supabase
        .from("product_media")
        .select("id, storage_path")
        .eq("product_id", id)
        .order("sort", { ascending: true }),
      supabase
        .from("product_proposals")
        .select("payload")
        .eq("product_id", id)
        .eq("status", "pending")
        .eq("kind", "photos")
        .maybeSingle(),
    ]);

  const photos = (media ?? []).map((m) => ({
    id: m.id,
    url: supabase.storage.from("catalog-media").getPublicUrl(m.storage_path).data.publicUrl,
  }));

  // Aperçu réel des photos proposées, pas seulement leur nombre : le socio doit voir CE qu'il a
  // envoyé, pas juste un compteur (retour Jérôme 2026-08-17 — le module de photos n'affichait rien
  // après l'ajout).
  const pendingPhotos = (
    (pendingPhotosProposal?.payload as { photos?: { storage_path?: string }[] } | null)?.photos ?? []
  )
    .map((p) => p?.storage_path)
    .filter((path): path is string => Boolean(path))
    .map((path) => supabase.storage.from("catalog-media").getPublicUrl(path).data.publicUrl);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">
        Proponer edición — {resolveLocalizedField(asLocalizedField(product.name), "es") ?? product.id}
      </h1>

      <PhotosSocioBlock
        entityType="product"
        entityId={product.id}
        uploadEndpoint="/api/upload/product"
        submitRpc="submit_photos_proposal"
        deleteTable="product_media"
        notFoundLabel="No se encontró la actividad."
        initialPhotos={photos}
        initialPendingPhotos={pendingPhotos}
      />

      <EditProposalForm
        productId={product.id}
        type={product.type as "activity" | "evento" | "camp" | "lodging" | "hotel" | "transport"}
        currentPayload={product}
        pendingProposal={pendingProposal}
        establishmentId={product.establishment_id}
        establishmentLobbyConnected={Boolean(
          product.establishment?.lobby_connector_active && product.establishment?.lobby_has_token
        )}
      />
    </div>
  );
}
