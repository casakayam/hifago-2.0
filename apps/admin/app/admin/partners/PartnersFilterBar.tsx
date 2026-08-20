"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Input, Label, ListBox, Select, buttonVariants, toast } from "@hifago/ui";
import { geocodeAddress } from "@/components/address-autocomplete";
import {
  PARTNERS_FILTERS,
  PARTNER_RADIUS_KM_OPTIONS,
  PARTNER_DEFAULT_RADIUS_KM,
} from "@/lib/lists/filters";

export type PartnersFilterBarProps = {
  values: Record<string, string>;
  hiddenParams?: Record<string, string>;
};

// Revue admin partenaires (Jérôme, 2026-08-19) — remplace ServerFilters (packages/ui) pour cette
// liste UNIQUEMENT : le géocodage de "Buscar ubicación" est asynchrone (appel Google avant de
// naviguer), incompatible avec la soumission GET native synchrone que ServerFilters suppose pour
// toutes les autres listes du projet — jamais touché packages/ui (design system générique HeroUI
// seul) pour un besoin propre à cet unique écran. Reprend visuellement PARTNERS_FILTERS
// (q/status/role/city, même rendu par kind que ServerFilters) puis ajoute "Buscar ubicación" +
// le rayon. Un géocodage manqué (adresse introuvable, script Google indisponible) ne bloque
// jamais les autres filtres : seul un toast prévient, la recherche part quand même sans lat/lon.
export function PartnersFilterBar({ values, hiddenParams }: PartnersFilterBarProps) {
  const router = useRouter();
  const [isSearching, setIsSearching] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSearching(true);

    const formData = new FormData(event.currentTarget);
    const params = new URLSearchParams();

    for (const filter of PARTNERS_FILTERS) {
      const value = String(formData.get(filter.name) ?? "").trim();
      if (value) params.set(filter.name, value);
    }
    for (const [name, value] of Object.entries(hiddenParams ?? {})) {
      params.set(name, value);
    }

    const locationQuery = String(formData.get("location_q") ?? "").trim();
    if (locationQuery) {
      const result = await geocodeAddress(locationQuery);
      if (result) {
        params.set("lat", String(result.lat));
        params.set("lon", String(result.lon));
        params.set("radius_km", String(formData.get("radius_km") ?? PARTNER_DEFAULT_RADIUS_KM));
        params.set("location_label", locationQuery);
      } else {
        toast.danger("No se pudo ubicar esa dirección.");
      }
    }

    setIsSearching(false);
    router.push(`/admin/partners?${params.toString()}`);
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-wrap items-end gap-4"
      data-testid="partners-filter-bar"
    >
      {PARTNERS_FILTERS.map((filter) => {
        const currentValue = values[filter.name] ?? "";

        if (filter.kind === "text") {
          return (
            <div key={filter.name} className="flex flex-col gap-1.5">
              <Label htmlFor={filter.name}>{filter.label}</Label>
              <Input
                id={filter.name}
                name={filter.name}
                placeholder={filter.placeholder}
                defaultValue={currentValue}
                data-testid={`filter-${filter.name}`}
              />
            </div>
          );
        }

        if (filter.kind === "select") {
          return (
            <div key={filter.name} className="flex flex-col gap-1.5">
              <Select name={filter.name} defaultSelectedKey={currentValue}>
                <Label>{filter.label}</Label>
                <Select.Trigger data-testid={`filter-${filter.name}`}>
                  <Select.Value />
                  <Select.Indicator />
                </Select.Trigger>
                <Select.Popover>
                  <ListBox>
                    <ListBox.Item id="" textValue={filter.allLabel}>
                      {filter.allLabel}
                      <ListBox.ItemIndicator />
                    </ListBox.Item>
                    {filter.options.map((option) => (
                      <ListBox.Item key={option.value} id={option.value} textValue={option.label}>
                        {option.label}
                        <ListBox.ItemIndicator />
                      </ListBox.Item>
                    ))}
                  </ListBox>
                </Select.Popover>
              </Select>
            </div>
          );
        }

        return null;
      })}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="location_q">Buscar ubicación</Label>
        <Input
          id="location_q"
          name="location_q"
          placeholder="Dirección, barrio, ciudad…"
          defaultValue={values.location_label ?? ""}
          data-testid="filter-location_q"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Select name="radius_km" defaultSelectedKey={values.radius_km || PARTNER_DEFAULT_RADIUS_KM}>
          <Label>Radio</Label>
          <Select.Trigger data-testid="filter-radius_km">
            <Select.Value />
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover>
            <ListBox>
              {PARTNER_RADIUS_KM_OPTIONS.map((km) => (
                <ListBox.Item key={km} id={km} textValue={`${km} km`}>
                  {km} km
                  <ListBox.ItemIndicator />
                </ListBox.Item>
              ))}
            </ListBox>
          </Select.Popover>
        </Select>
      </div>

      <button
        type="submit"
        className={buttonVariants()}
        disabled={isSearching}
        data-testid="server-filters-submit"
      >
        {isSearching ? "Buscando…" : "Buscar"}
      </button>
    </form>
  );
}
