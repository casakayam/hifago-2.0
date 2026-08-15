"use client";

import Link from "next/link";
import { asLocalizedField, resolveLocalizedField, formatCop } from "@hifago/domain";
import { buttonVariants, Table } from "@hifago/ui";

type ProductRow = {
  id: string;
  name: unknown;
  price_cop: number | null;
  category: string | null;
  sellable: boolean;
};

// Composant client dédié : Table.Body/Table.Content de HeroUI attendent des enfants sous forme de
// fonction (render prop) — non sérialisable à travers la frontière Server→Client Component.
export function ProductsTable({ products }: { products: ProductRow[] }) {
  return (
    <Table>
      <Table.ScrollContainer>
        <Table.Content aria-label="Mis actividades">
          <Table.Header>
            <Table.Column isRowHeader>Nombre</Table.Column>
            <Table.Column>Precio</Table.Column>
            <Table.Column>Categoría</Table.Column>
            <Table.Column>Estado</Table.Column>
            <Table.Column id="actions" />
          </Table.Header>
          <Table.Body
            items={products}
            renderEmptyState={() => (
              <p className="py-4 text-center text-sm text-muted">Ninguna actividad todavía.</p>
            )}
          >
            {(product) => (
              <Table.Row id={product.id} data-testid={`product-row-${product.id}`}>
                <Table.Cell>
                  {resolveLocalizedField(asLocalizedField(product.name), "es") ?? product.id}
                </Table.Cell>
                <Table.Cell>{product.price_cop === null ? "—" : formatCop(product.price_cop)}</Table.Cell>
                <Table.Cell>{product.category ?? "—"}</Table.Cell>
                <Table.Cell>{product.sellable ? "Publicada" : "No publicada"}</Table.Cell>
                <Table.Cell>
                  <div className="flex gap-2">
                    <Link
                      href={`/partner/products/${product.id}/edit`}
                      className={buttonVariants({ variant: "outline", size: "sm" })}
                      data-testid={`edit-link-${product.id}`}
                    >
                      Proponer edición
                    </Link>
                    {/* Écriture directe (feature 17) : à la différence de "Proponer edición" (une
                        proposition soumise à modération), gérer son propre calendrier de cupos
                        appartient au socio par nature (cahier des charges socio §3d), pas de
                        passage par une proposition ici. */}
                    <Link
                      href={`/partner/products/${product.id}/availability`}
                      className={buttonVariants({ variant: "outline", size: "sm" })}
                      data-testid={`availability-link-${product.id}`}
                    >
                      Calendario
                    </Link>
                  </div>
                </Table.Cell>
              </Table.Row>
            )}
          </Table.Body>
        </Table.Content>
      </Table.ScrollContainer>
    </Table>
  );
}
