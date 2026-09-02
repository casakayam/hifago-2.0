"use client";

import { Label, ListBox, Select as HeroUISelect } from "@hifago/ui";
import { FieldMessages, FIELD_MIN_HEIGHT, FIELD_WIDTH_CLASSES, sousId, type FieldWidth } from "./Field";

// La liste déroulante de la vitrine (2026-09-02, vague 3).
//
// ⚠️ C'est le composant le plus rentable du lot. Le filtre par type du catalogue
// (`CatalogBrowser.tsx:58-80`) occupe QUINZE lignes de JSX : `Select` + `Select.Trigger` +
// `Select.Value` + `Select.Indicator` + `Select.Popover` + `ListBox` + `ListBox.Item` +
// `ListBox.ItemIndicator`, plus l'entrée « toutes » écrite à la main. C'est l'API compound de
// HeroUI — puissante, et recopiée à l'identique par quiconque ajoutera une deuxième liste. Ici :
// une liste d'options et une valeur.
//
// ⚠️ L'option « toutes » est une PROP, pas une affaire d'appelant. Le catalogue la fabrique
// aujourd'hui avec une entrée de valeur vide ; laisser chaque écran la réinventer, c'est garantir
// qu'un jour l'un d'eux l'oubliera ou la nommera autrement. `allLabel` absent = pas d'entrée.
//
// ⚠️ Le motif `selectedKey={value || null}` et le rendu explicite de `Select.Value` sont repris
// tels quels du catalogue, et ce n'est pas de la copie paresseuse : react-aria ne considère jamais
// une clé vide comme « sélectionnée », donc sans ces deux gestes le déclencheur afficherait un
// blanc au lieu du libellé « toutes ». Le comportement est prouvé en production depuis la feature
// catalogue.
//
// `"use client"` obligatoire (barrel @hifago/ui, CLAUDE.md §11.16).
export type SelectOption = {
  value: string;
  /** Libellé déjà traduit — un atome ne traduit rien. */
  label: string;
};

export type SelectProps = {
  /** Libellé du champ, déjà traduit. */
  label: string;
  options: SelectOption[];
  /** Valeur sélectionnée. La chaîne vide vaut « aucune », donc « toutes » quand `allLabel` existe. */
  value: string;
  onChange: (value: string) => void;
  /**
   * Libellé de l'entrée « toutes », déjà traduit. Fourni, une entrée de valeur vide ouvre la
   * liste ; absent, le choix est obligatoire parmi `options`.
   */
  allLabel?: string;
  name?: string;
  width?: FieldWidth;
  isRequired?: boolean;
  isDisabled?: boolean;
  /** Message d'erreur déjà traduit. Sa seule présence rend le champ invalide. */
  error?: string;
  /** Texte d'aide déjà traduit. HeroUI le masque quand le champ est en erreur. */
  hint?: string;
  testId?: string;
};

export function Select({
  label,
  options,
  value,
  onChange,
  allLabel,
  name,
  width = "full",
  isRequired,
  isDisabled,
  error,
  hint,
  testId,
}: SelectProps) {
  const libelleSelectionne = options.find((option) => option.value === value)?.label ?? allLabel ?? "";

  return (
    <HeroUISelect
      className={FIELD_WIDTH_CLASSES[width]}
      name={name}
      // `|| null` : voir l'en-tête — react-aria n'accepte pas la chaîne vide comme sélection.
      selectedKey={value || null}
      onSelectionChange={(key) => onChange(key === null ? "" : String(key))}
      isRequired={isRequired}
      isDisabled={isDisabled}
      isInvalid={Boolean(error)}
      // Même raison que sur `Field` (CLAUDE.md §11 point 11).
      validationBehavior="aria"
      data-testid={testId}
    >
      <Label>{label}</Label>
      <HeroUISelect.Trigger
        className={FIELD_MIN_HEIGHT}
        data-testid={sousId(testId, "trigger")}
      >
        {/* ⚠️ Contenu explicite : sans lui, une valeur vide n'afficherait rien du tout. C'est aussi
            le seul nœud sur lequel un test peut s'appuyer — le <select> natif caché de HeroUI
            contient le texte de TOUTES les options, sélectionnées ou non (CLAUDE.md §11 point 3). */}
        <HeroUISelect.Value>{libelleSelectionne}</HeroUISelect.Value>
        <HeroUISelect.Indicator />
      </HeroUISelect.Trigger>
      <HeroUISelect.Popover>
        <ListBox>
          {allLabel ? (
            <ListBox.Item id="" textValue={allLabel}>
              {allLabel}
              <ListBox.ItemIndicator />
            </ListBox.Item>
          ) : null}
          {options.map((option) => (
            <ListBox.Item key={option.value} id={option.value} textValue={option.label}>
              {option.label}
              <ListBox.ItemIndicator />
            </ListBox.Item>
          ))}
        </ListBox>
      </HeroUISelect.Popover>
      <FieldMessages hint={hint} error={error} testId={testId} />
    </HeroUISelect>
  );
}
