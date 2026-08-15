import { createClient } from "@hifago/supabase/server";
import { asLocalizedField, resolveLocalizedField } from "@hifago/domain";
import { Table } from "@hifago/ui";
import { NewTagForm } from "./NewTagForm";
import { DeleteTagButton } from "./DeleteTagButton";
import { RenameTagButton } from "./RenameTagButton";

// docs/specs/08-admin-gestion-activite.md §5 — catalogue de tags, remplace la catégorie fixe
// (products.category) côté écran admin direct. Volume attendu en dizaines : pas de
// ServerPagination ici, contrairement à /admin/products.
export default async function AdminTagsPage() {
  const supabase = await createClient();
  const { data: tags } = await supabase
    .from("catalog_tags")
    .select("id, label, slug, product_tag_assignments(count)")
    .order("slug", { ascending: true });

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Etiquetas</h1>

      <NewTagForm />

      <Table>
        <Table.ScrollContainer>
          <Table.Content aria-label="Etiquetas">
            <Table.Header>
              <Table.Column isRowHeader>Etiqueta</Table.Column>
              <Table.Column>Actividades</Table.Column>
              <Table.Column></Table.Column>
            </Table.Header>
            <Table.Body>
              {tags && tags.length > 0 ? (
                tags.map((tag) => {
                  const label = resolveLocalizedField(asLocalizedField(tag.label), "es") ?? tag.slug;
                  const usageCount = tag.product_tag_assignments[0]?.count ?? 0;
                  return (
                    <Table.Row key={tag.id} data-testid={`tag-row-${tag.id}`}>
                      <Table.Cell>{label}</Table.Cell>
                      <Table.Cell>{usageCount}</Table.Cell>
                      <Table.Cell>
                        <div className="flex gap-4">
                          <RenameTagButton tagId={tag.id} currentLabel={label} />
                          <DeleteTagButton tagId={tag.id} label={label} usageCount={usageCount} />
                        </div>
                      </Table.Cell>
                    </Table.Row>
                  );
                })
              ) : (
                <Table.Row>
                  <Table.Cell colSpan={3} className="text-center text-muted">
                    Ninguna etiqueta todavía.
                  </Table.Cell>
                </Table.Row>
              )}
            </Table.Body>
          </Table.Content>
        </Table.ScrollContainer>
      </Table>
    </div>
  );
}
