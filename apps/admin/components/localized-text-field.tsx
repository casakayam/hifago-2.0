"use client";

import { useState, type Dispatch, type SetStateAction } from "react";
import { Input, Label, TextArea, TextField, cn } from "@hifago/ui";

// Spec 11 (parcours unifié création/édition d'une activité) — extrait le pattern déjà dupliqué 4×
// côté établissement (NewEstablishmentForm.tsx et 3 autres écrans) : un seul champ affiché + des
// boutons qui basculent la langue visible, jamais deux champs côte à côte. Réouvre consciemment la
// décision spec 08 §10 qui avait retiré tout sélecteur de langue pour le nom d'une activité — à la
// demande explicite de Jérôme (2026-08-16), tracée dans spec 11 §3.
//
// Les 4 usages établissement existants ne sont volontairement PAS rebranchés sur ce composant dans
// cette livraison (mécanique, mais lot séparé pour garder ce diff revuable — spec 11 §10).
export type LocalizedValue = Record<string, string>;

const LANG_LABELS: Record<string, string> = { es: "ES", en: "EN" };

export function LocalizedTextField({
  label,
  value,
  onChange,
  multiline = false,
  isRequired = false,
  requiredLang = "es",
  langs = ["es", "en"] as const,
  inputName,
  testIdPrefix,
  fieldTestId,
}: {
  label: string;
  value: LocalizedValue;
  // Setter React direct (ex. le setName d'un useState), pas un callback (next) => void : la mise
  // à jour passe TOUJOURS par la forme fonctionnelle (prev => ...) en interne, jamais par une
  // valeur calculée à partir du `value` capturé dans la closure de ce render — un enchaînement
  // rapide bascule-langue + saisie (comme en e2e) peut sinon appliquer une mise à jour sur un
  // `value` déjà obsolète et perdre la langue précédemment saisie (constaté spec 11, corrigé après
  // un e2e qui perdait `name.es` en changeant de langue juste après l'avoir saisi).
  onChange: Dispatch<SetStateAction<LocalizedValue>>;
  multiline?: boolean;
  isRequired?: boolean;
  requiredLang?: string;
  langs?: readonly string[];
  inputName?: string;
  testIdPrefix: string;
  fieldTestId?: string;
}) {
  const [activeLang, setActiveLang] = useState(requiredLang);

  return (
    <TextField
      fullWidth
      name={inputName}
      value={value[activeLang] ?? ""}
      onChange={(next) => onChange((prev) => ({ ...prev, [activeLang]: next }))}
      isRequired={isRequired && activeLang === requiredLang}
    >
      <div className="flex items-center justify-between">
        <Label htmlFor={inputName}>{label}</Label>
        <div className="flex gap-1" role="group" aria-label={`Idioma de ${label.toLowerCase()}`}>
          {langs.map((lang) => (
            <button
              key={lang}
              type="button"
              data-testid={`${testIdPrefix}-lang-${lang}`}
              onClick={() => setActiveLang(lang)}
              className={cn(
                "rounded px-2 py-0.5 text-xs font-medium uppercase",
                activeLang === lang
                  ? "bg-accent text-accent-foreground"
                  : "text-muted hover:bg-muted/50",
              )}
            >
              {LANG_LABELS[lang] ?? lang}
            </button>
          ))}
        </div>
      </div>
      {multiline ? (
        <TextArea data-testid={fieldTestId} />
      ) : (
        <Input id={inputName} data-testid={fieldTestId} />
      )}
    </TextField>
  );
}

// Construit le payload jsonb {es?, en?} à partir de l'état local du composant — même logique que
// buildDescription() dupliquée dans les 4 formulaires établissement, centralisée ici pour tout
// nouvel usage (name ET description de l'activité).
export function buildLocalizedPayload(value: LocalizedValue): Record<string, string> | undefined {
  const entries = Object.entries(value)
    .map(([lang, text]) => [lang, text.trim()] as const)
    .filter(([, text]) => text.length > 0);
  if (entries.length === 0) return undefined;
  return Object.fromEntries(entries);
}
