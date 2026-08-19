"use client";

import { useState } from "react";
import { createClient } from "@hifago/supabase/client";
import { asLocalizedField, resolveLocalizedField } from "@hifago/domain";
import { Button, toast } from "@hifago/ui";
import { CatalogCard, CatalogCardGrid } from "@/components/catalog-card";

const WITHDRAW_ERRORS: Record<string, string> = {
  proposal_not_found: "No se encontró la propuesta.",
  not_pending: "Esta propuesta ya fue procesada.",
  not_authenticated: "No se pudo verificar tu sesión. Vuelve a intentarlo.",
};

type PendingCreation = { id: string; payload: unknown; created_at: string };

// Rendu en CatalogCard comme le reste de /partner/establishment (retour Jérôme : une proposition
// en attente reste une carte normale, seul le tag de statut la distingue) — jamais deux tags
// empilés, "Pendiente de revisión" REMPLACE le tag activo/archivado qui n'existe pas encore ici.
// CatalogCardGrid même pour une seule carte : garde la même largeur de colonne que le reste de la
// grille en dessous, plutôt qu'une carte qui s'étire sur toute la largeur de la page.
export function PendingCreationBanner({ proposal: initialProposal }: { proposal: PendingCreation }) {
  const [proposal, setProposal] = useState<PendingCreation | null>(initialProposal);
  const [isWithdrawing, setIsWithdrawing] = useState(false);

  async function handleWithdraw() {
    if (!proposal) return;
    setIsWithdrawing(true);

    const supabase = createClient();
    const { data, error: rpcError } = await supabase.rpc("withdraw_establishment_proposal", {
      p_proposal_id: proposal.id,
    });

    setIsWithdrawing(false);

    const result = data as { ok: boolean; reason?: string } | null;
    if (rpcError || !result?.ok) {
      toast.danger(
        WITHDRAW_ERRORS[result?.reason ?? ""] ?? "No se pudo retirar la propuesta. Inténtalo de nuevo.",
      );
      return;
    }

    setProposal(null);
    toast.success("Propuesta retirada.");
  }

  if (!proposal) return null;

  const proposedName = resolveLocalizedField(
    asLocalizedField((proposal.payload as { name?: unknown })?.name),
    "es",
  );

  return (
    <CatalogCardGrid>
      <CatalogCard
        testId="pending-creation-banner"
        photos={[]}
        title={proposedName ?? proposal.id}
        statusChips={[{ label: "Pendiente de revisión", color: "warning" }]}
        footer={
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              isDisabled={isWithdrawing}
              onPress={handleWithdraw}
              data-testid="withdraw-creation-proposal-button"
            >
              {isWithdrawing ? "Retirando…" : "Retirar"}
            </Button>
          </>
        }
      />
    </CatalogCardGrid>
  );
}
