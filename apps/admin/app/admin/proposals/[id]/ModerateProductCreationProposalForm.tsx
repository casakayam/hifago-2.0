"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@hifago/supabase/client";
import type { Json } from "@hifago/supabase/database.types";
import { Button, Label, Modal, TextArea, TextField, toast } from "@hifago/ui";
import { LocalizedTextField, type LocalizedValue } from "@/components/localized-text-field";
import { ProductTypeFields } from "@/components/product-type-fields";
import type { TagOption } from "@/components/tags-multiselect";
import { asLocalizedField } from "@hifago/domain";
import { buildProductCreationPayload } from "@/lib/products/productCreationPayload";
import {
  payloadToFieldsInit,
  useProductTypeFieldsState,
  type ProductType,
  type RawProductFieldsPayload,
} from "@/lib/products/useProductTypeFieldsState";

const MODERATE_ERRORS: Record<string, string> = {
  proposal_not_found: "No se encontró la propuesta.",
  version_conflict: "Esta propuesta fue modificada por otra persona. Recarga la página.",
};

type ModerateResult = {
  ok: boolean;
  reason?: string;
  status?: string;
  reviewed_by_email?: string;
  product_id?: string;
};

// name/description/photos : jamais couverts par RawProductFieldsPayload/payloadToFieldsInit
// (partagés avec ModerateProposalForm, spec 15 bis) — gérés à part dans ce composant, comme
// ProductForm le fait déjà pour les mêmes raisons (name/description en LocalizedValue, photos hors
// de ProductTypeFieldsState).
type RawProductCreationPayload = RawProductFieldsPayload & {
  name?: unknown;
  description?: unknown;
  photos?: { storage_path: string }[];
};

