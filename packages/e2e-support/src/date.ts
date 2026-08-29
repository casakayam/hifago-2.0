import { addDaysIso, joursDansLeMois, todayInBogota } from "@hifago/domain";

// Réexport : un spec e2e a souvent besoin de la primitive brute (décaler une date déjà connue,
// lire le jour de Guatapé) en plus des helpers ci-dessous. Une seule source d'import par fichier.
export { addDaysIso, todayInBogota, OPERATION_TIME_ZONE } from "@hifago/domain";

// Helper de date partagé par tout spec e2e qui a besoin d'une date relative à « aujourd'hui » sans
// dépendre de données seedées figées (ex. une nuit de logement, une fenêtre de disponibilité).
//
// ⚠️ LOT FUSEAU (2026-08-28) — CE FICHIER PORTAIT LA MÊME FAUTE QUE LE CODE QU'IL TESTE. Il
// calculait `new Date().toISOString().slice(0, 10)`, exactement comme les huit sites de production
// corrigés ce jour-là. Les tests ne voyaient donc pas le bug : ils le REPRODUISAIENT, des deux
// côtés de l'assertion, et se comparaient à eux-mêmes. C'est la raison pour laquelle dix sites ont
// survécu des mois à une suite de 57 specs.
//
// Corollaire, et c'est le piège à retenir : poser `timezoneId: "America/Bogota"` dans les configs
// Playwright ne suffit PAS. Ce réglage ne vaut que pour le NAVIGATEUR ; ce fichier-ci s'exécute
// dans le processus Node du runner, qui garde le fuseau de la machine (ou UTC en CI). Les deux
// gestes sont nécessaires, et ils ne couvrent pas la même moitié.
export function isoDate(daysFromNow: number): string {
  return addDaysIso(todayInBogota(), daysFromNow);
}

/**
 * Une date du mois SUIVANT, en jour civil de Guatapé — jamais le mois courant, dont le nombre de
 * jours restants dépend de la date d'exécution (piège qui a déjà fait échouer partner-agenda.spec.ts
 * le 2026-08-27, à mesure qu'on approchait du 31).
 *
 * Deux specs admin en avaient chacune leur copie locale, toutes deux ancrées sur `getUTCMonth()`.
 */
export function nextMonthIsoDate(dayOfMonth: number): string {
  const [year, month] = todayInBogota().split("-").map(Number);
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  return `${nextYear}-${String(nextMonth).padStart(2, "0")}-${String(dayOfMonth).padStart(2, "0")}`;
}

/**
 * Le nombre de jours du mois courant à Guatapé — utile aux specs qui doivent viser une date
 * « future mais dans le mois affiché ».
 */
export function daysInCurrentMonthInBogota(): number {
  const [year, month] = todayInBogota().split("-").map(Number);
  // La MÊME fonction que la production (`nightsOfMonth` du connecteur PMS l'utilise aussi) : un
  // helper de test qui redérive ce que la production calcule finit par diverger d'elle, et rend un
  // test vert qui ne teste plus rien.
  return joursDansLeMois(year, month);
}

/** Le quantième du jour à Guatapé (1-31). */
export function dayOfMonthInBogota(): number {
  return Number(todayInBogota().split("-")[2]);
}
