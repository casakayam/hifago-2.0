"use client";

import Link from "next/link";
import { asLocalizedField, resolveLocalizedField, formatCop } from "@hifago/domain";
import {
  SimpleTable,
  SimpleTableBody,
  SimpleTableCell,
  SimpleTableHead,
  SimpleTableHeader,
  SimpleTableRow,
} from "@hifago/ui";

// Extrait de page.tsx (Server Component) — importer @hifago/ui directement depuis un page.tsx/
// layout.tsx casse la collecte de page data au build ("(0, g.createContext) is not a function",
// constaté empiriquement le 2026-08-20 en ajoutant AppNavShell au barrel) ; même patron que
// LedgerLinesTable.tsx (../orders/[id]) : page.tsx ne fait plus que fetcher et passer les données.

type EstablishmentProduct = {
  id: string;
  name: unknown;
  price_cop: number | null;
  sellable: boolean;
};

export function EstablishmentProductsTable({ products }: { products: EstablishmentProduct[] }) {
  return (
    <SimpleTable aria-label="Actividades del establecimiento">
      <SimpleTableHeader>
        <SimpleTableRow>
          <SimpleTableHead>Nombre</SimpleTableHead>
          <SimpleTableHead>Precio</SimpleTableHead>
          <SimpleTableHead>Estado</SimpleTableHead>
        </SimpleTableRow>
      </SimpleTableHeader>
      <SimpleTableBody>
        {products.length > 0 ? (
          products.map((product) => (
            <SimpleTableRow key={product.id}>
              <SimpleTableCell data-label="Nombre">
                <Link href={`/admin/products/${product.id}/edit`} className="hover:underline">
                  {resolveLocalizedField(asLocalizedField(product.name), "es") ?? product.id}
                </Link>
              </SimpleTableCell>
              <SimpleTableCell data-label="Precio">
                {/* price_cop nullable depuis la feature 21 (evento vitrine, prix en texte
                    libre via price_label) — "—" plutôt qu'un format COP sur null. */}
                {product.price_cop === null ? "—" : formatCop(product.price_cop)}
              </SimpleTableCell>
              <SimpleTableCell data-label="Estado" data-testid={`product-status-${product.id}`}>
                {product.sellable ? "Vendible" : "No vendible"}
              </SimpleTableCell>
            </SimpleTableRow>
          ))
        ) : (
          <SimpleTableRow>
            <SimpleTableCell colSpan={3} className="text-center text-muted">
              Ninguna actividad todavía.
            </SimpleTableCell>
          </SimpleTableRow>
        )}
      </SimpleTableBody>
    </SimpleTable>
  );
}
