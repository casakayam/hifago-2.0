"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Input, Label, ListBox, Select, buttonVariants } from "@hifago/ui";
import { SearchableCombobox } from "@/components/searchable-combobox";
import { STATUS_LABELS } from "@/app/admin/orders/statusLabels";

export type ReservationProductOption = { id: string; name: string };

export type ReservationsFilterBarProps = {
  values: Record<string, string>;
  hiddenParams?: Record<string, string>;
  products: ReservationProductOption[];
};

// Retour Jérôme (2026-08-20) — remplace RESERVATIONS_FILTERS/ServerFilters générique : "Actividad"
// a besoin d'un combobox avec recherche (SearchableCombobox, même patron que "Partner propietario"
// sur NewEstablishmentForm.tsx), pas juste un texte libre — ServerFilters ne connaît que
// text/select/date. Même raison que PartnersFilterBar.tsx : soumission interceptée en JS
// (router.push) plutôt qu'un <form method="GET"> natif, pour pouvoir injecter product_id (état
// React du combobox, jamais un input natif nommé) aux côtés des champs classiques lus depuis
// FormData.
export function ReservationsFilterBar({ values, hiddenParams, products }: ReservationsFilterBarProps) {
  const router = useRouter();
  const [productId, setProductId] = useState<string | null>(values.product_id ?? null);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const formData = new FormData(event.currentTarget);
    const params = new URLSearchParams();

    const dateFrom = String(formData.get("date_from") ?? "").trim();
    if (dateFrom) params.set("date_from", dateFrom);
    const dateTo = String(formData.get("date_to") ?? "").trim();
    if (dateTo) params.set("date_to", dateTo);
    if (productId) params.set("product_id", productId);
    const holderQ = String(formData.get("holder_q") ?? "").trim();
    if (holderQ) params.set("holder_q", holderQ);
    const status = String(formData.get("status") ?? "").trim();
    if (status) params.set("status", status);

    for (const [name, value] of Object.entries(hiddenParams ?? {})) {
      params.set(name, value);
    }

    router.push(`/partner/reservations?${params.toString()}`);
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-wrap items-end gap-4"
      data-testid="reservations-filter-bar"
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="date_from">Desde</Label>
        <Input
          id="date_from"
          name="date_from"
          type="date"
          defaultValue={values.date_from ?? ""}
          data-testid="filter-date_from"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="date_to">Hasta</Label>
        <Input
          id="date_to"
          name="date_to"
          type="date"
          defaultValue={values.date_to ?? ""}
          data-testid="filter-date_to"
        />
      </div>

      <div className="w-56">
        <SearchableCombobox
          items={products}
          getKey={(product) => product.id}
          getLabel={(product) => product.name}
          value={productId}
          onChange={setProductId}
          label="Actividad"
          placeholder="Buscar actividad…"
          testId="filter-product_id"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="holder_q">Cliente o email</Label>
        <Input
          id="holder_q"
          name="holder_q"
          placeholder="Nombre o email del cliente"
          defaultValue={values.holder_q ?? ""}
          data-testid="filter-holder_q"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Select name="status" defaultSelectedKey={values.status ?? ""}>
          <Label>Estado</Label>
          <Select.Trigger data-testid="filter-status">
            <Select.Value />
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover>
            <ListBox>
              <ListBox.Item id="" textValue="Todos los estados">
                Todos los estados
                <ListBox.ItemIndicator />
              </ListBox.Item>
              {Object.entries(STATUS_LABELS).map(([value, label]) => (
                <ListBox.Item key={value} id={value} textValue={label}>
                  {label}
                  <ListBox.ItemIndicator />
                </ListBox.Item>
              ))}
            </ListBox>
          </Select.Popover>
        </Select>
      </div>

      <button type="submit" className={buttonVariants()} data-testid="server-filters-submit">
        Buscar
      </button>
    </form>
  );
}
