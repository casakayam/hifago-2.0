"use client";

import { useState } from "react";
import { createClient } from "@hifago/supabase/client";
import type { Json } from "@hifago/supabase/database.types";
import { asLocalizedField, nowIsoInstant, resolveLocalizedField } from "@hifago/domain";
import { Button, toast } from "@hifago/ui";
import { LocalizedTextField, type LocalizedValue } from "@/components/localized-text-field";
import { ProductTypeFields } from "@/components/product-type-fields";
import { buildProductEditPayload } from "@/lib/products/productEditPayload";
import {
  payloadToFieldsInit,
  useProductTypeFieldsState,
  type ProductType,
  type RawProductFieldsPayload,
} from "@/lib/products/useProductTypeFieldsState";

const SUBMIT_ERRORS: Record<string, string> = {
  product_not_found: "No se encontró la actividad.",
  capability_suspended: "Tu capacidad de operador para este establecimiento no está activa.",
  pending_cap_exceeded:
    "Ya tienes 10 propuestas pendientes. Espera a que se revisen antes de enviar más.",
  not_authenticated: "No se pudo verificar tu sesión. Vuelve a intentarlo.",
};

const WITHDRAW_ERRORS: Record<string, string> = {
  proposal_not_found: "No se encontró la propuesta.",
  not_pending: "Esta propuesta ya fue procesada.",
  not_authenticated: "No se pudo verificar tu sesión. Vuelve a intentarlo.",
};

type PendingProposal = { id: string; payload: unknown; created_at: string } | null;

// Retour direct de Jérôme (2026-08-17, même jour que la spec 15 ci-dessus) : ce formulaire était
// resté figé à son état d'origine (feature 15 historique, 2026-08-13) — name-es/name-en séparés
// (jamais migré vers LocalizedTextField comme le reste, spec 11) et une `category` fixe abandonnée
// par ProductForm admin-direct depuis la spec 08 (tags). Réécrit pour réutiliser exactement les
// mêmes briques que ProductForm/ProductTypeFields (spec 15) : parité totale avec le parcours
// d'édition admin-direct — mêmes champs, même gating par type, jamais tags/photos/slot_rules
// (délégués côté admin à des blocs séparés à sauvegarde immédiate, jamais couverts par ce même
// submit là non plus, cf. migration 20260817150000).
export function EditProposalForm({
  productId,
  type,
  currentPayload,
  pendingProposal,
  establishmentId,
  establishmentLobbyConnected,
}: {
  productId: string;
  type: ProductType;
  currentPayload: RawProductFieldsPayload & { name?: unknown; description?: unknown };
  pendingProposal: PendingProposal;
  // Corrigé le 2026-08-26 : ce formulaire rendait <ProductTypeFields type state /> SANS ces deux
  // props, donc la garde interne du bloc LobbyPMS (establishmentLobbyConnected) était toujours
  // fausse et le bloc n'était JAMAIS monté côté socio — un prestataire ne pouvait pas voir à quoi
  // son propre logement était lié, ni ce que LobbyPMS en savait. En lecture seule (arbitrage
  // Jérôme du même jour : Desvincular/Actualizar restent admin-only).
  establishmentId: string;
  establishmentLobbyConnected: boolean;
}) {
  const [name, setName] = useState<LocalizedValue>(() => ({ ...(asLocalizedField(currentPayload.name) ?? {}) }));
  const [description, setDescription] = useState<LocalizedValue>(() => ({
    ...(asLocalizedField(currentPayload.description) ?? {}),
  }));
  const fields = useProductTypeFieldsState(payloadToFieldsInit(currentPayload));

  const [proposal, setProposal] = useState(pendingProposal);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isWithdrawing, setIsWithdrawing] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    if (!(name.es ?? "").trim()) {
      toast.danger("El nombre (es) es obligatorio.");
      return;
    }

    setIsSubmitting(true);

    const payload = buildProductEditPayload(type, name, description, fields);
    const supabase = createClient();
    const { data, error: rpcError } = await supabase.rpc("submit_product_proposal", {
      p_product_id: productId,
      p_payload: payload as Json,
    });

    setIsSubmitting(false);

    const result = data as { ok: boolean; reason?: string; proposal_id?: string } | null;
    if (rpcError || !result?.ok) {
      toast.danger(
        SUBMIT_ERRORS[result?.reason ?? ""] ?? "No se pudo enviar la propuesta. Inténtalo de nuevo."
      );
      return;
    }

    // Reflète la proposition tout juste créée directement depuis la réponse RPC, sans dépendre
    // d'un aller-retour serveur : un `router.refresh()` ne suffirait pas ici, useState(props) ne
    // se resynchronise pas tout seul sur une nouvelle valeur de prop après le montage initial.
    if (result.proposal_id) {
      setProposal({
        id: result.proposal_id,
        payload,
        created_at: nowIsoInstant(),
      });
    }
    toast.success("Propuesta enviada.");
  }

  async function handleWithdraw() {
    if (!proposal) return;
    setIsWithdrawing(true);

    const supabase = createClient();
    const { data, error: rpcError } = await supabase.rpc("withdraw_product_proposal", {
      p_proposal_id: proposal.id,
    });

    setIsWithdrawing(false);

    const result = data as { ok: boolean; reason?: string } | null;
    if (rpcError || !result?.ok) {
      toast.danger(
        WITHDRAW_ERRORS[result?.reason ?? ""] ?? "No se pudo retirar la propuesta. Inténtalo de nuevo."
      );
      return;
    }

    setProposal(null);
    toast.success("Propuesta retirada.");
  }

  const proposedName = proposal
    ? resolveLocalizedField(asLocalizedField((proposal.payload as { name?: unknown })?.name), "es")
    : null;

  return (
    <div className="flex max-w-md flex-col gap-6">
      {proposal ? (
        <div
          className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4"
          data-testid="pending-proposal"
        >
          <p className="text-sm font-medium">Propuesta pendiente de revisión</p>
          <p className="text-sm text-muted">{proposedName ?? proposal.id}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            isDisabled={isWithdrawing}
            onPress={handleWithdraw}
            data-testid="withdraw-proposal-button"
          >
            {isWithdrawing ? "Retirando…" : "Retirar"}
          </Button>
        </div>
      ) : null}

      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
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

        <ProductTypeFields
          type={type}
          state={fields}
          establishmentId={establishmentId}
          establishmentLobbyConnected={establishmentLobbyConnected}
          lobbyLinkReadOnly
        />

        <Button type="submit" isDisabled={isSubmitting} data-testid="submit-proposal-button">
          {isSubmitting ? "Enviando…" : "Enviar propuesta"}
        </Button>
      </form>
    </div>
  );
}
