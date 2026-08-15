import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@hifago/supabase/server";
import { asLocalizedField, resolveLocalizedField } from "@hifago/domain";
import { AvailabilityCalendar } from "@/components/availability-calendar";
import { Table } from "@hifago/ui";

type BlockQueryRow = {
  id: string;
  start_date: string;
  end_date: string;
  order_line: {
    order: { holder_name: string } | null;
    product: { name: unknown } | null;
  } | null;
};

export default async function EstablishmentResourcePage({
  params,
}: PageProps<"/admin/establishments/[id]/resource">) {
  const { id } = await params;
  const supabase = await createClient();

  // RLS (establishments_select) : l'admin voit n'importe quel établissement.
  const { data: establishment } = await supabase
    .from("establishments")
    .select("id, name")
    .eq("id", id)
    .maybeSingle();

  if (!establishment) {
    notFound();
  }

  // provider_resource_calendar_select_public : lecture publique, comme product_availability —
  // aucun filtre admin nécessaire ici, RPC-only seulement en écriture.
  // availability_blocks_select_admin : lecture admin seule (« voir la cause du blocage », admin
  // §3c) — jamais publique, révélerait des données de commande.
  const [{ data: availability }, { data: blocks }] = await Promise.all([
    supabase
      .from("provider_resource_calendar")
      .select("slot_date, capacity, booked")
      .eq("establishment_id", id),
    supabase
      .from("availability_blocks")
      .select(
        `id, start_date, end_date,
         order_line:order_lines(order:orders(holder_name), product:products(name))`
      )
      .eq("establishment_id", id)
      .order("start_date", { ascending: false })
      .returns<BlockQueryRow[]>(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link
          href={`/admin/establishments/${establishment.id}`}
          className="text-sm text-muted hover:underline"
        >
          ← {resolveLocalizedField(asLocalizedField(establishment.name), "es") ?? establishment.id}
        </Link>
        <h1 className="text-2xl font-semibold">Recurso compartido del establecimiento</h1>
        <p className="text-sm text-muted">
          Capacidad de la ressource compartida entre campamentos/eventos reservables de este
          establecimiento — distinta de la capacidad propia de cada actividad.
        </p>
      </div>

      <AvailabilityCalendar
        entityId={establishment.id}
        mode="resource"
        availability={(availability ?? []).map((row) => ({
          date: row.slot_date,
          capacity: row.capacity,
          booked: row.booked,
        }))}
      />

      <div className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Causa de los bloqueos</h2>
        <Table data-testid="availability-blocks-table">
          <Table.ScrollContainer>
            <Table.Content aria-label="Causa de los bloqueos">
              <Table.Header>
                <Table.Column isRowHeader>Plaza</Table.Column>
                <Table.Column>Campamento</Table.Column>
                <Table.Column>Titular</Table.Column>
              </Table.Header>
              <Table.Body>
                {blocks && blocks.length > 0 ? (
                  blocks.map((block) => (
                    <Table.Row key={block.id} data-testid={`availability-block-row-${block.id}`}>
                      <Table.Cell>
                        {block.start_date} → {block.end_date}
                      </Table.Cell>
                      <Table.Cell>
                        {resolveLocalizedField(asLocalizedField(block.order_line?.product?.name), "es") ??
                          "—"}
                      </Table.Cell>
                      <Table.Cell>{block.order_line?.order?.holder_name ?? "—"}</Table.Cell>
                    </Table.Row>
                  ))
                ) : (
                  <Table.Row>
                    <Table.Cell colSpan={3} className="text-center text-muted">
                      Ningún bloqueo todavía.
                    </Table.Cell>
                  </Table.Row>
                )}
              </Table.Body>
            </Table.Content>
          </Table.ScrollContainer>
        </Table>
      </div>
    </div>
  );
}
