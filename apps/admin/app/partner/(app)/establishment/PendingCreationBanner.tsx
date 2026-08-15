"use client";

import { useState } from "react";
import { createClient } from "@hifago/supabase/client";
import { asLocalizedField, resolveLocalizedField } from "@hifago/domain";
import { Button, Card } from "@hifago/ui";

const WITHDRAW_ERRORS: Record<string, string> = {
  proposal_not_found: "No se encontró la propuesta.",
  not_pending: "Esta propuesta ya fue procesada.",
  not_authenticated: "No se pudo verificar tu sesión. Vuelve a intentarlo.",
};

type PendingCreation = { id: string; payload: unknown; created_at: string };

export function PendingCreationBanner({ proposal: initialProposal }: { proposal: PendingCreation }) {
  const [proposal, setProposal] = useState<PendingCreation | null>(initialProposal);
  const [error, setError] = useState<string | null>(null);
  const [isWithdrawing, setIsWithdrawing] = useState(false);

  async function handleWithdraw() {
    if (!proposal) return;
    setError(null);
    setIsWithdrawing(true);

    const supabase = createClient();
    const { data, error: rpcError } = await supabase.rpc("withdraw_establishment_proposal", {
      p_proposal_id: proposal.id,
    });

    setIsWithdrawing(false);

    const result = data as { ok: boolean; reason?: string } | null;
    if (rpcError || !result?.ok) {
      setError(
        WITHDRAW_ERRORS[result?.reason ?? ""] ?? "No se pudo retirar la propuesta. Inténtalo de nuevo.",
      );
      return;
    }

    setProposal(null);
  }

  if (!proposal) return null;

  const proposedName = resolveLocalizedField(
    asLocalizedField((proposal.payload as { name?: unknown })?.name),
    "es",
  );

  return (
    <Card data-testid="pending-creation-banner">
      <Card.Content className="flex items-center justify-between">
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium">Propuesta de creación pendiente de revisión</p>
          <p className="text-sm text-muted">{proposedName ?? proposal.id}</p>
          {error ? (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : null}
        </div>
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
      </Card.Content>
    </Card>
  );
}
