import { notFound } from "next/navigation";
import { createClient } from "@hifago/supabase/server";
import { asLocalizedField, resolveLocalizedField } from "@hifago/domain";
import { ModerateProposalForm } from "./ModerateProposalForm";
import { ModeratePhotosProposalForm } from "./ModeratePhotosProposalForm";
import { ModerateEstablishmentProposalForm } from "./ModerateEstablishmentProposalForm";

export default async function AdminProposalDetailPage({
  params,
  searchParams,
}: PageProps<"/admin/proposals/[id]">) {
  const { id } = await params;
  const resolvedSearchParams = await searchParams;
  const isEstablishment = resolvedSearchParams?.entity === "establishment";
  const supabase = await createClient();

  if (isEstablishment) {
    return <AdminEstablishmentProposalDetail id={id} />;
  }

  // product_proposals_select_admin (feature 15) : l'admin voit n'importe quelle proposition,
  // quel que soit le partenaire ou le statut. kind ajouté par la spec 04 (gestion des images) —
  // distingue une proposition de contenu (ce composant) d'une proposition "photos seules"
  // (ModeratePhotosProposalForm), jamais mélangées dans le même écran.
  const { data: proposal } = await supabase
    .from("product_proposals")
    .select(
      "id, status, version, payload, kind, rejection_reason, product:products(id, name, description, price_cop, category), partner:partners(display_name)"
    )
    .eq("id", id)
    .maybeSingle();

  if (!proposal || !proposal.product) {
    notFound();
  }

  const proposedPayload = proposal.payload as {
    name?: unknown;
    description?: unknown;
    price_cop?: number | null;
    category?: string | null;
  };

  const isPhotos = proposal.kind === "photos";

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">
        Revisar propuesta{isPhotos ? " de fotos" : ""} —{" "}
        {resolveLocalizedField(asLocalizedField(proposal.product.name), "es") ?? proposal.product.id}
      </h1>
      <p className="text-sm text-muted">
        Partner: {proposal.partner?.display_name ?? "—"}
      </p>

      {proposal.status !== "pending" ? (
        <p role="status" data-testid="proposal-not-pending" className="text-sm text-muted">
          Esta propuesta ya no está pendiente (estado: {proposal.status}).
        </p>
      ) : isPhotos ? (
        <ModeratePhotosProposalForm
          proposalId={proposal.id}
          expectedVersion={proposal.version}
          proposedPhotoPaths={
            ((proposal.payload as { photos?: { storage_path: string }[] })?.photos ?? []).map(
              (p) => p.storage_path
            )
          }
        />
      ) : (
        <ModerateProposalForm
          proposalId={proposal.id}
          expectedVersion={proposal.version}
          currentNameEs={asLocalizedField(proposal.product.name)?.es ?? ""}
          currentNameEn={asLocalizedField(proposal.product.name)?.en ?? ""}
          currentDescriptionEs={asLocalizedField(proposal.product.description)?.es ?? ""}
          currentDescriptionEn={asLocalizedField(proposal.product.description)?.en ?? ""}
          // price_cop nullable depuis la feature 21 (evento vitrine) — jamais le cas ici en
          // pratique : un evento n'a pas de proposition socio (admin-direct seulement, cf. plan
          // feature 21 "Ce que cette feature NE fait PAS"), donc toujours renseigné pour tout
          // produit qui atteint réellement cet écran. ?? 0 satisfait le type sans rien changer
          // au comportement réel.
          currentPriceCop={proposal.product.price_cop ?? 0}
          currentCategory={proposal.product.category}
          proposedNameEs={asLocalizedField(proposedPayload.name)?.es ?? ""}
          proposedNameEn={asLocalizedField(proposedPayload.name)?.en ?? ""}
          proposedDescriptionEs={asLocalizedField(proposedPayload.description)?.es ?? ""}
          proposedDescriptionEn={asLocalizedField(proposedPayload.description)?.en ?? ""}
          proposedPriceCop={proposedPayload.price_cop ?? proposal.product.price_cop ?? 0}
          proposedCategory={proposedPayload.category ?? null}
        />
      )}
    </div>
  );
}

// docs/specs/06-gestion-etablissement.md §5.3 — branche établissement de l'écran de modération,
// routée par ?entity=establishment (ProposalsTable) plutôt qu'une seconde route dédiée : même
// pattern déjà en place pour kind='photos' vs 'content', une simple branche de rendu, pas un
// second écran à maintenir en parallèle.
async function AdminEstablishmentProposalDetail({ id }: { id: string }) {
  const supabase = await createClient();

  const { data: proposal } = await supabase
    .from("establishment_proposals")
    .select(
      "id, status, version, payload, kind, rejection_reason, establishment:establishments(id, name, description, address, lat, lon), partner:partners(display_name)"
    )
    .eq("id", id)
    .maybeSingle();

  if (!proposal) {
    notFound();
  }

  const proposedPayload = proposal.payload as {
    name?: unknown;
    description?: unknown;
    address?: string | null;
    lat?: number | null;
    lon?: number | null;
  };

  const currentName = proposal.establishment
    ? (resolveLocalizedField(asLocalizedField(proposal.establishment.name), "es") ?? proposal.establishment.id)
    : null;
  const proposedName = resolveLocalizedField(asLocalizedField(proposedPayload.name), "es");

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">
        Revisar propuesta de {proposal.kind === "create" ? "creación" : "edición"} —{" "}
        {currentName ?? proposedName ?? proposal.id}
      </h1>
      <p className="text-sm text-muted">Partner: {proposal.partner?.display_name ?? "—"}</p>

      {proposal.status !== "pending" ? (
        <p role="status" data-testid="proposal-not-pending" className="text-sm text-muted">
          Esta propuesta ya no está pendiente (estado: {proposal.status}).
        </p>
      ) : (
        <ModerateEstablishmentProposalForm
          proposalId={proposal.id}
          expectedVersion={proposal.version}
          kind={proposal.kind as "create" | "edit"}
          currentNameEs={asLocalizedField(proposal.establishment?.name)?.es ?? ""}
          currentNameEn={asLocalizedField(proposal.establishment?.name)?.en ?? ""}
          currentDescriptionEs={asLocalizedField(proposal.establishment?.description)?.es ?? ""}
          currentDescriptionEn={asLocalizedField(proposal.establishment?.description)?.en ?? ""}
          currentAddress={proposal.establishment?.address ?? ""}
          currentLat={proposal.establishment?.lat != null ? String(proposal.establishment.lat) : ""}
          currentLon={proposal.establishment?.lon != null ? String(proposal.establishment.lon) : ""}
          proposedNameEs={asLocalizedField(proposedPayload.name)?.es ?? ""}
          proposedNameEn={asLocalizedField(proposedPayload.name)?.en ?? ""}
          proposedDescriptionEs={asLocalizedField(proposedPayload.description)?.es ?? ""}
          proposedDescriptionEn={asLocalizedField(proposedPayload.description)?.en ?? ""}
          proposedAddress={proposedPayload.address ?? ""}
          proposedLat={proposedPayload.lat != null ? String(proposedPayload.lat) : ""}
          proposedLon={proposedPayload.lon != null ? String(proposedPayload.lon) : ""}
        />
      )}
    </div>
  );
}
