"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@hifago/supabase/client";
import { Button, toast } from "@hifago/ui";
import { ESTABLISHMENT_STATUS_LABELS } from "@/lib/lists/filters";

// Même patron que ProductStatusBlock (apps/admin/app/admin/products/[id]/edit/) — geste
// "publier/dépublier" symétrique côté établissement, jusqu'ici manquant (retour Jérôme, 2026-08-20 :
// set_establishment_status).
export function EstablishmentStatusBlock({
  establishmentId,
  initialStatus,
}: {
  establishmentId: string;
  initialStatus: string;
}) {
  const router = useRouter();
  const [status, setStatus] = useState(initialStatus);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function toggle() {
    setIsSubmitting(true);

    const nextStatus = status === "active" ? "archived" : "active";
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("set_establishment_status", {
      p_establishment_id: establishmentId,
      p_status: nextStatus,
    });

    if (rpcError) {
      toast.danger("No se pudo cambiar el estado.");
      setIsSubmitting(false);
      return;
    }

    setStatus(nextStatus);
    setIsSubmitting(false);
    toast.success(nextStatus === "active" ? "Establecimiento publicado." : "Establecimiento despublicado.");
    router.refresh();
  }

  return (
    <div className="flex items-center gap-3 rounded-lg border bg-surface p-4">
      <span className="text-sm font-medium" data-testid="establishment-status-badge">
        {ESTABLISHMENT_STATUS_LABELS[status] ?? status}
      </span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        isDisabled={isSubmitting}
        onPress={toggle}
        data-testid="toggle-establishment-status-button"
      >
        {isSubmitting ? "…" : status === "active" ? "Despublicar" : "Publicar"}
      </Button>
    </div>
  );
}
