"use client";

import * as React from "react";

import { cn } from "../lib/utils";

/**
 * Primitives HTML `<table>` simples, non pilotées par HeroUI — cible de rendu pour un moteur
 * headless externe (TanStack Table). Ne pas utiliser pour un tableau d'affichage simple : le
 * composant `Table` de `@heroui/react` (réexporté par ce package) gère déjà tri/sélection/a11y
 * nativement pour ce cas.
 */

function SimpleTable({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <div data-slot="table-container" className="relative w-full overflow-x-auto">
      <table data-slot="table" className={cn("w-full caption-bottom text-sm", className)} {...props} />
    </div>
  );
}

function SimpleTableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return <thead data-slot="table-header" className={cn("[&_tr]:border-b [&_tr]:border-border", className)} {...props} />;
}

function SimpleTableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return <tbody data-slot="table-body" className={cn("[&_tr:last-child]:border-0", className)} {...props} />;
}

function SimpleTableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "border-b border-border transition-colors hover:bg-surface-secondary data-[state=selected]:bg-surface-secondary",
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
      className={cn("p-2 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0", className)}
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
