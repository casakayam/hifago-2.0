import { createClient } from "@hifago/supabase/server";
import { resolvePageParams } from "@hifago/domain";
import { Input, Label, ServerPagination, Table } from "@hifago/ui";

// docs/specs/02-admin-accueil-et-navigation.md §5.3 — construite sur orders dédupliquées (RPC
// list_clients), pas sur auth.users/partner_accounts (exclurait tout client invité). "Nom
// complet" seul, jamais prénom/nom séparés (constat 2 de la spec : orders.holder_name est un
// texte libre unique). Filtre texte (nom+email combinés dans le champ de recherche local, pattern
// legacy) + filtre séparé par email, pagination serveur.
export default async function AdminClientsPage({
  searchParams,
}: PageProps<"/admin/clients">) {
  const resolvedSearchParams = await searchParams;
  const searchParam = resolvedSearchParams?.q;
  const emailParam = resolvedSearchParams?.email;
  const search = typeof searchParam === "string" && searchParam.trim() ? searchParam.trim() : null;
  const email = typeof emailParam === "string" && emailParam.trim() ? emailParam.trim() : null;

  const { page, pageSize, from } = resolvePageParams(resolvedSearchParams);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_clients", {
    p_search: search ?? undefined,
    p_email: email ?? undefined,
    p_limit: pageSize,
    p_offset: from,
  });

  const clients = error ? [] : (data ?? []);
  const totalCount = clients[0]?.total_count ?? 0;

  const extraParams: Record<string, string> = {};
  if (search) extraParams.q = search;
  if (email) extraParams.email = email;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Clientes</h1>

      <form method="GET" className="flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="q">Buscar por nombre o email</Label>
          <Input id="q" name="q" defaultValue={search ?? ""} data-testid="clients-search-input" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="email">Filtrar por email</Label>
          <Input id="email" name="email" type="email" defaultValue={email ?? ""} data-testid="clients-email-input" />
        </div>
        <button
          type="submit"
          className="rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-surface-secondary"
          data-testid="clients-search-submit"
        >
          Buscar
        </button>
      </form>

      <Table>
        <Table.ScrollContainer>
          <Table.Content aria-label="Clientes">
            <Table.Header>
              <Table.Column isRowHeader>Nombre</Table.Column>
              <Table.Column>Email</Table.Column>
              <Table.Column>Teléfono</Table.Column>
              <Table.Column>Pedidos</Table.Column>
              <Table.Column>Último pedido</Table.Column>
            </Table.Header>
            <Table.Body>
              {clients.length > 0 ? (
                clients.map((client) => (
                  <Table.Row key={client.client_key} data-testid={`client-row-${client.client_key}`}>
                    <Table.Cell>{client.display_name}</Table.Cell>
                    <Table.Cell>{client.email ?? "—"}</Table.Cell>
                    <Table.Cell>{client.phone ?? "—"}</Table.Cell>
                    <Table.Cell>{client.orders_count}</Table.Cell>
                    <Table.Cell>
                      {client.last_order_at ? new Date(client.last_order_at).toLocaleDateString("es") : "—"}
                    </Table.Cell>
                  </Table.Row>
                ))
              ) : (
                <Table.Row>
                  <Table.Cell colSpan={5} className="text-center text-muted">
                    Ningún cliente encontrado.
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
        totalCount={totalCount}
        basePath="/admin/clients"
        extraParams={extraParams}
      />
    </div>
  );
}
