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

const TYPE_LABELS: Record<string, string> = {
  activity: "Actividad",
  evento: "Evento",
  camp: "Campamento",
  lodging: "Alojamiento",
  hotel: "Hotel",
  transport: "Transporte",
};

type PendingCreation = {
  id: string;
  type: string | null;
  payload: unknown;
  establishment_id: string | null;
  establishmentName?: string | null;
  created_at: string;
};

// Spec 15 — contrairement à PendingCreationBanner (établissement, plafond 1 pending pour tout le
// partenaire) : ici le plafond est 1 pending PAR ÉTABLISSEMENT, donc un socio multi-établissements
// peut avoir plusieurs créations en attente simultanément — une grille, jamais un singleton.
// Rendu en CatalogCard comme le reste de /partner/products (retour Jérôme : une proposition en
// attente reste une carte normale, seul le tag de statut la distingue) — jamais deux tags
// empilés, "Pendiente de revisión" REMPLACE le tag publié/brouillon qui n'existe pas encore ici.
export function PendingProductCreationsList({
  proposals: initialProposals,
}: {
  proposals: PendingCreation[];
}) {
  const [proposals, setProposals] = useState(initialProposals);
  const [withdrawingId, setWithdrawingId] = useState<string | null>(null);
  // Un seul client, réutilisé pour la soumission et pour résoudre l'URL publique de chaque photo
  // ci-dessous — auparavant recréé via createClient() dans la .map() de CHAQUE photo de CHAQUE
  // proposition à CHAQUE rendu.
  const supabase = createClient();

  async function handleWithdraw(proposalId: string) {
    setWithdrawingId(proposalId);

    const { data, error: rpcError } = await supabase.rpc("withdraw_product_proposal", {
      p_proposal_id: proposalId,
    });

    setWithdrawingId(null);

    const result = data as { ok: boolean; reason?: string } | null;
    if (rpcError || !result?.ok) {
      toast.danger(
        WITHDRAW_ERRORS[result?.reason ?? ""] ?? "No se pudo retirar la propuesta. Inténtalo de nuevo.",
      );
      return;
    }

    setProposals((prev) => prev.filter((p) => p.id !== proposalId));
    toast.success("Propuesta retirada.");
  }

  if (proposals.length === 0) return null;

  return (
    <div className="flex flex-col gap-3" data-testid="pending-product-creations">
      <CatalogCardGrid>
        {proposals.map((proposal) => {
          const proposedPayload = (proposal.payload ?? {}) as {
            name?: unknown;
            photos?: { storage_path: string }[];
          };
          const proposedName = resolveLocalizedField(asLocalizedField(proposedPayload.name), "es");
          const photos = (Array.isArray(proposedPayload.photos) ? proposedPayload.photos : []).map(
            (photo, index) => ({
              id: `${proposal.id}-${index}`,
              url: supabase.storage.from("catalog-media").getPublicUrl(photo.storage_path).data.publicUrl,
              alt: proposedName ?? proposal.id,
            }),
          );

          return (
            <CatalogCard
              key={proposal.id}
              testId={`pending-product-creation-${proposal.id}`}
              photos={photos}
              title={proposedName ?? proposal.id}
              subtitle={proposal.establishmentName ?? undefined}
              meta={TYPE_LABELS[proposal.type ?? ""] ?? proposal.type ?? undefined}
              statusChips={[{ label: "Pendiente de revisión", color: "warning" }]}
              footer={
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  isDisabled={withdrawingId === proposal.id}
                  onPress={() => handleWithdraw(proposal.id)}
                  data-testid={`withdraw-product-creation-${proposal.id}`}
                >
                  {withdrawingId === proposal.id ? "Retirando…" : "Retirar"}
                </Button>
              }
            />
          );
        })}
      </CatalogCardGrid>
    </div>
  );
}
