"use client";

import { Input, Label, TextField } from "@hifago/ui";
import type { ProductTypeFieldsState } from "@/lib/products/useProductTypeFieldsState";

// Extrait de product-type-fields.tsx (découpage des god components, 2026-09-17) — LA FICHE
// VITRINE, disponible pour TOUS les types sauf evento (qui porte ses deux équivalents dans
// EventoFields.tsx) depuis le 2026-09-08 (spec 30 §3.1). Ces deux champs vivaient dans le bloc
// `isEvento`, ce qui rendait la vitrine impossible ailleurs : le cahier §2e dit pourtant « ce n'est
// PAS réservé aux eventos ». C'est la PRÉSENCE de l'URL qui fait la vitrine, jamais le type — et
// jamais `sellable = false`, qui rendrait le produit invisible ET retirerait son établissement du
// public.
export function VitrineFields({ state }: { state: ProductTypeFieldsState }) {
  return (
    <>
      <TextField
        fullWidth
        name="external-booking-url"
        value={state.externalBookingUrl}
        onChange={state.setExternalBookingUrl}
      >
        <Label>Enlace de reserva externo — opcional</Label>
        <Input type="url" placeholder="https://…" data-testid="external-booking-url-input" />
      </TextField>

      {/* Le prix en texte libre n'a de sens qu'AVEC une URL externe : sans elle, le produit est
          réservable et porte un prix chiffré. Affiché à la demande plutôt que toujours, pour ne
          pas suggérer deux façons concurrentes de saisir un prix. */}
      {state.externalBookingUrl.trim() ? (
        <TextField
          fullWidth
          name="price-label"
          value={state.priceLabel}
          onChange={state.setPriceLabel}
        >
          <Label>Precio (texto libre) — opcional, sustituye al precio en COP</Label>
          <Input
            placeholder="Ej. Consultar, Desde $50.000 COP…"
            data-testid="price-label-vitrina-input"
          />
        </TextField>
      ) : null}
    </>
  );
}
