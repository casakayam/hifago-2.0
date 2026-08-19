import { notFound } from "next/navigation";
import { createClient } from "@hifago/supabase/server";
import { asLocalizedField, resolveLocalizedField } from "@hifago/domain";
import { ModerateProposalForm } from "./ModerateProposalForm";
import { PhotoModerationForm } from "./PhotoModerationForm";
import { ModerateProductCreationProposalForm } from "./ModerateProductCreationProposalForm";
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
  // (PhotoModerationForm), jamais mélangées dans le même écran. establishment_id/type
  // ajoutés par la spec 15 (product_id NULL tant qu'une proposition kind='create' n'est pas
  // approuvée — product:products(...) ressort alors null, cf. garde ci-dessous).
  // Colonnes de products étendues (spec 15 bis, 2026-08-17) : parité de champs avec
  // ProductForm/ProductTypeFields côté "Valor actual" de ModerateProposalForm (branche content).
  const { data: proposal } = await supabase
    .from("product_proposals")
    .select(
      "id, status, version, payload, kind, type, establishment_id, rejection_reason, product:products(id, type, name, description, address, lat, lon, price_cop, price_tiers, min_qty, max_qty, check_in_time, check_out_time, capacity, default_capacity, stay_rates), establishment:establishments(id, name), partner:partners(display_name)"
    )
    .eq("id", id)
    .maybeSingle();

  // Contrairement à avant la spec 15 : `!proposal.product` n'est plus un cas d'erreur, c'est
  // l'état normal d'une proposition kind='create' encore pending — seule l'absence de la
  // proposition elle-même est un vrai 404 (même garde que la branche établissement ci-dessous,
  // où establishment_id est nullable pour la même raison depuis 20260815170000).
  if (!proposal) {
    notFound();
  }

  const isPhotos = proposal.kind === "photos";
  const isCreate = proposal.kind === "create";

  if (isCreate) {
    const proposedName = resolveLocalizedField(
      asLocalizedField((proposal.payload as { name?: unknown } | null)?.name),
      "es",
    );
    const establishmentName = proposal.establishment
      ? (resolveLocalizedField(asLocalizedField(proposal.establishment.name), "es") ?? proposal.establishment.id)
      : "—";

    const { data: tagsRaw } = await supabase.from("catalog_tags").select("id, label").order("slug");
    const availableTags = (tagsRaw ?? []).map((tag) => ({
      id: tag.id,
      label: resolveLocalizedField(asLocalizedField(tag.label), "es") ?? tag.id,
    }));

    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-2xl font-semibold">
          Revisar propuesta de creación — {proposedName ?? "nueva ficha"}
        </h1>
        <p className="text-sm text-muted">
          Partner: {proposal.partner?.display_name ?? "—"} · Establecimiento: {establishmentName}
        </p>

        {proposal.status !== "pending" ? (
          <p role="status" data-testid="proposal-not-pending" className="text-sm text-muted">
            Esta propuesta ya no está pendiente (estado: {proposal.status}).
          </p>
        ) : (
          <ModerateProductCreationProposalForm
            proposalId={proposal.id}
            expectedVersion={proposal.version}
            type={proposal.type as "activity" | "evento" | "camp" | "lodging" | "hotel" | "transport"}
            payload={proposal.payload}
            availableTags={availableTags}
          />
        )}
      </div>
    );
  }

  // À partir d'ici (kind='content'/'photos'), product_id est toujours renseigné (contrainte
  // product_proposals_scope) : proposal.product ne peut être null que si le produit a été
  // supprimé entre-temps (delete_product) — cas résiduel déjà géré ainsi avant la spec 15.
  if (!proposal.product) {
    notFound();
  }

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
        <PhotoModerationForm
          proposalId={proposal.id}
          expectedVersion={proposal.version}
          rpcName="moderate_product_proposal"
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
          type={proposal.product.type as "activity" | "evento" | "camp" | "lodging" | "hotel" | "transport"}
          currentPayload={proposal.product}
          proposedPayload={proposal.payload as Record<string, unknown>}
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
  const isPhotos = proposal.kind === "photos";
  const kindLabel = isPhotos ? "fotos" : proposal.kind === "create" ? "creación" : "edición";

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">
        Revisar propuesta de {kindLabel} — {currentName ?? proposedName ?? proposal.id}
      </h1>
      <p className="text-sm text-muted">Partner: {proposal.partner?.display_name ?? "—"}</p>

      {proposal.status !== "pending" ? (
        <p role="status" data-testid="proposal-not-pending" className="text-sm text-muted">
          Esta propuesta ya no está pendiente (estado: {proposal.status}).
        </p>
      ) : isPhotos ? (
        <PhotoModerationForm
          proposalId={proposal.id}
          expectedVersion={proposal.version}
          rpcName="moderate_establishment_proposal"
          proposedPhotoPaths={
            ((proposal.payload as { photos?: { storage_path: string }[] })?.photos ?? []).map(
              (p) => p.storage_path
            )
          }
        />
      ) : (
        <ModerateEstablishmentProposalForm
          proposalId={proposal.id}
          expectedVersion={proposal.version}
          kind={proposal.kind as "create" | "edit"}
          currentPayload={proposal.establishment}
          proposedPayload={proposedPayload}
        />
      )}
    </div>
  );
}
