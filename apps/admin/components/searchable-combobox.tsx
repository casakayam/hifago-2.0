"use client";

import { useMemo, useState } from "react";
import { ComboBox, Input, Label, ListBox } from "@hifago/ui";
import { slugify } from "@/lib/utils";

// ComboBox HeroUI (pas Autocomplete) : seul composant de la lib qui est un vrai champ de
// recherche visible en façade plutôt qu'un bouton déclencheur (cf. docs/specs/
// 02-admin-creation-etablissement.md §5). Filtrage 100% client-side sur les données déjà
// chargées par le Server Component parent — pas de requête réseau par frappe, cohérent avec le
// volume actuel (dizaines de partenaires/établissements, pas de pagination sur ces écrans).
export function SearchableCombobox<T extends object>({
  items,
  getKey,
  getLabel,
  value,
  onChange,
  label,
  placeholder = "Buscar…",
  testId,
  renderItem,
  emptyMessage = "Ningún resultado.",
}: {
  items: T[];
  getKey: (item: T) => string;
  getLabel: (item: T) => string;
  value: string | null;
  onChange: (id: string | null) => void;
  label: string;
  placeholder?: string;
  testId: string;
  renderItem?: (item: T) => React.ReactNode;
  emptyMessage?: string;
}) {
  function labelForValue(v: string | null) {
    if (!v) return "";
    const selected = items.find((item) => getKey(item) === v);
    return selected ? getLabel(selected) : "";
  }

  const [query, setQuery] = useState(() => labelForValue(value));

  // Reflète TOUJOURS la sélection réelle (value), jamais seulement la frappe — pattern "ajuster un
  // state pendant le rendu" (react.dev), pas un useEffect : un effect + setState synchrone ajoute
  // un rendu évitable et est bloqué par la règle eslint react-hooks/set-state-in-effect. Ne se
  // déclenche que quand `value` change réellement (une sélection commitée, ou remise à null),
  // jamais pendant la frappe elle-même (query change sans que value change) — donc ne gêne pas la
  // retype libre. Corrige deux symptômes constatés avec le seul état local `query` : cliquer une
  // option sans avoir tapé ne remplissait pas le champ (rien ne synchronisait query après une
  // sélection), et vider le texte au clavier laissait `value` sur l'ancienne sélection, qui
  // revenait au blur (ComboBox restaure l'affichage depuis `selectedKey` quand `inputValue` ne
  // correspond à rien).
  const [syncedValue, setSyncedValue] = useState(value);
  if (value !== syncedValue) {
    setSyncedValue(value);
    setQuery(labelForValue(value));
  }

  const filtered = useMemo(() => {
    const needle = slugify(query);
    if (!needle) return items;
    return items.filter((item) => slugify(getLabel(item)).includes(needle));
  }, [items, query, getLabel]);

  return (
    <ComboBox
      selectedKey={value}
      onSelectionChange={(key) => onChange(key ? String(key) : null)}
      inputValue={query}
      onInputChange={(newQuery) => {
        setQuery(newQuery);
        // Vider le champ doit vider le filtre : sans ce reset, `selectedKey` reste sur l'ancienne
        // sélection pendant que `inputValue` est vide (deux props contrôlées désynchronisées) — au
        // blur, ComboBox restaure le texte de l'ancienne sélection au lieu de rester vide.
        if (newQuery === "" && value !== null) {
          onChange(null);
        }
      }}
    >
      <Label>{label}</Label>
      <ComboBox.InputGroup>
        <Input placeholder={placeholder} data-testid={testId} />
        <ComboBox.Trigger />
      </ComboBox.InputGroup>
      <ComboBox.Popover>
        {/* items= + children-en-fonction (pas .map() statique) : requis pour que
            renderEmptyState détecte une liste filtrée vide, même idiome que Table.Body
            (EstablishmentsSection.tsx) — cf. hifago/CLAUDE.md §2.3. */}
        <ListBox items={filtered} renderEmptyState={() => <p className="p-2 text-sm text-muted">{emptyMessage}</p>}>
          {(item: T) => (
            <ListBox.Item key={getKey(item)} id={getKey(item)} textValue={getLabel(item)}>
              {renderItem ? renderItem(item) : getLabel(item)}
              <ListBox.ItemIndicator />
            </ListBox.Item>
          )}
        </ListBox>
      </ComboBox.Popover>
    </ComboBox>
  );
}
