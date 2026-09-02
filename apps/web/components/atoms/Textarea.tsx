"use client";

import { Description, ErrorMessage, Label, TextArea, TextField } from "@hifago/ui";
import { FIELD_MIN_HEIGHT, FIELD_WIDTH_CLASSES, type FieldWidth } from "./Field";

// Le champ de saisie multi-lignes (2026-09-02, vague 3).
//
// ⚠️ Contrairement aux trois autres composants de ce lot, celui-ci N'EXTRAIT RIEN : `apps/web` n'a
// aucun textarea aujourd'hui, aucun écran ne l'attend. C'est une demande explicite de Jérôme pour
// compléter le design system — écrit pour être là le jour où un formulaire en aura besoin (un
// message au partenaire, une demande particulière à la réservation), pas pour remplacer du code
// existant. D'où le parti pris : strictement les props de `Field`, plus `rows`, et rien d'autre.
// Toute prop inventée ici serait une anticipation sans usage à laquelle se conformer plus tard.
//
// Il partage la table de largeurs et le plancher de hauteur de `Field` : deux composants qu'un même
// formulaire met côte à côte doivent s'aligner au pixel, et une table recopiée aurait divergé au
// premier ajustement.
//
// `"use client"` obligatoire (barrel @hifago/ui, CLAUDE.md §11.16), comme partout dans ce dossier.
export type TextareaProps = {
  /** Libellé déjà traduit — un atome ne traduit rien. */
  label: string;
  value: string;
  onChange: (value: string) => void;
  name?: string;
  width?: FieldWidth;
  /** Hauteur en lignes. 3 : de quoi écrire deux phrases sans faire défiler. */
  rows?: number;
  isRequired?: boolean;
  isDisabled?: boolean;
  /** Message d'erreur déjà traduit. Sa seule présence rend le champ invalide. */
  error?: string;
  /** Texte d'aide déjà traduit. HeroUI le masque quand le champ est en erreur. */
  hint?: string;
  placeholder?: string;
  maxLength?: number;
  testId?: string;
};

export function Textarea({
  label,
  value,
  onChange,
  name,
  width = "full",
  rows = 3,
  isRequired,
  isDisabled,
  error,
  hint,
  placeholder,
  maxLength,
  testId,
}: TextareaProps) {
  return (
    <TextField
      className={FIELD_WIDTH_CLASSES[width]}
      name={name}
      value={value}
      onChange={onChange}
      isRequired={isRequired}
      isDisabled={isDisabled}
      isInvalid={Boolean(error)}
      // Même raison que sur `Field` : un champ requis en validation native bloque la soumission
      // avant le `onSubmit` React (CLAUDE.md §11 point 11). Voir l'en-tête de Field.tsx.
      validationBehavior="aria"
      data-testid={testId}
    >
      <Label>{label}</Label>
      <TextArea
        className={FIELD_MIN_HEIGHT}
        rows={rows}
        placeholder={placeholder}
        maxLength={maxLength}
        data-testid={testId ? `${testId}-input` : undefined}
      />
      {hint ? (
        <Description data-testid={testId ? `${testId}-hint` : undefined}>{hint}</Description>
      ) : null}
      {error ? (
        <ErrorMessage data-testid={testId ? `${testId}-error` : undefined}>{error}</ErrorMessage>
      ) : null}
    </TextField>
  );
}
