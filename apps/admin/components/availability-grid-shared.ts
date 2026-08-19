// Spec 17 §0 Tranche 2 §3bis point 7 — dérogation au reflow mobile de SimpleTable, validée sur
// prototype réel le 2026-08-17 (cf. docs/journal/2026-08.md) : classes `className` locales
// rétablissant l'affichage tabulaire sous `md` + 1re colonne figée, SANS toucher au comportement
// par défaut du composant partagé (CommissionsTable/ReservationsTable gardent le reflow cartes,
// correct pour leur forme lignes=enregistrement). Une matrice lignes=chambre/horario × colonnes=date
// n'a pas de sens en cartes empilées — l'axe colonne (date) y disparaîtrait entièrement. SEULE
// définition de ces 3 constantes dans tout le projet — partagée par room-availability-grid.tsx et
// slot-availability-grid.tsx (avant cette extraction, copiées-collées verbatim entre les deux).
export const ROW_CLASS =
  "max-md:table-row max-md:mb-0 max-md:rounded-none max-md:border-0 max-md:border-b max-md:border-border max-md:p-0";
export const CELL_CLASS = "max-md:table-cell max-md:justify-start max-md:p-1 max-md:before:content-none";
export const STICKY_CELL_CLASS = "sticky left-0 z-10 bg-surface max-md:table-cell";
