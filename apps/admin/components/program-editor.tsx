"use client";

import { useState } from "react";
import { Input, Label } from "@hifago/ui";
import {
  MAX_TEXTO,
  ajouterLigne,
  joursAAfficher,
  prochainJour,
  retirerJour,
  retirerLigne,
  setLigne,
  type DraftProgram,
} from "@/lib/products/program";

// Programme jour par jour d'un camp (spec 37). Composant UI pur, contrôlé (value/onChange), aucun
// I/O réseau — même discipline que SlotRulesEditor/StayRatesEditor.
//
// ⚠️ UN SEUL sélecteur de langue pour tout le bloc, et non un LocalizedTextField par ligne comme
// pour le nom et la description. Raison mesurée, pas esthétique : un camp de 7 jours × 4 lignes
// afficherait 28 sélecteurs ES/EN indépendants, chacun avec son propre état de langue, dans une
// colonne `max-w-md` — illisible à 390 px, alors que le responsive admin est obligatoire
// (.claude/rules/ui.md). Ici la bascule est globale, ce qui colle en plus au geste réel : on
// saisit tout en espagnol, puis on bascule et on traduit tout.
//
// Le stockage reste {es, en} par ligne, identique à products.name/description : c'est bien du
// contenu partenaire multilingue, seule la SAISIE est mutualisée. setLigne (program.ts) n'écrit
// que la langue active et conserve l'autre — la régression que ce helper existe pour empêcher est
// couverte par program.test.ts.
const LANGUES = ["es", "en"] as const;
const LANG_LABELS: Record<string, string> = { es: "ES", en: "EN" };

export function ProgramEditor({
  value,
  onChange,
  durationDays,
  testIdPrefix = "",
}: {
  value: DraftProgram;
  onChange: (next: DraftProgram) => void;
  // Durée persistée ou saisie du camp, `null` quand elle n'est pas connue — ce qui arrive
  // réellement : rien n'oblige l'admin à renseigner « Duración (días) » avant le programme sur
  // l'écran de création, et l'édition ne la réinjecte pas dans le formulaire. On ouvre alors la
  // seule journée 1 et l'admin ajoute les suivantes à la main.
  durationDays: number | null;
  testIdPrefix?: string;
}) {
  const [langue, setLangue] = useState<string>("es");
  const jours = joursAAfficher(value, durationDays);

  function lignesDu(day: number) {
    const jour = value.find((item) => item.day === day);
    // Une journée sans aucune ligne affiche quand même un champ vide : sans lui, une journée
    // ouverte par `durationDays` n'offrirait rien à remplir.
    return jour && jour.lines.length > 0 ? jour.lines : [{}];
  }

  return (
    <div className="flex flex-col gap-3" data-testid={`${testIdPrefix}program-editor`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label>Programa del camp — opcional</Label>
        <div className="flex gap-1" role="group" aria-label="Idioma del programa">
          {LANGUES.map((lang) => (
            <button
              key={lang}
              type="button"
              onClick={() => setLangue(lang)}
              aria-pressed={langue === lang}
              data-testid={`${testIdPrefix}program-lang-${lang}`}
              className={
                langue === lang
                  ? "rounded-sm border border-default px-2 py-0.5 text-xs font-medium"
                  : "rounded-sm px-2 py-0.5 text-xs text-muted"
              }
            >
              {LANG_LABELS[lang]}
            </button>
          ))}
        </div>
      </div>

      <p className="text-xs text-muted" data-testid={`${testIdPrefix}program-help`}>
        Una línea por actividad. Varias líneas pueden compartir el mismo día. El día es relativo a
        la salida (día 1 = día de salida), así que el mismo programa sirve para todas las ediciones
        del camp: la ficha pública muestra la fecha real de la edición elegida.
        {durationDays == null ? " La duración aún no está definida: agrega los días que necesites." : null}
      </p>

      {jours.map((day) => (
        <div key={day} className="flex flex-col gap-2 rounded-md border border-default p-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Día {day}</span>
            <button
              type="button"
              onClick={() => onChange(retirerJour(value, day))}
              aria-label={`Vaciar el día ${day}`}
              data-testid={`${testIdPrefix}clear-program-day-${day}`}
              className="text-xs text-danger underline"
            >
              Vaciar
            </button>
          </div>

          {lignesDu(day).map((ligne, index) => (
            <div key={index} className="flex items-center gap-2">
              <Input
                value={ligne[langue] ?? ""}
                onChange={(event) => onChange(setLigne(value, day, index, langue, event.target.value))}
                maxLength={MAX_TEXTO}
                placeholder={langue === "es" ? "Ej. Caminata al amanecer" : "Ex. Sunrise hike"}
                data-testid={`${testIdPrefix}program-day-${day}-line-${index}`}
              />
              <button
                type="button"
                onClick={() => onChange(retirerLigne(value, day, index))}
                aria-label={`Quitar la línea ${index + 1} del día ${day}`}
                data-testid={`${testIdPrefix}remove-program-day-${day}-line-${index}`}
                className="text-sm text-danger"
              >
                ×
              </button>
            </div>
          ))}

          <button
            type="button"
            onClick={() => onChange(ajouterLigne(value, day))}
            data-testid={`${testIdPrefix}add-program-day-${day}-line-button`}
            className="self-start text-xs font-medium underline"
          >
            + Agregar línea
          </button>
        </div>
      ))}

      <button
        type="button"
        onClick={() => onChange(ajouterLigne(value, prochainJour(value, durationDays)))}
        data-testid={`${testIdPrefix}add-program-day-button`}
        className="self-start text-xs font-medium underline"
      >
        + Agregar día
      </button>
    </div>
  );
}