// Spec 15 — pendant de ModerateEstablishmentProposalForm (branche kind='create') pour une
// proposition de PRODUIT : contrairement à établissement (aucune "valeur actuelle" possible, la
// fiche n'existe pas encore), le type/établissement sont déjà fixés par le socio à la soumission
// (immuables, même invariant que ProductForm admin-direct) — affichés en lecture seule par la page
// parente, jamais corrigibles ici. Réutilise ProductTypeFields (même composant que ProductForm)
// pour le reste : aucune divergence de gating possible entre le formulaire de proposition et
// l'écran de modération (décision Jérôme 2026-08-17, "extraire plutôt que dupliquer").
export function ModerateProductCreationProposalForm({
  proposalId,
  expectedVersion,
  type,
  payload,
  availableTags,
}: {
  proposalId: string;
  expectedVersion: number;
  type: ProductType;
  payload: unknown;
  availableTags: TagOption[];
}) {
  const proposedPayload = (payload ?? {}) as RawProductCreationPayload;
  const proposedPhotos = Array.isArray(proposedPayload.photos) ? proposedPayload.photos : [];
  // getPublicUrl construit une URL sans appel réseau (bucket "catalog-media" public en lecture) —
  // instance jetable, même convention que handleDecision plus bas.
  const photoUrls = proposedPhotos.map(
    (photo) => createClient().storage.from("catalog-media").getPublicUrl(photo.storage_path).data.publicUrl,
  );

  const [name, setName] = useState<LocalizedValue>(() => ({ ...(asLocalizedField(proposedPayload.name) ?? {}) }));
  const [description, setDescription] = useState<LocalizedValue>(() => ({
    ...(asLocalizedField(proposedPayload.description) ?? {}),
  }));
  const fields = useProductTypeFieldsState(payloadToFieldsInit(proposedPayload));
  const [rejectionReason, setRejectionReason] = useState("");
  // Retour Jérôme (2026-08-18) : create_product_from_proposal crée toujours le produit
  // sellable=false (geste de publication volontairement séparé, feature 4) — sans cette invite,
  // l'admin devait re-naviguer manuellement vers la fiche pour la publier après coup. Affichée
  // seulement après une approbation réussie, jamais bloquante (fermer = rester non publié, comme
  // avant ce correctif).
  const [publishPrompt, setPublishPrompt] = useState<{ productId: string } | null>(null);
  const [isPublishing, setIsPublishing] = useState(false);

  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);

  function goToProposalsList() {
    router.push("/admin/proposals");
    router.refresh();
  }

  async function handlePublishChoice(publish: boolean) {
    if (!publishPrompt) return;
    if (!publish) {
      setPublishPrompt(null);
      goToProposalsList();
      return;
    }

    setIsPublishing(true);
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("set_product_sellable", {
      p_product_id: publishPrompt.productId,
      p_sellable: true,
    });
    setIsPublishing(false);

    if (rpcError) {
      toast.danger("No se pudo publicar la ficha. Puedes hacerlo luego desde su edición.");
      setPublishPrompt(null);
      goToProposalsList();
      return;
    }

    toast.success("Ficha publicada.");
    setPublishPrompt(null);
    goToProposalsList();
  }

  async function handleDecision(decision: "approve" | "reject") {
    if (decision === "approve" && !(name.es ?? "").trim()) {
      toast.danger("El nombre (es) es obligatorio.");
      return;
    }
    if (decision === "reject" && !rejectionReason.trim()) {
      toast.danger("El motivo es obligatorio para rechazar.");
      return;
    }

    setIsSubmitting(true);

    const supabase = createClient();
    const correctedPayload =
      decision === "approve" ? buildProductCreationPayload(type, name, description, fields) : null;
    const { data, error: rpcError } = await supabase.rpc("moderate_product_proposal", {
      p_proposal_id: proposalId,
      p_decision: decision,
      p_expected_version: expectedVersion,
      p_corrected_payload: correctedPayload as Json | null,
      p_rejection_reason: decision === "reject" ? rejectionReason.trim() : undefined,
    });

    setIsSubmitting(false);

    const result = data as ModerateResult | null;
    if (rpcError || !result?.ok) {
      if (result?.reason === "already_handled") {
        toast.danger(
          `Esta propuesta ya fue procesada${result.reviewed_by_email ? ` por ${result.reviewed_by_email}` : ""} (estado: ${result.status}).`,
        );
        return;
      }
      toast.danger(
        MODERATE_ERRORS[result?.reason ?? ""] ?? "No se pudo procesar la propuesta. Inténtalo de nuevo.",
      );
      return;
    }

    toast.success(decision === "approve" ? "Propuesta aprobada." : "Propuesta rechazada.");

    // Une approbation crée toujours un produit sellable=false (create_product_from_proposal) — sauf
    // si le résultat n'expose exceptionnellement aucun product_id (défense en profondeur, ne
    // devrait jamais arriver pour decision="approve" sur kind='create'), proposer de publier tout
    // de suite plutôt que de renvoyer vers la liste des propositions.
    if (decision === "approve" && result.product_id) {
      setPublishPrompt({ productId: result.product_id });
      return;
    }

    goToProposalsList();
  }

  return (
    <div className="flex max-w-md flex-col gap-4">
      <LocalizedTextField
        label="Nombre"
        value={name}
        onChange={setName}
        isRequired
        inputName="nombre"
        testIdPrefix="name"
      />
      <LocalizedTextField
        label="Descripción — opcional"
        value={description}
        onChange={setDescription}
        multiline
        testIdPrefix="description"
        fieldTestId="description-textarea"
      />

      {/* Lecture seule : ce formulaire n'édite jamais les photos (cf. commentaire de tête de la
          migration 20260817140000) — elles sont toujours rattachées telles que proposées par le
          socio, jamais via p_corrected_payload. */}
      {proposedPhotos.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <Label>Fotos propuestas</Label>
          <div className="flex flex-wrap gap-2" data-testid="proposed-photos">
            {photoUrls.map((url, index) => (
              // eslint-disable-next-line @next/next/no-img-element -- aperçu de modération, pas une image de contenu (next/image inutile ici)
              <img
                key={url}
                src={url}
                alt=""
                data-testid={`proposed-photo-${index}`}
                className="h-20 w-20 rounded object-cover"
              />
            ))}
          </div>
        </div>
      ) : null}

      <ProductTypeFields
        type={type}
        state={fields}
        showTags
        showHotelRoomsEditor
        showSlotRulesEditor
        allowCreateTags
        hidePhotosInHotelRooms
        availableTags={availableTags}
      />

      <TextField value={rejectionReason} onChange={setRejectionReason}>
        <Label>Motivo de rechazo — obligatorio para rechazar</Label>
        <TextArea id="rejection-reason" name="rejection-reason" />
      </TextField>

      <div className="flex gap-2">
        <Button
          type="button"
          isDisabled={isSubmitting}
          onPress={() => handleDecision("approve")}
          data-testid="approve-button"
        >
          {isSubmitting ? "Procesando…" : "Aprobar"}
        </Button>
        <Button
          type="button"
          variant="outline"
          isDisabled={isSubmitting}
          onPress={() => handleDecision("reject")}
          data-testid="reject-button"
        >
          {isSubmitting ? "Procesando…" : "Rechazar"}
        </Button>
      </div>

      <Modal>
        <Modal.Backdrop
          isOpen={publishPrompt !== null}
          onOpenChange={(open) => {
            if (!open) handlePublishChoice(false);
          }}
        >
          <Modal.Container>
            <Modal.Dialog>
              <Modal.CloseTrigger />
              <Modal.Header>
                <Modal.Heading>¿Publicar esta ficha ahora?</Modal.Heading>
              </Modal.Header>
              <Modal.Body>
                <p className="text-sm text-muted">
                  La propuesta fue aprobada, pero la ficha todavía no está publicada (no vendible).
                  Puedes publicarla ahora mismo o dejarla para más tarde desde su edición.
                </p>
              </Modal.Body>
              <div className="flex justify-end gap-2 p-4 pt-0">
                <Button
                  type="button"
                  variant="outline"
                  isDisabled={isPublishing}
                  onPress={() => handlePublishChoice(false)}
                  data-testid="skip-publish-button"
                >
                  Más tarde
                </Button>
                <Button
                  type="button"
                  isDisabled={isPublishing}
                  onPress={() => handlePublishChoice(true)}
                  data-testid="confirm-publish-button"
                >
                  {isPublishing ? "Publicando…" : "Publicar ahora"}
                </Button>
              </div>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    </div>
  );
}
