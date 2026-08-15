"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@hifago/supabase/client";
import { asLocalizedField } from "@hifago/domain";
import { Button, Input, Label, TextArea, TextField } from "@hifago/ui";
import {
  emptyTier,
  lowestTierPrice,
  toPriceTiersColumn,
  validatePriceTiers,
  type PriceTier,
} from "@/lib/products/priceTiers";

type ProductTier = { min_qty: number; max_qty: number; price_cop: number };

type Product = {
  id: string;
  name: unknown;
  description: unknown;
  price_cop: number | null;
  price_tiers: unknown;
  min_qty: number | null;
  max_qty: number | null;
  type: string;
  establishment_id: string;
};

type PriceMode = "simple" | "tiers";

function tiersFromColumn(value: unknown): PriceTier[] {
  if (!Array.isArray(value) || value.length === 0) return [emptyTier()];
  return (value as ProductTier[]).map((tier) => ({
    minQty: String(tier.min_qty),
    maxQty: String(tier.max_qty),
    priceCop: String(tier.price_cop),
  }));
}

export function EditProductForm({ product }: { product: Product }) {
  const router = useRouter();
  const initialName = asLocalizedField(product.name);
  const initialDescription = asLocalizedField(product.description);
  const isActivity = product.type === "activity";
  const hasInitialTiers = Array.isArray(product.price_tiers) && product.price_tiers.length > 0;

  // Un seul champ, pas de saisie ES/EN séparée — même décision que l'établissement (spec 03) et
  // que la création (NewProductForm) : cf. commentaire là-bas.
  const [nombre, setNombre] = useState(initialName?.es ?? "");
  const [descriptionEs, setDescriptionEs] = useState(initialDescription?.es ?? "");
  const [descriptionEn, setDescriptionEn] = useState(initialDescription?.en ?? "");
  const [priceCop, setPriceCop] = useState(String(product.price_cop ?? 0));
  const [priceMode, setPriceMode] = useState<PriceMode>(hasInitialTiers ? "tiers" : "simple");
  const [priceTiers, setPriceTiers] = useState<PriceTier[]>(() => tiersFromColumn(product.price_tiers));
  const [minQty, setMinQty] = useState(product.min_qty !== null ? String(product.min_qty) : "");
  const [maxQty, setMaxQty] = useState(product.max_qty !== null ? String(product.max_qty) : "");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function updateTier(index: number, next: PriceTier) {
    setPriceTiers((prev) => prev.map((tier, i) => (i === index ? next : tier)));
  }

  function removeTier(index: number) {
    setPriceTiers((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    const price = Number(priceCop);
    const usesTiers = isActivity && priceMode === "tiers";
    if (!nombre.trim() || (!usesTiers && (!Number.isFinite(price) || price <= 0))) {
      setError("El nombre (es) y el precio son obligatorios.");
      return;
    }
    if (usesTiers) {
      const tiersError = validatePriceTiers(priceTiers);
      if (tiersError) {
        setError(tiersError);
        return;
      }
    }
    if (isActivity && minQty.trim() && maxQty.trim() && Number(minQty) > Number(maxQty)) {
      setError("La cantidad mínima no puede ser mayor a la máxima.");
      return;
    }

    setIsSubmitting(true);

    const name: Record<string, string> = { es: nombre.trim() };

    const description: Record<string, string> = {};
    if (descriptionEs.trim()) description.es = descriptionEs.trim();
    if (descriptionEn.trim()) description.en = descriptionEn.trim();

    // schedule/qty_unit/calendar_default_open ne sont pas touchés ici — hors périmètre de ce
    // grain (cf. plan feature 3), gardent leurs valeurs par défaut de la Tranche 2. category
    // retirée de cet écran (spec 08) — remplacée par les tags (ProductTagsBlock, bloc séparé) ;
    // la colonne reste en base, toujours utilisée par le flux socio (product_proposals),
    // inchangé.
    const supabase = createClient();
    const { error: updateError } = await supabase
      .from("products")
      .update({
        name,
        description: Object.keys(description).length > 0 ? description : null,
        price_cop: usesTiers ? lowestTierPrice(priceTiers) : price,
        price_tiers: usesTiers ? toPriceTiersColumn(priceTiers) : null,
        ...(isActivity
          ? {
              min_qty: minQty.trim() ? Number(minQty) : null,
              max_qty: maxQty.trim() ? Number(maxQty) : null,
            }
          : {}),
      })
      .eq("id", product.id);

    if (updateError) {
      setError("No se pudo guardar la actividad.");
      setIsSubmitting(false);
      return;
    }

    router.push(`/admin/establishments/${product.establishment_id}`);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="flex max-w-md flex-col gap-4">
      <TextField fullWidth name="nombre" value={nombre} onChange={setNombre} isRequired>
        <Label>Nombre</Label>
        <Input id="nombre" />
      </TextField>
      <TextField fullWidth name="description-es" value={descriptionEs} onChange={setDescriptionEs}>
        <Label>Descripción (es) — opcional</Label>
        <TextArea />
      </TextField>
      <TextField fullWidth name="description-en" value={descriptionEn} onChange={setDescriptionEn}>
        <Label>Descripción (en) — opcional</Label>
        <TextArea />
      </TextField>

      {isActivity ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <Label>Precio</Label>
            <button
              type="button"
              data-testid="price-mode-toggle"
              onClick={() => setPriceMode(priceMode === "simple" ? "tiers" : "simple")}
              className="text-xs font-medium underline"
            >
              {priceMode === "simple" ? "Definir por tramos" : "Volver a precio simple"}
            </button>
          </div>
          {priceMode === "simple" ? (
            <TextField fullWidth name="price" value={priceCop} onChange={setPriceCop} isRequired>
              <Input id="price" type="number" min={1} data-testid="price-input" />
            </TextField>
          ) : (
            <div className="flex flex-col gap-2" data-testid="price-tiers-editor">
              {priceTiers.map((tier, index) => (
                <div key={index} className="flex items-end gap-2">
                  <TextField value={tier.minQty} onChange={(value) => updateTier(index, { ...tier, minQty: value })}>
                    <Label>Desde</Label>
                    <Input type="number" min={1} data-testid={`price-tier-min-${index}`} />
                  </TextField>
                  <TextField value={tier.maxQty} onChange={(value) => updateTier(index, { ...tier, maxQty: value })}>
                    <Label>Hasta</Label>
                    <Input type="number" min={1} data-testid={`price-tier-max-${index}`} />
                  </TextField>
                  <TextField
                    value={tier.priceCop}
                    onChange={(value) => updateTier(index, { ...tier, priceCop: value })}
                  >
                    <Label>Precio (COP)</Label>
                    <Input type="number" min={1} data-testid={`price-tier-price-${index}`} />
                  </TextField>
                  {priceTiers.length > 1 ? (
                    <button
                      type="button"
                      onClick={() => removeTier(index)}
                      aria-label="Quitar tramo"
                      data-testid={`remove-price-tier-${index}`}
                      className="pb-2 text-sm text-danger"
                    >
                      ×
                    </button>
                  ) : null}
                </div>
              ))}
              <button
                type="button"
                onClick={() => setPriceTiers((prev) => [...prev, emptyTier()])}
                data-testid="add-price-tier-button"
                className="self-start text-xs font-medium underline"
              >
                + Agregar tramo
              </button>
            </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <TextField value={minQty} onChange={setMinQty}>
              <Label>Cantidad mínima — opcional</Label>
              <Input type="number" min={1} data-testid="min-qty-input" />
            </TextField>
            <TextField value={maxQty} onChange={setMaxQty}>
              <Label>Cantidad máxima — opcional</Label>
              <Input type="number" min={1} data-testid="max-qty-input" />
            </TextField>
          </div>
        </div>
      ) : (
        <TextField fullWidth name="price" value={priceCop} onChange={setPriceCop} isRequired>
          <Label>Precio (COP)</Label>
          <Input id="price" type="number" min={1} />
        </TextField>
      )}

      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      <Button type="submit" isDisabled={isSubmitting} data-testid="save-product-button">
        {isSubmitting ? "Guardando…" : "Guardar cambios"}
      </Button>
    </form>
  );
}
