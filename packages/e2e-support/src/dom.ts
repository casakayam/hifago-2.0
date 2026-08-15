import type { Locator } from "@playwright/test";

/**
 * Helpers pour les particularités DOM de HeroUI v3 (react-aria-components), différentes de
 * l'ancien socle base-ui/shadcn — centralisées ici pour ne pas ré-découvrir ces trois points par
 * fichier de spec au fil de la migration.
 */

// La valeur affichée d'un Select HeroUI — à utiliser pour toute assertion de contenu scopée au
// statut sélectionné. Le <select> natif cf. gardé par HeroUI (fallback accessibilité/formulaire)
// liste TOUJOURS le texte de toutes les options possibles : une assertion `toContainText`/
// `hasText` sur la ligne ou le composant entier matche n'importe quel statut, sélectionné ou non.
export function selectValue(scope: Locator) {
  return scope.locator('[data-slot="select-value"]');
}

// Le vrai <input type="checkbox" role="switch"> d'un Switch HeroUI est visuellement masqué
// (clip-path) et niché dans un <label> piloté par usePress (react-aria) — pas par le transfert
// natif label→input. locator.isChecked()/toBeChecked() exigent de cibler cet input directement,
// et le clic doit passer par { force: true } pour contourner l'invisibilité.
export function switchInput(scope: Locator) {
  return scope.locator("input");
}

export async function toggleSwitch(scope: Locator) {
  await scope.click({ force: true });
}

// Piège distinct du Switch ci-dessus (constaté 2026-08-14, feature 26 — admin-partner-create.
// spec.ts) : le Checkbox HeroUI v3 n'enregistre un clic QUE sur son <input> réel — cliquer le
// wrapper racine (même avec { force: true }, ce qui suffit pour Switch) laisse l'état inchangé
// SANS lever d'erreur Playwright, un piège silencieux facile à manquer si le test n'affirme pas
// l'état obtenu côté serveur après coup. Toujours cibler .locator("input") pour le clic lui-même,
// pas seulement pour l'assertion.
export function checkboxInput(scope: Locator) {
  return scope.locator("input");
}

export async function toggleCheckbox(scope: Locator) {
  await scope.locator("input").click({ force: true });
}
