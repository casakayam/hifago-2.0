// addDays — arithmétique de date CIVILE (yyyy-MM-dd + n jours), sans fuseau, pour les calendriers
// admin/socio (grille de cupos, pagination des fenêtres de dates).
//
// Lot fuseau (2026-08-28) : l'implémentation vivait ici (parse en minuit UTC, setUTCDate,
// toISOString). Elle était juste — l'aller-retour UTC est auto-cohérent — mais c'était une SECONDE
// définition du même geste, indiscernable à l'œil (et pour un lint) des huit autres sites qui,
// eux, tronquaient un INSTANT et rendaient donc la date d'UTC. Elle est désormais celle de
// packages/domain/src/time/bogotaDates.ts : une seule implémentation dans tout le dépôt, une seule
// échappatoire à la règle de lint. Le nom local `addDays` est conservé — quatre appelants
// (les deux pages slot-availability, availability-calendar.tsx, slotAvailabilityPage.ts) le
// consomment déjà sous ce nom.
export { addDaysIso as addDays } from "@hifago/domain";
