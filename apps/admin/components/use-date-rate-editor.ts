"use client";

import { useState } from "react";
import { createClient } from "@hifago/supabase/client";
import { toast } from "@hifago/ui";

type SetRateResult = { ok: boolean; reason?: string };

export type DateRateEntityType = "product";

// set_date_rate (migration 20260817210000) retourne ses propres raisons ('not_found' — jamais
// 'product_not_found', générique — et 'invalid_price'), distinctes de celles de
// set_product_availability. Vide = supprime l'override existant (retour au prix de base), jamais
// une valeur à refuser.
//
// Ce hook a été extrait alors que set_date_rate dispatchait entre deux entités (produit et chambre
// d'hôtel) et que ce wrapper était dupliqué verbatim entre AvailabilityFormFields et RoomDateEditor.
// T3 étape 2 (20260827220000) a supprimé les chambres : 'product' est désormais la seule valeur
// possible. Le paramètre survit parce que la RPC l'exige encore — pas parce qu'il reste un choix.
function rateMessageFor(
  result: SetRateResult | null,
  notFoundLabel: string,
  genericErrorLabel: string,
): string {
  if (result?.reason === "invalid_price") {
    return "El precio debe ser un número válido mayor a 0.";
  }
  if (result?.reason === "not_found") {
    return notFoundLabel;
  }
  if (result?.reason === "not_authenticated") {
    return "No se pudo verificar tu sesión. Vuelve a intentarlo.";
  }
  if (result?.reason === "capability_suspended") {
    return "Tu capacidad de operador para este establecimiento no está activa.";
  }
  return genericErrorLabel;
}

export function useDateRateEditor({
  entityType,
  entityId,
  date,
  initialPrice,
  notFoundLabel,
  genericErrorLabel,
  onSaved,
}: {
  entityType: DateRateEntityType;
  entityId: string;
  date: string;
  initialPrice: string;
  // Libellés propres à l'appelant, cf. commentaire de rateMessageFor ci-dessus.
  notFoundLabel: string;
  genericErrorLabel: string;
  onSaved: () => void;
}) {
  const [priceInput, setPriceInput] = useState(initialPrice);
  const [isSavingPrice, setIsSavingPrice] = useState(false);

  async function handlePriceSubmit(event: React.FormEvent) {
    event.preventDefault();

    const trimmed = priceInput.trim();
    const price = trimmed === "" ? null : Number(trimmed);
    if (price !== null && (!Number.isFinite(price) || price <= 0)) {
      toast.danger("El precio debe ser un número válido mayor a 0.");
      return;
    }

    setIsSavingPrice(true);
    const supabase = createClient();
    const { data, error: rpcError } = await supabase.rpc("set_date_rate", {
      p_entity_type: entityType,
      p_entity_id: entityId,
      p_date: date,
      // Le générateur de types ne voit aucun DEFAULT sur p_price_cop (bigint) et le type donc en
      // number non nullable — la fonction SQL accepte pourtant explicitement NULL (supprime
      // l'override). Cast assumé, pas une vraie non-nullabilité.
      p_price_cop: price as number,
    });
    setIsSavingPrice(false);

    const result = data as SetRateResult | null;
    if (rpcError || !result?.ok) {
      toast.danger(rateMessageFor(result, notFoundLabel, genericErrorLabel));
      return;
    }

    toast.success(price === null ? "Precio especial eliminado." : "Precio especial guardado.");
    onSaved();
  }

  return { priceInput, setPriceInput, isSavingPrice, handlePriceSubmit };
}
