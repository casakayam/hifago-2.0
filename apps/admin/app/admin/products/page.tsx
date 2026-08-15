import Link from "next/link";
import { createClient } from "@hifago/supabase/server";
import { asLocalizedField, formatCop, resolveLocalizedField, resolvePageParams } from "@hifago/domain";
import { buttonVariants, Input, Label, ServerPagination, Table } from "@hifago/ui";

// docs/specs/02-admin-accueil-et-navigation.md §5.5 — la liste manquait, seuls
// new/edit/availability existaient (aucune vue neutre du catalogue). Recherche locale (§5.4/§5.5,
// pattern repris du legacy) sur `name->>es` : `products.name` est jsonb multilingue, jamais un
// texte brut — même idiome que le filtre `message_template` de /admin/campaigns.
export default async function AdminProductsPage({
  searchParams,
}: PageProps<"/admin/products">) {
  const resolvedSearchParams = await searchParams;
  const searchParam = resolvedSearchParams?.q;
  const search = typeof searchParam === "string" && searchParam.trim() ? searchParam.trim() : null;
  const { page, pageSize, from, to } = resolvePageParams(resolvedSearchParams);

  const supabase = await createClient();
  let query = supabase
    .from("products")
    .select("id, name, type, price_cop, sellable, establishments(name)", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, to);
  if (search) {
    query = query.ilike("name->>es", `%${search}%`);
  }
  const { data: products, count } = await query;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Catálogo</h1>

      <form method="GET" className="flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="q">Buscar por nombre</Label>
          <Input id="q" name="q" defaultValue={search ?? ""} data-testid="products-search-input" />
        </div>
        <button
          type="submit"
          className="rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-surface-secondary"
          data-testid="products-search-submit"
        >
          Buscar
        </button>
      </form>

      <Table>
        <Table.ScrollContainer>
          <Table.Content aria-label="Catálogo">
            <Table.Header>
              <Table.Column isRowHeader>Nombre</Table.Column>
              <Table.Column>Establecimiento</Table.Column>
              <Table.Column>Tipo</Table.Column>
              <Table.Column>Precio</Table.Column>
              <Table.Column>Estado</Table.Column>
              <Table.Column></Table.Column>
            </Table.Header>
            <Table.Body>
              {products && products.length > 0 ? (
                products.map((product) => (
                  <Table.Row key={product.id} data-testid={`product-row-${product.id}`}>
                    <Table.Cell>
                      {resolveLocalizedField(asLocalizedField(product.name), "es") ?? product.id}
                    </Table.Cell>
                    <Table.Cell>
                      {resolveLocalizedField(asLocalizedField(product.establishments?.name), "es") ?? "—"}
                    </Table.Cell>
                    <Table.Cell>{product.type}</Table.Cell>
                    <Table.Cell>{formatCop(product.price_cop ?? 0)}</Table.Cell>
                    <Table.Cell>{product.sellable ? "Publicado" : "Borrador"}</Table.Cell>
                    <Table.Cell>
                      <div className="flex gap-2">
                        <Link
                          href={`/admin/products/${product.id}`}
                          className={buttonVariants({ variant: "outline", size: "sm" })}
                          data-testid={`product-detail-link-${product.id}`}
                        >
                          Ver
                        </Link>
                        <Link
                          href={`/admin/products/${product.id}/edit`}
                          className={buttonVariants({ variant: "outline", size: "sm" })}
                          data-testid={`product-edit-link-${product.id}`}
                        >
                          Editar
                        </Link>
                      </div>
                    </Table.Cell>
                  </Table.Row>
                ))
              ) : (
                <Table.Row>
                  <Table.Cell colSpan={6} className="text-center text-muted">
                    Ningún producto todavía.
                  </Table.Cell>
                </Table.Row>
              )}
            </Table.Body>
          </Table.Content>
        </Table.ScrollContainer>
      </Table>

      <ServerPagination
        page={page}
        pageSize={pageSize}
        totalCount={count ?? 0}
        basePath="/admin/products"
        extraParams={search ? { q: search } : undefined}
      />
    </div>
  );
}
