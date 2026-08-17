// Règles de créneaux horaires récurrents — spec 11. Miroir structurel de priceTiers.ts (même
// convention : type "brouillon" en strings pour les inputs contrôlés, validation retournant un
// message d'erreur ou null, conversion vers les types réels de colonne juste avant l'écriture).
// Comparé à l'app legacy (règle "refaire pas réinventer") : zéro précédent, même partiel — le seul
// niveau de granularité horaire jamais implémenté côté V1 est un choix binaire matin/après-midi
// (products.schedule='slot'), jamais des créneaux récurrents par jour de semaine. Terrain vierge,
// cf. spec 11 §1.
export type DraftSlotRule = {
  weekdays: number[]; // ISO 8601 : 1=lundi..7=dimanche
  startTime: string; // "HH:MM"
  endTime: string; // "HH:MM"
  slotDurationMinutes: string;
  capacity: string;
};

export type ParsedSlotRule = {
  weekdays: number[];
  start_time: string;
  end_time: string;
  slot_duration_minutes: number;
  capacity: number;
};

export function emptySlotRule(): DraftSlotRule {
  return { weekdays: [], startTime: "", endTime: "", slotDurationMinutes: "", capacity: "" };
}

// Retourne un message d'erreur (à afficher tel quel) si une règle est invalide, sinon null. Un
// tableau vide est valide (les créneaux restent optionnels) — même discipline que "0 tag" ou
// "aucune borne min/max" (spec 08 §8).
export function validateSlotRules(rules: DraftSlotRule[]): string | null {
  for (const rule of rules) {
    if (rule.weekdays.length === 0) {
      return "Cada horario necesita al menos un día de la semana.";
    }
    if (!rule.startTime || !rule.endTime) {
      return "Cada horario necesita una hora de inicio y una hora de fin.";
    }
    if (rule.endTime <= rule.startTime) {
      return "La hora de fin debe ser posterior a la hora de inicio.";
    }
    const duration = Number(rule.slotDurationMinutes);
    if (!Number.isInteger(duration) || duration < 1) {
      return "La duración del turno debe ser un número entero de al menos 1 minuto.";
    }
    const capacity = Number(rule.capacity);
    if (!Number.isInteger(capacity) || capacity < 1) {
      return "La capacidad de cada turno debe ser un número entero de al menos 1.";
    }
  }
  return null;
}

export function toSlotRuleRows(rules: DraftSlotRule[]): ParsedSlotRule[] {
  return rules.map((rule) => ({
    weekdays: [...rule.weekdays].sort((a, b) => a - b),
    start_time: rule.startTime,
    end_time: rule.endTime,
    slot_duration_minutes: Number(rule.slotDurationMinutes),
    capacity: Number(rule.capacity),
  }));
}

const PREVIEW_LIMIT = 8;

// Prévisualisation purement client-side — aucune écriture, aucune logique de réservation/capacité
// live (Tranche 2, cf. spec 11 §2). Un reliquat non multiple de la durée est simplement tronqué,
// pas signalé comme une erreur.
export function generateSlotPreview(rule: DraftSlotRule): string[] {
  const duration = Number(rule.slotDurationMinutes);
  if (!rule.startTime || !rule.endTime || !Number.isInteger(duration) || duration < 1) return [];

  const startMinutes = toMinutes(rule.startTime);
  const endMinutes = toMinutes(rule.endTime);
  if (startMinutes === null || endMinutes === null || endMinutes <= startMinutes) return [];

  const slots: string[] = [];
  for (let cursor = startMinutes; cursor + duration <= endMinutes; cursor += duration) {
    slots.push(`${formatMinutes(cursor)}–${formatMinutes(cursor + duration)}`);
  }
  return slots;
}

// Résumé tronqué prêt à afficher (data-testid="slot-rule-preview-*") — évite une liste illisible
// pour une plage longue à petits créneaux (ex. 11h de créneaux de 15 min = 44 entrées).
export function formatSlotPreviewSummary(rule: DraftSlotRule): string {
  const slots = generateSlotPreview(rule);
  if (slots.length === 0) return "";
  if (slots.length <= PREVIEW_LIMIT) return slots.join(", ");
  return `${slots.slice(0, PREVIEW_LIMIT).join(", ")}… (+${slots.length - PREVIEW_LIMIT} más)`;
}

function toMinutes(time: string): number | null {
  const [h, m] = time.split(":").map(Number);
  if (!Number.isInteger(h) || !Number.isInteger(m)) return null;
  return h * 60 + m;
}

function formatMinutes(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
