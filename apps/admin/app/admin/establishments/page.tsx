import Link from "next/link";
import { createClient } from "@hifago/supabase/server";
import { asLocalizedField, resolveLocalizedField, resolvePageParams } from "@hifago/domain";
import { Table, ServerPagination, buttonVariants } from "@hifago/ui";

export default async function AdminEstablishmentsPage({
  searchParams,
}: PageProps<"/admin/establishments">) {
  const resolvedSearchParams = await searchParams;
  const { page, pageSize, from, to } = resolvePageParams(resolvedSearchParams);

  const supabase = await createClient();

  // RLS (establishments_select) : l'admin voit tous les établissements, pas seulement les siens.
  // products(count) : agrégation embarquée PostgREST sur la FK products.establishment_id (feature
  // 2) — un compteur, pas une vraie liste produits (hors périmètre de cette feature, cf. plan).
  // Pagination serveur (G15, spec 02) : .range() + count exact plutôt que tout charger.
  const { data: establishments, count } = await supabase
    .from("establishments")
    .select("id, name, status, partner:partners(display_name), products(count)", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, to);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Establecimientos</h1>
        <Link href="/admin/establishments/new" className={buttonVariants()}>
          Nuevo establecimiento
        </Link>
      </div>

      <Table>
        <Table.ScrollContainer>
          <Table.Content aria-label="Establecimientos">
            <Table.Header>
              <Table.Column isRowHeader>Nombre</Table.Column>
              <Table.Column>Partner</Table.Column>
              <Table.Column>Estado</Table.Column>
              <Table.Column>Actividades</Table.Column>
              <Table.Column></Table.Column>
            </Table.Header>
            <Table.Body>
              {establishments && establishments.length > 0 ? (
                establishments.map((establishment) => (
                  <Table.Row key={establishment.id}>
                    <Table.Cell>
                      {resolveLocalizedField(asLocalizedField(establishment.name), "es") ??
                        establishment.id}
                    </Table.Cell>
                    <Table.Cell>{establishment.partner?.display_name ?? "—"}</Table.Cell>
                    <Table.Cell>{establishment.status}</Table.Cell>
                    <Table.Cell>
                      <Link
                        href={`/admin/establishments/${establishment.id}`}
                        className="hover:underline"
                        data-testid={`activity-count-${establishment.id}`}
                      >
                        {establishment.products?.[0]?.count ?? 0} actividades
                      </Link>
                    </Table.Cell>
                    <Table.Cell>
                      <div className="flex gap-2">
                        <Link
                          href={`/admin/establishments/${establishment.id}`}
                          className={buttonVariants({ variant: "outline", size: "sm" })}
                          data-testid={`edit-establishment-link-${establishment.id}`}
                        >
                          Editar
                        </Link>
                        <Link
                          href={`/admin/products/new?establishment=${establishment.id}`}
                          className={buttonVariants({ variant: "outline", size: "sm" })}
                        >
                          + Actividad
                        </Link>
                        <Link
                          href={`/admin/establishments/${establishment.id}/resource`}
                          className={buttonVariants({ variant: "outline", size: "sm" })}
                          data-testid={`resource-link-${establishment.id}`}
                        >
                          Recurso compartido
                        </Link>
                      </div>
                    </Table.Cell>
                  </Table.Row>
                ))
              ) : (
                <Table.Row>
                  <Table.Cell colSpan={5} className="text-center text-muted">
                    Ningún establecimiento todavía.
                  </Table.Cell>
                </Table.Row>
              )}
            </Table.Body>
          </Table.Content>
        </Table.ScrollContainer>
      </Table>

      <ServerPagination page={page} pageSize={pageSize} totalCount={count ?? 0} basePath="/admin/establishments" />
    </div>
  );
}
