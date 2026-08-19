"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@hifago/supabase/client";
import { Button, toast } from "@hifago/ui";

type ProcessResult = { ok: boolean; sent?: number; skipped?: number; remaining?: number };

export function ProcessBatchButton({
  campaignId,
  isCompleted,
}: {
  campaignId: string;
  isCompleted: boolean;
}) {
  const router = useRouter();
  const [isProcessing, setIsProcessing] = useState(false);
  const [lastResult, setLastResult] = useState<ProcessResult | null>(null);

  async function handleProcess() {
    setIsProcessing(true);

    const supabase = createClient();
    const { data, error: rpcError } = await supabase.rpc("process_campaign_batch", {
      p_campaign_id: campaignId,
    });

    setIsProcessing(false);

    const result = data as ProcessResult | null;
    if (rpcError || !result?.ok) {
      toast.danger("No se pudo procesar el lote.");
      return;
    }

    setLastResult(result);
    toast.success(`Lote procesado: ${result.sent} enviados.`);
    // status='pending' est le curseur de position (feature 25) : répétable jusqu'à épuisement,
    // router.refresh() recharge les compteurs et le statut de la campagne depuis le serveur.
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-2">
      <Button
        onPress={handleProcess}
        isDisabled={isProcessing || isCompleted}
        data-testid="process-batch-button"
        className="w-fit"
      >
        {isProcessing ? "Procesando…" : isCompleted ? "Campaña completada" : "Procesar un lote"}
      </Button>
      {lastResult ? (
        <p className="text-sm text-muted" data-testid="last-batch-result">
          Último lote: {lastResult.sent} enviados, {lastResult.skipped} ignorados,{" "}
          {lastResult.remaining} pendientes restantes.
        </p>
      ) : null}
    </div>
  );
}
