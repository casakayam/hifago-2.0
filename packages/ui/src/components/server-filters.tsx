"use client";

import * as React from "react";
import { buttonVariants, Input, Label, ListBox, Select } from "@heroui/react";
import type { DataListFilter } from "./data-list";

/**
 * docs/specs/10-listes-standardisees-admin-socio.md §5.1 — un seul `<form method="GET">` par
 * liste, idiome déjà en place sur campaigns/clients/products (recherche texte non contrôlée par
 * React, soumission = navigation). `"use client"` : le filtre `select` embarque `Select` HeroUI,
 * qui ouvre un popover interactif (react-aria) — il ne peut pas être un Server Component, même si
 * la soumission elle-même reste un GET natif sans JS.
 */
export type ServerFiltersProps = {
  basePath: string;
  filters: DataListFilter[]; // réutilise le type de data-list.tsx
  values?: Record<string, string>;
  hiddenParams?: Record<string, string>; // ex. { sort, dir } à préserver — jamais "page"
};

export function ServerFilters({ basePath, filters, values, hiddenParams }: ServerFiltersProps): React.ReactElement {
  return (
    <form
      method="GET"
      action={basePath}
      className="flex flex-wrap items-end gap-4"
      data-testid="server-filters-form"
    >
      {filters.map((filter) => {
        const currentValue = values?.[filter.name] ?? "";

        if (filter.kind === "text" || filter.kind === "date") {
          return (
            <div key={filter.name} className="flex flex-col gap-1.5">
              <Label htmlFor={filter.name}>{filter.label}</Label>
              <Input
                id={filter.name}
                name={filter.name}
                type={filter.kind === "date" ? "date" : undefined}
                placeholder={filter.kind === "text" ? filter.placeholder : undefined}
                defaultValue={currentValue}
                data-testid={`filter-${filter.name}`}
              />
            </div>
          );
        }

        // "select" — piège hifago/CLAUDE.md §11.2/§11.3 : le trigger HeroUI v3 est role="button"
        // (jamais combobox), et le <select> natif caché affiche TOUJOURS le texte de toutes les
        // options, sélectionnée ou non — un test qui matche sur du texte ambigu se trompe. Ici on
        // reste sur les props HeroUI standard : `name` (soumission du <select> caché au form GET)
        // + `defaultSelectedKey` (non contrôlé — pas de value/onChange, cette liste est pilotée
        // par l'URL, pas par un état React).
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
      })}

      {Object.entries(hiddenParams ?? {}).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}

      <button
        type="submit"
        className={buttonVariants()}
        data-testid="server-filters-submit"
      >
        Buscar
      </button>
    </form>
  );
}
