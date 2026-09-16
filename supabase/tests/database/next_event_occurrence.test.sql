-- `next_event_occurrence` (migration 20260915110000_search_catalog_evento_next_occurrence.sql) —
-- la prochaine date d'occurrence (>= aujourd'hui à Bogotá) d'un evento once/recurring, ou null s'il
-- n'en reste aucune. Seul consommateur aujourd'hui : `search_catalog` (tri des evento).
--
-- Tourne en `anon` : c'est le rôle réel du seul appelant (`search_catalog`, SECURITY INVOKER) — ce
-- fichier verrouille au passage que `today_in_bogota()` reste exécutable par ce rôle (grant ajouté
-- par cette même migration, aucun test dédié n'existait pour ce grant précis).
--
-- Toutes les dates sont exprimées RELATIVEMENT à `today_in_bogota()`, jamais en dur : ce test doit
-- rester vrai indéfiniment, pas seulement le jour où il a été écrit (contrairement aux fixtures de
-- disponibilité d'autres fichiers, qui datent volontairement dans un futur lointain fixe).

begin;
select plan(11);

set local role anon;

-- ── once ────────────────────────────────────────────────────────────────────────────────────────
select is(
  next_event_occurrence('once', today_in_bogota() - 1, null, null, null),
  null::date,
  'once déjà passé (hier) → aucune occurrence à venir'
);

select is(
  next_event_occurrence('once', today_in_bogota() + 30, null, null, null),
  today_in_bogota() + 30,
  'once futur → sa propre date'
);

select is(
  next_event_occurrence('once', today_in_bogota(), null, null, null),
  today_in_bogota(),
  'once dont la date est AUJOURD''HUI compte encore comme à venir (>=, pas >)'
);

select is(
  next_event_occurrence('once', null, null, null, null),
  null::date,
  'once sans occurrence_date (donnée incomplète) → null, jamais une erreur'
);

-- ── recurring ───────────────────────────────────────────────────────────────────────────────────
select is(
  next_event_occurrence('recurring', today_in_bogota() - 30, 10, null, null),
  today_in_bogota(),
  'recurring dont l''écart depuis l''ancre est un multiple EXACT de la fréquence → atterrit sur aujourd''hui'
);

select is(
  next_event_occurrence('recurring', today_in_bogota() - 25, 10, null, null),
  today_in_bogota() + 5,
  'recurring dont l''écart n''est PAS un multiple exact → avance au prochain multiple après aujourd''hui (ceil, jamais floor)'
);

select is(
  next_event_occurrence('recurring', today_in_bogota() + 40, 15, null, null),
  today_in_bogota() + 40,
  'recurring sans aucune fin, ancre déjà dans le futur → l''ancre elle-même (v_n=0)'
);

select is(
  -- Même série que le 2e cas ci-dessus (candidate = today+5), mais bornée par une date déjà dépassée
  -- par cette candidate.
  next_event_occurrence('recurring', today_in_bogota() - 25, 10, today_in_bogota() + 4, null),
  null::date,
  'recurring dont la série est terminée par date (recurrence_end_date avant la prochaine occurrence) → null'
);

select is(
  -- Même série (candidate = today+5, index n=3 depuis l'ancre à -25/+10 = pas exactement, on
  -- reprend le cas simple -30/10 où n=3 pour un compte rond) : 3 occurrences prévues, n=3 est
  -- hors bornes (indices valides 0,1,2).
  next_event_occurrence('recurring', today_in_bogota() - 30, 10, null, 3),
  null::date,
  'recurring dont la série est terminée par nombre (recurrence_end_count atteint) → null'
);

select is(
  next_event_occurrence('recurring', today_in_bogota() - 30, null, null, null),
  null::date,
  'recurring sans fréquence (donnée incomplète) → null, jamais une division par zéro'
);

-- ── type inconnu / defensif ─────────────────────────────────────────────────────────────────────
select is(
  next_event_occurrence(null, today_in_bogota() + 10, null, null, null),
  null::date,
  'occurrence_type absent (produit non-evento) → null, jamais une erreur'
);

select * from finish();
rollback;
