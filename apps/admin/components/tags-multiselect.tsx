"use client";

import { useMemo, useState } from "react";
import type { Key } from "react";
import { ComboBox, Input, Label, ListBox, Tag, TagGroup, toast } from "@hifago/ui";
import { createClient } from "@hifago/supabase/client";
import { slugify } from "@/lib/utils";

export type TagOption = { id: string; label: string };

const CREATE_TAG_KEY = "__create_tag__";

// Multi-sélection ET création à la volée : searchable-combobox.tsx (recherche partenaire/
// établissement, spec 03) est mono-sélection sur un catalogue déjà complet, un besoin différent —
// ici l'admin doit pouvoir créer un tag qui n'existe pas encore sans quitter le formulaire produit
// (retour Jérôme 2026-08-15, plutôt que de le renvoyer vers /admin/tags d'abord). Ajout d'un tag
// existant via ComboBox (recherche client-side, piège CLAUDE.md §11.7 : taper une requête avant de
// cliquer), retrait via TagGroup/Tag (react-aria, jamais utilisés ailleurs dans le projet avant
// cette spec — API vérifiée dans les .d.ts).
export function TagsMultiSelect({
  availableTags,
  selectedTagIds,
  onChange,
  label = "Etiquetas",
  testId = "tags-multiselect",
  emptyMessage = "Ningún tag disponible.",
  // false pour le variant socio-proposal de ProductForm (spec 15) : catalog_tags reste en
  // écriture admin-only (RLS), un socio qui déclencherait handleCreateTag échouerait
  // silencieusement — retirer l'affordance "+ Crear…" plutôt que de montrer un geste qui échoue.
  allowCreate = true,
}: {
  availableTags: TagOption[];
  selectedTagIds: string[];
  onChange: (ids: string[]) => void;
  label?: string;
  testId?: string;
  emptyMessage?: string;
  allowCreate?: boolean;
}) {
  const [query, setQuery] = useState("");
  // Tags créés depuis ce composant pendant sa durée de vie — le parent (Server Component) n'a pas
  // besoin de refetch/rafraîchir pour que le tag nouvellement créé reste sélectionnable ensuite.
  const [localTags, setLocalTags] = useState<TagOption[]>([]);
  const [isCreating, setIsCreating] = useState(false);

  const allTags = useMemo(() => [...availableTags, ...localTags], [availableTags, localTags]);

  const selectedTags = useMemo(
    () =>
      selectedTagIds
        .map((id) => allTags.find((t) => t.id === id))
        .filter((t): t is TagOption => !!t),
    [selectedTagIds, allTags],
  );

  const selectableTags = useMemo(
    () => allTags.filter((t) => !selectedTagIds.includes(t.id)),
    [allTags, selectedTagIds],
  );

  const filtered = useMemo(() => {
    const needle = slugify(query);
    return needle ? selectableTags.filter((t) => slugify(t.label).includes(needle)) : selectableTags;
  }, [selectableTags, query]);

  const trimmedQuery = query.trim();
  const hasExactMatch = trimmedQuery
    ? allTags.some((t) => slugify(t.label) === slugify(trimmedQuery))
    : true;
  const canCreate = allowCreate && trimmedQuery.length > 0 && !hasExactMatch;

  const listItems = canCreate
    ? [...filtered, { id: CREATE_TAG_KEY, label: `+ Crear "${trimmedQuery}"` }]
    : filtered;

  async function handleCreateTag() {
    setIsCreating(true);

    const supabase = createClient();
    const { data: newTag, error: insertError } = await supabase
      .from("catalog_tags")
      .insert({ label: { es: trimmedQuery }, slug: slugify(trimmedQuery) })
      .select("id, label")
      .single();

    setIsCreating(false);

    if (insertError || !newTag) {
      toast.danger(
        insertError?.code === "23505"
          ? "Ya existe una etiqueta con ese nombre."
          : "No se pudo crear la etiqueta.",
      );
      return;
    }

    const created: TagOption = { id: newTag.id, label: trimmedQuery };
    setLocalTags((prev) => [...prev, created]);
    onChange([...selectedTagIds, created.id]);
    setQuery("");
    toast.success("Tag creado.");
  }

  function handleRemove(keys: Set<Key>) {
    const removedIds = new Set(Array.from(keys, String));
    onChange(selectedTagIds.filter((id) => !removedIds.has(id)));
  }

  return (
    <div className="flex flex-col gap-2">
      <ComboBox
        selectedKey={null}
        allowsEmptyCollection
        onSelectionChange={(key) => {
          if (!key) return;
          if (key === CREATE_TAG_KEY) {
            void handleCreateTag();
            return;
          }
          onChange([...selectedTagIds, String(key)]);
          setQuery("");
        }}
        inputValue={query}
        onInputChange={setQuery}
      >
        <Label>{label}</Label>
        <ComboBox.InputGroup>
          <Input placeholder="Buscar o crear un tag…" data-testid={testId} />
          <ComboBox.Trigger />
        </ComboBox.InputGroup>
        <ComboBox.Popover>
          <ListBox
            items={listItems}
            renderEmptyState={() => <p className="p-2 text-sm text-muted">{emptyMessage}</p>}
          >
            {(tag: TagOption) => (
              <ListBox.Item key={tag.id} id={tag.id} textValue={tag.label}>
                {tag.label}
                <ListBox.ItemIndicator />
              </ListBox.Item>
            )}
          </ListBox>
        </ComboBox.Popover>
      </ComboBox>
      {isCreating ? <p className="text-xs text-muted">Creando…</p> : null}
      {selectedTags.length > 0 ? (
        <TagGroup aria-label={label} onRemove={handleRemove} data-testid={`${testId}-selected`}>
          <TagGroup.List items={selectedTags}>
            {(tag: TagOption) => (
              <Tag key={tag.id} id={tag.id} textValue={tag.label}>
                {tag.label}
                <Tag.RemoveButton aria-label={`Quitar ${tag.label}`} />
              </Tag>
            )}
          </TagGroup.List>
        </TagGroup>
      ) : null}
    </div>
  );
}
