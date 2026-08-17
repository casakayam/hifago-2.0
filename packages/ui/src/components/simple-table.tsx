"use client";

import * as React from "react";

import { cn } from "../lib/utils";

/**
 * Primitives HTML `<table>` simples, non pilotées par HeroUI — cible de rendu pour un moteur
 * headless externe (TanStack Table). Ne pas utiliser pour un tableau d'affichage simple : le
 * composant `Table` de `@heroui/react` (réexporté par ce package) gère déjà tri/sélection/a11y
 * nativement pour ce cas.
 *
 * Reflow en cartes sous `md` (768px) — règle transverse non négociable (hifago/CLAUDE.md §2 point
 * 6, `.claude/skills/hifago-ui/SKILL.md`) : un `overflow-x-auto` seul rend scrollable, pas lisible.
 * Chaque `<tr>` devient un bloc carte, chaque `<td>` une ligne « libellé : valeur » via
 * `data-label` (posé par l'appelant, ex. `DataList` avec `col.header`) + `::before`. `data-label`
 * absent/vide ⇒ pas de libellé affiché (cas de la colonne actions, header vide) — dégrade proprement
 * pour tout usage direct de `SimpleTable` qui ne poserait pas encore `data-label` (ex.
 * `/partner/commissions`, pas encore migré sur `DataList`).
 */

function SimpleTable({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <div data-slot="table-container" className="relative w-full overflow-x-auto">
      <table
        data-slot="table"
        className={cn("w-full caption-bottom text-sm max-md:block", className)}
        {...props}
      />
    </div>
  );
}

function SimpleTableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      className={cn(
        "max-md:hidden md:[&_tr]:border-b-[length:var(--border-width)] md:[&_tr]:border-border",
        className
      )}
      {...props}
    />
  );
}

function SimpleTableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("max-md:block md:[&_tr:last-child]:border-0", className)}
      {...props}
    />
  );
}

function SimpleTableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "border-border transition-colors hover:bg-surface-secondary data-[state=selected]:bg-surface-secondary",
        "md:border-b-[length:var(--border-width)]",
        "max-md:mb-3 max-md:block max-md:rounded-md max-md:border max-md:border-border max-md:p-3 max-md:last:mb-0",
        className
      )}
      {...props}
    />
  );
}

function SimpleTableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        "h-10 px-2 text-left align-middle font-medium whitespace-nowrap text-foreground [&:has([role=checkbox])]:pr-0",
        className
      )}
      {...props}
    />
  );
}

function SimpleTableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        "p-2 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0",
        "max-md:flex max-md:items-center max-md:justify-between max-md:gap-3 max-md:whitespace-normal max-md:border-0 max-md:p-1.5",
        "max-md:before:shrink-0 max-md:before:font-medium max-md:before:text-foreground max-md:before:content-[attr(data-label)]",
        className
      )}
      {...props}
    />
  );
}

export {
  SimpleTable,
  SimpleTableHeader,
  SimpleTableBody,
  SimpleTableRow,
  SimpleTableHead,
  SimpleTableCell,
};
