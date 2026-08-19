"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@hifago/ui";
import { SetOrderLineStatusDialog } from "../SetOrderLineStatusDialog";
import { ModifyOrderLineDialog } from "@/components/ModifyOrderLineDialog";

// Spec 20 §0/§5 — actions de la fiche de réservation, réutilisant telles quelles les RPC/dialogues
// déjà en place : SetOrderLineStatusDialog (no_show/cancelled_by_provider, cf. migration
// 20260818180000) et ModifyOrderLineDialog (components/, partagé admin+socio car consommé par les
// deux portails — cf. OrdersTable.tsx —, désormais utilisable par l'operator sur son propre
// établissement depuis la même migration — aucun changement de code requis côté composant, seule
// la RPC sous-jacente a été élargie). router.refresh() après succès : cette page est un Server
// Component, pas d'état local à synchroniser manuellement comme ReservationsTable.
export function ReservationActions({
  orderLineId,
  status,
  hasSlot,
  initialDate,
  initialEndDate,
  initialQty,
}: {
  orderLineId: string;
  status: string;
  hasSlot: boolean;
  initialDate: string;
  initialEndDate: string | null;
  initialQty: number;
}) {
  const router = useRouter();
  const [statusDialog, setStatusDialog] = useState<"no_show" | "cancelled_by_provider" | null>(null);
  const [modifyOpen, setModifyOpen] = useState(false);

  if (status !== "reserved") {
    return null;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" data-testid="detail-no-show-button" onPress={() => setStatusDialog("no_show")}>
          Cliente no vino
        </Button>
        <Button size="sm" variant="outline" data-testid="detail-cancel-button" onPress={() => setStatusDialog("cancelled_by_provider")}>
          Cancelar reserva
        </Button>
        {hasSlot ? (
          <p className="text-sm text-muted" data-testid="modify-unavailable-slot">
            La modificación de horarios reservados aún no está disponible aquí — cancela y crea una
            nueva reserva.
          </p>
        ) : (
          <Button size="sm" variant="outline" data-testid="detail-modify-button" onPress={() => setModifyOpen(true)}>
            Modificar fecha
          </Button>
        )}
      </div>

      {statusDialog ? (
        <SetOrderLineStatusDialog
          orderLineId={orderLineId}
          targetStatus={statusDialog}
          open={statusDialog !== null}
          onOpenChange={(open) => {
            if (!open) setStatusDialog(null);
          }}
          onSuccess={() => router.refresh()}
        />
      ) : null}

      {modifyOpen ? (
        <ModifyOrderLineDialog
          orderLineId={orderLineId}
          initialDate={initialDate}
          initialEndDate={initialEndDate}
          initialQty={initialQty}
          open={modifyOpen}
          onOpenChange={setModifyOpen}
          onSuccess={() => router.refresh()}
        />
      ) : null}
    </div>
  );
}
