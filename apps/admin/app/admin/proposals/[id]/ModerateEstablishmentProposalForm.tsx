"use client";

import { useState } from "react";
import { createClient } from "@hifago/supabase/client";
import { Button, Input, Label, TextArea, TextField } from "@hifago/ui";

const MODERATE_ERRORS: Record<string, string> = {
  proposal_not_found: "No se encontró la propuesta.",
  version_conflict: "Esta propuesta fue modificada por otra persona. Recarga la página.",
};

type ModerateResult = { ok: boolean; reason?: string; status?: string; reviewed_by_email?: string };

// Aperçu "valeur actuelle" vide pour kind='create' (l'établissement n'existe pas encore) — espace
// réservé explicite plutôt qu'un tableau vide silencieux (docs/specs/06-gestion-etablissement.md
// §9). Formulaire de correction pré-rempli avec les valeurs PROPOSÉES, même patron que
// ModerateProposalForm.tsx (produits).
export function ModerateEstablishmentProposalForm({
  proposalId,
  expectedVersion,
  kind,
  currentNameEs,
  currentNameEn,
  currentDescriptionEs,
  currentDescriptionEn,
  currentAddress,
  currentLat,
  currentLon,
  proposedNameEs,
  proposedNameEn,
  proposedDescriptionEs,
  proposedDescriptionEn,
  proposedAddress,
  proposedLat,
  proposedLon,
}: {
  proposalId: string;
  expectedVersion: number;
  kind: "create" | "edit";
  currentNameEs: string;
  currentNameEn: string;
  currentDescriptionEs: string;
  currentDescriptionEn: string;
  currentAddress: string;
  currentLat: string;
  currentLon: string;
  proposedNameEs: string;
  proposedNameEn: string;
  proposedDescriptionEs: string;
  proposedDescriptionEn: string;
  proposedAddress: string;
  proposedLat: string;
  proposedLon: string;
}) {
  const [nameEs, setNameEs] = useState(proposedNameEs);
  const [nameEn, setNameEn] = useState(proposedNameEn);
  const [descriptionEs, setDescriptionEs] = useState(proposedDescriptionEs);
  const [descriptionEn, setDescriptionEn] = useState(proposedDescriptionEn);
  const [address, setAddress] = useState(proposedAddress);
  const [lat, setLat] = useState(proposedLat);
  const [lon, setLon] = useState(proposedLon);
  const [rejectionReason, setRejectionReason] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [success, setSuccess] = useState<"approved" | "rejected" | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function buildCorrectedPayload() {
    const name: Record<string, string> = { es: nameEs.trim() };
    if (nameEn.trim()) name.en = nameEn.trim();

    const description: Record<string, string> | null = descriptionEs.trim()
      ? { es: descriptionEs.trim(), ...(descriptionEn.trim() ? { en: descriptionEn.trim() } : {}) }
      : null;

    return {
      name,
      description,
      address: address.trim() || null,
      lat: lat.trim() ? Number(lat) : null,
      lon: lon.trim() ? Number(lon) : null,
    };
  }

  async function handleDecision(decision: "approve" | "reject") {
    setError(null);
    setNotice(null);

    if (decision === "approve" && !nameEs.trim()) {
      setError("El nombre (es) es obligatorio.");
      return;
    }
    if (decision === "reject" && !rejectionReason.trim()) {
      setError("El motivo es obligatorio para rechazar.");
      return;
    }

    setIsSubmitting(true);

    const supabase = createClient();
    const { data, error: rpcError } = await supabase.rpc("moderate_establishment_proposal", {
      p_proposal_id: proposalId,
      p_decision: decision,
      p_expected_version: expectedVersion,
      p_corrected_payload: decision === "approve" ? buildCorrectedPayload() : null,
      p_rejection_reason: decision === "reject" ? rejectionReason.trim() : undefined,
    });

    setIsSubmitting(false);

    const result = data as ModerateResult | null;
    if (rpcError || !result?.ok) {
      if (result?.reason === "already_handled") {
        setNotice(
          `Esta propuesta ya fue procesada${result.reviewed_by_email ? ` por ${result.reviewed_by_email}` : ""} (estado: ${result.status}).`,
        );
        return;
      }
      setError(
        MODERATE_ERRORS[result?.reason ?? ""] ?? "No se pudo procesar la propuesta. Inténtalo de nuevo.",
      );
      return;
    }

    setSuccess(decision === "approve" ? "approved" : "rejected");
  }

  if (success) {
    return (
      <p role="status" data-testid="moderation-success" className="text-sm font-medium">
        {success === "approved"
          ? kind === "create"
            ? "Propuesta aprobada — el establecimiento ya existe en el registro."
            : "Propuesta aprobada — la ficha ya refleja los valores publicados."
          : "Propuesta rechazada."}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-4 rounded-lg border border-border p-4 sm:grid-cols-2">
        <div data-testid="current-values">
          <p className="text-sm font-medium">Valor actual</p>
          {kind === "create" ? (
            <p className="mt-2 text-sm text-muted" data-testid="no-current-establishment">
              — nuevo establecimiento —
            </p>
          ) : (
            <dl className="mt-2 flex flex-col gap-1 text-sm text-muted">
              <div>
                <dt className="inline font-medium text-foreground">Nombre (es): </dt>
                <dd className="inline">{currentNameEs || "—"}</dd>
              </div>
              <div>
                <dt className="inline font-medium text-foreground">Nombre (en): </dt>
                <dd className="inline">{currentNameEn || "—"}</dd>
              </div>
              <div>
                <dt className="inline font-medium text-foreground">Descripción (es): </dt>
                <dd className="inline">{currentDescriptionEs || "—"}</dd>
              </div>
              <div>
                <dt className="inline font-medium text-foreground">Descripción (en): </dt>
                <dd className="inline">{currentDescriptionEn || "—"}</dd>
              </div>
              <div>
                <dt className="inline font-medium text-foreground">Dirección: </dt>
                <dd className="inline">{currentAddress || "—"}</dd>
              </div>
              <div>
                <dt className="inline font-medium text-foreground">Lat/Lon: </dt>
                <dd className="inline">
                  {currentLat || "—"} / {currentLon || "—"}
                </dd>
              </div>
            </dl>
          )}
        </div>
        <div data-testid="proposed-values">
          <p className="text-sm font-medium">Valor propuesto</p>
          <dl className="mt-2 flex flex-col gap-1 text-sm text-muted">
            <div>
              <dt className="inline font-medium text-foreground">Nombre (es): </dt>
              <dd className="inline">{proposedNameEs || "—"}</dd>
            </div>
            <div>
              <dt className="inline font-medium text-foreground">Nombre (en): </dt>
              <dd className="inline">{proposedNameEn || "—"}</dd>
            </div>
            <div>
              <dt className="inline font-medium text-foreground">Descripción (es): </dt>
              <dd className="inline">{proposedDescriptionEs || "—"}</dd>
            </div>
            <div>
              <dt className="inline font-medium text-foreground">Descripción (en): </dt>
              <dd className="inline">{proposedDescriptionEn || "—"}</dd>
            </div>
            <div>
              <dt className="inline font-medium text-foreground">Dirección: </dt>
              <dd className="inline">{proposedAddress || "—"}</dd>
            </div>
            <div>
              <dt className="inline font-medium text-foreground">Lat/Lon: </dt>
              <dd className="inline">
                {proposedLat || "—"} / {proposedLon || "—"}
              </dd>
            </div>
          </dl>
        </div>
      </div>

      <div className="flex max-w-md flex-col gap-4">
        <TextField isRequired value={nameEs} onChange={setNameEs}>
          <Label>Nombre (es)</Label>
          <Input id="name-es" name="name-es" />
        </TextField>

        <TextField value={nameEn} onChange={setNameEn}>
          <Label>Nombre (en) — opcional</Label>
          <Input id="name-en" name="name-en" />
        </TextField>

        <TextField value={descriptionEs} onChange={setDescriptionEs}>
          <Label>Descripción (es) — opcional</Label>
          <TextArea id="description-es" name="description-es" />
        </TextField>

        <TextField value={descriptionEn} onChange={setDescriptionEn}>
          <Label>Descripción (en) — opcional</Label>
          <TextArea id="description-en" name="description-en" />
        </TextField>

        <TextField value={address} onChange={setAddress}>
          <Label>Dirección — opcional</Label>
          <Input id="address" name="address" />
        </TextField>

        <div className="grid grid-cols-2 gap-4">
          <TextField value={lat} onChange={setLat}>
            <Label>Latitud</Label>
            <Input id="lat" name="lat" />
          </TextField>
          <TextField value={lon} onChange={setLon}>
            <Label>Longitud</Label>
            <Input id="lon" name="lon" />
          </TextField>
        </div>

        <TextField value={rejectionReason} onChange={setRejectionReason}>
          <Label>Motivo de rechazo — obligatorio para rechazar</Label>
          <TextArea id="rejection-reason" name="rejection-reason" />
        </TextField>

        {notice ? (
          <p role="status" data-testid="moderation-notice" className="text-sm text-muted">
            {notice}
          </p>
        ) : null}
        {error ? (
          <p role="alert" data-testid="moderation-error" className="text-sm text-danger">
            {error}
          </p>
        ) : null}

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
      </div>
    </div>
  );
}
