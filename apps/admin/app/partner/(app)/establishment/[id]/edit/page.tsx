import { notFound } from "next/navigation";
import { createClient } from "@hifago/supabase/server";
import { asLocalizedField, resolveLocalizedField } from "@hifago/domain";
import { EditEstablishmentProposalForm } from "./EditEstablishmentProposalForm";
import { PhotosSocioBlock } from "@/components/photos-socio-block";

export default async function EditEstablishmentProposalPage({
  params,
}: PageProps<"/partner/establishment/[id]/edit">) {
  const { id } = await params;
  const supabase = await createClient();

  // establishments_select (RLS) : ne renvoie cette fiche que si elle appartient au partenaire
  // connecté (ou s'il est admin) — un établissement d'un autre partenaire ressort donc ici comme
  // "introuvable", jamais un refus explicite qui en révèlerait l'existence (même invariant que
  // products_select_own / EditProductProposalPage).
  const { data: establishment } = await supabase
    .from("establishments")
    .select("id, name, description, address, lat, lon")
    .eq("id", id)
    .maybeSingle();

  if (!establishment) {
    notFound();
  }

  const { data: pendingProposal } = await supabase
    .from("establishment_proposals")
    .select("id, payload, created_at")
    .eq("establishment_id", id)
    .eq("kind", "edit")
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .maybeSingle();

  const { data: media } = await supabase
    .from("establishment_media")
    .select("id, storage_path")
    .eq("establishment_id", id)
    .order("sort", { ascending: true });

  const photos = (media ?? []).map((m) => ({
    id: m.id,
    url: supabase.storage.from("catalog-media").getPublicUrl(m.storage_path).data.publicUrl,
  }));

  const { data: pendingPhotosProposal } = await supabase
    .from("establishment_proposals")
    .select("payload")
    .eq("establishment_id", id)
    .eq("status", "pending")
    .eq("kind", "photos")
    .maybeSingle();

  // Aperçu réel des photos proposées, pas seulement leur nombre — symétrique au fix produit
  // (retour Jérôme 2026-08-17, apps/admin/app/partner/(app)/products/[id]/edit/page.tsx).
  const pendingPhotos = (
    (pendingPhotosProposal?.payload as { photos?: { storage_path?: string }[] } | null)?.photos ?? []
  )
    .map((p) => p?.storage_path)
    .filter((path): path is string => Boolean(path))
    .map((path) => supabase.storage.from("catalog-media").getPublicUrl(path).data.publicUrl);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">
        Proponer edición —{" "}
        {resolveLocalizedField(asLocalizedField(establishment.name), "es") ?? establishment.id}
      </h1>

      <PhotosSocioBlock
        entityType="establishment"
        entityId={establishment.id}
        uploadEndpoint="/api/upload/establishment"
        submitRpc="submit_establishment_photos_proposal"
        deleteTable="establishment_media"
        notFoundLabel="No se encontró el establecimiento."
        initialPhotos={photos}
        initialPendingPhotos={pendingPhotos}
      />

      <EditEstablishmentProposalForm
        establishmentId={establishment.id}
        initialNameEs={asLocalizedField(establishment.name)?.es ?? ""}
        initialDescriptionEs={asLocalizedField(establishment.description)?.es ?? ""}
        initialDescriptionEn={asLocalizedField(establishment.description)?.en ?? ""}
        initialAddress={establishment.address ?? ""}
        initialLat={establishment.lat !== null ? String(establishment.lat) : ""}
        initialLon={establishment.lon !== null ? String(establishment.lon) : ""}
        pendingProposal={pendingProposal}
      />
    </div>
  );
}
