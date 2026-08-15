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
  // Initialiseur paresseux (pas useEffect) : ne resynchronise jamais après le montage — une
  // valeur initiale préremplie (docs/specs/05-invitations-onboarding-dashboard-partenaire.md §5.6)
  // doit afficher le libellé correspondant sans empêcher l'utilisateur de retaper librement
  // ensuite (selectedKey seul ne suffit pas : inputValue est contrôlé ici, pas dérivé par ComboBox).
  const [query, setQuery] = useState(() => {
    if (!value) return "";
    const selected = items.find((item) => getKey(item) === value);
    return selected ? getLabel(selected) : "";
  });

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
      onInputChange={setQuery}
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
