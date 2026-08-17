"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@hifago/supabase/client";
import { Button } from "@hifago/ui";

export function ProductStatusBlock({
  productId,
  initialSellable,
}: {
  productId: string;
  initialSellable: boolean;
}) {
  const router = useRouter();
  const [sellable, setSellable] = useState(initialSellable);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function toggle() {
    setError(null);
    setIsSubmitting(true);

    const nextSellable = !sellable;
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("set_product_sellable", {
      p_product_id: productId,
      p_sellable: nextSellable,
    });

    if (rpcError) {
      setError("No se pudo cambiar el estado.");
      setIsSubmitting(false);
      return;
    }

    setSellable(nextSellable);
    setIsSubmitting(false);
    router.refresh();
  }

  return (
    <div className="flex items-center gap-3 rounded-lg border bg-surface p-4">
      <span className="text-sm font-medium" data-testid="product-status-badge">
        {sellable ? "Vendible" : "No vendible"}
      </span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        isDisabled={isSubmitting}
        onPress={toggle}
        data-testid="toggle-sellable-button"
      >
        {isSubmitting ? "…" : sellable ? "Despublicar" : "Publicar"}
      </Button>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
