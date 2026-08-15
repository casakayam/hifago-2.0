-- Feature 22 (Admin : file de réconciliation PMS) — resolve_reconciliation_entry.
-- Migration 20260814210000_pms_reconciliation_entries.sql, seule source de vérité pour les
-- messages/logique. Verrou FOR UPDATE simple (existence/statut de l'entrée), même calibrage
-- bas-risque que la feature 10 (set_order_line_status) — pas de test de concurrence à barrière
-- (aucun compteur de capacité touché, cf. plan § Feature 22 Gate).
begin;
select plan(17);

create function test_login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

-- request.jwt.claims est scope-transaction (SET LOCAL via set_config(..., true)), pas
-- scope-statement : indispensable d'appeler test_logout() avant de simuler un appel non-admin
-- après qu'un test_login ait déjà tourné plus tôt dans le même fichier — sinon auth.uid()
-- continuerait de résoudre la dernière identité connectée malgré le changement de rôle Postgres.
create function test_logout() returns void language sql as $$
  reset request.jwt.claims;
$$;

-- Fixtures : 1 partenaire/établissement/produit, 1 admin, 1 compte non-admin (buyer), 1 commande +
-- 4 lignes de commande (pour couvrir open/retrying/resolved/permanently_failed sans réutiliser la
-- même ligne entre entrées), 4 entrées pms_reconciliation_entries correspondantes.
insert into partners (id, display_name) values
  ('88910000-0000-4000-8000-000000000001', 'Reconciliation Test Partner');
insert into establishments (id, partner_id, name) values
  ('88910000-0000-4000-8000-000000000011', '88910000-0000-4000-8000-000000000001',
   jsonb_build_object('es', 'Establecimiento Reconciliation'));
insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug)
values (
  '88910000-0000-4000-8000-000000000021', '88910000-0000-4000-8000-000000000001',
  '88910000-0000-4000-8000-000000000011', 'activity',
  jsonb_build_object('es', 'Actividad Reconciliation'), 50000, true, 'reconciliation-test'
);

insert into auth.users (id, email) values
  ('88910000-0000-4000-8000-000000000031', 'reconciliation-admin@test.local'),
  ('88910000-0000-4000-8000-000000000032', 'reconciliation-buyer@test.local');
insert into partner_capabilities (account_id, role, source, status)
values ('88910000-0000-4000-8000-000000000031', 'admin', 'migration', 'active');

insert into orders (id, account_id, holder_name)
values (
  '88910000-0000-4000-8000-000000000041', '88910000-0000-4000-8000-000000000032',
  'Holder Reconciliation'
);
-- Colonnes de snapshot commission (feature 11) renseignées avec des valeurs de remplissage
-- neutres (commission_case='direct') — hors de portée de ce fichier.
insert into order_lines (
  id, order_id, account_id, product_id, date, qty, status,
  price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
  acompte_cop, referrer_commission_cop, app_commission_cop
)
values
  ('88910000-0000-4000-8000-000000000051', '88910000-0000-4000-8000-000000000041',
   '88910000-0000-4000-8000-000000000032', '88910000-0000-4000-8000-000000000021',
   '2028-12-01', 1, 'reserved', 50000, 50000, 'direct', 0, 0, 0, 0, 0, 0),
  ('88910000-0000-4000-8000-000000000052', '88910000-0000-4000-8000-000000000041',
   '88910000-0000-4000-8000-000000000032', '88910000-0000-4000-8000-000000000021',
   '2028-12-02', 1, 'reserved', 50000, 50000, 'direct', 0, 0, 0, 0, 0, 0),
  ('88910000-0000-4000-8000-000000000053', '88910000-0000-4000-8000-000000000041',
   '88910000-0000-4000-8000-000000000032', '88910000-0000-4000-8000-000000000021',
   '2028-12-03', 1, 'reserved', 50000, 50000, 'direct', 0, 0, 0, 0, 0, 0),
  ('88910000-0000-4000-8000-000000000054', '88910000-0000-4000-8000-000000000041',
   '88910000-0000-4000-8000-000000000032', '88910000-0000-4000-8000-000000000021',
   '2028-12-04', 1, 'reserved', 50000, 50000, 'direct', 0, 0, 0, 0, 0, 0);

-- Entrée A : open, cible des cas 1/2/3 (non-admin, motif vide, appel positif final).
insert into pms_reconciliation_entries (id, order_line_id, status, attempts) values
  ('88910000-0000-4000-8000-000000000061', '88910000-0000-4000-8000-000000000051', 'open', 1);
-- Entrée B : retrying, cible du cas positif « retrying → resolved ».
insert into pms_reconciliation_entries (id, order_line_id, status, attempts) values
  ('88910000-0000-4000-8000-000000000062', '88910000-0000-4000-8000-000000000052', 'retrying', 2);
-- Entrée C : déjà resolved.
insert into pms_reconciliation_entries (id, order_line_id, status, attempts, resolved_by, resolved_at, resolution_note) values
  ('88910000-0000-4000-8000-000000000063', '88910000-0000-4000-8000-000000000053', 'resolved', 1,
   '88910000-0000-4000-8000-000000000031', now() - interval '1 day', 'Déjà résolue avant ce test');
-- Entrée D : permanently_failed.
insert into pms_reconciliation_entries (id, order_line_id, status, attempts) values
  ('88910000-0000-4000-8000-000000000064', '88910000-0000-4000-8000-000000000054', 'permanently_failed', 5);

-- Cas 1 : appel par un compte non-admin → exception 42501, rien modifié, aucune ligne audit_log.
set local role authenticated;
select test_login('88910000-0000-4000-8000-000000000032'); -- buyer, pas admin
select throws_ok(
  $$ select resolve_reconciliation_entry(
       '88910000-0000-4000-8000-000000000061', 'Tentativa no admin'
     ) $$,
  '42501'::char(5),
  'resolve_reconciliation_entry réservé au rôle admin',
  'appel non-admin → exception 42501'
);
-- reset role (→ postgres, superuser) pour vérifier l'état réel : pms_reconciliation_entries n'a
-- qu'une policy SELECT réservée admin, donc un buyer non-admin ne verrait de toute façon aucune
-- ligne (NULL/0 par blocage RLS, pas par preuve que rien n'a changé) — même motif que
-- cancel_order.test.sql pour la lecture directe des fixtures.
reset role;
select is(
  (select status from pms_reconciliation_entries where id = '88910000-0000-4000-8000-000000000061'),
  'open',
  'cas 1 : statut inchangé après le refus non-admin'
);
select is(
  (select count(*) from audit_log where entity_id = '88910000-0000-4000-8000-000000000061')::int,
  0,
  'cas 1 : aucune ligne audit_log créée par l''appel refusé'
);

select test_logout();
set local role authenticated;
select test_login('88910000-0000-4000-8000-000000000031'); -- admin pour le reste des cas

-- Cas 2 : motif vide ('' et null) → exception, rien modifié.
select throws_ok(
  $$ select resolve_reconciliation_entry(
       '88910000-0000-4000-8000-000000000061', ''
     ) $$,
  'P0001'::char(5),
  'motif obligatoire pour résoudre une entrée',
  'motif vide ('''') → exception'
);
select is(
  (select status from pms_reconciliation_entries where id = '88910000-0000-4000-8000-000000000061'),
  'open',
  'cas 2a : statut inchangé après le refus motif vide'
);
select throws_ok(
  $$ select resolve_reconciliation_entry(
       '88910000-0000-4000-8000-000000000061', null
     ) $$,
  'P0001'::char(5),
  'motif obligatoire pour résoudre une entrée',
  'motif null → exception'
);
select is(
  (select status from pms_reconciliation_entries where id = '88910000-0000-4000-8000-000000000061'),
  'open',
  'cas 2b : statut inchangé après le refus motif null'
);

-- Cas 3 : p_entry_id inexistant → exception.
select throws_ok(
  $$ select resolve_reconciliation_entry(
       '00000000-0000-4000-8000-000000000099', 'Motivo válido'
     ) $$,
  'P0001'::char(5),
  'entrée introuvable',
  'entrée inexistante → exception'
);

-- Cas 4a : entrée déjà resolved → exception, rien modifié.
select throws_ok(
  $$ select resolve_reconciliation_entry(
       '88910000-0000-4000-8000-000000000063', 'Motivo válido'
     ) $$,
  'P0001'::char(5),
  'entrée déjà traitée (statut resolved)',
  'entrée déjà resolved → exception'
);
select is(
  (select resolution_note from pms_reconciliation_entries where id = '88910000-0000-4000-8000-000000000063'),
  'Déjà résolue avant ce test',
  'cas 4a : resolution_note inchangée (pas de double résolution silencieuse)'
);

-- Cas 4b : entrée déjà permanently_failed → exception, rien modifié.
select throws_ok(
  $$ select resolve_reconciliation_entry(
       '88910000-0000-4000-8000-000000000064', 'Motivo válido'
     ) $$,
  'P0001'::char(5),
  'entrée déjà traitée (statut permanently_failed)',
  'entrée déjà permanently_failed → exception'
);
select is(
  (select status from pms_reconciliation_entries where id = '88910000-0000-4000-8000-000000000064'),
  'permanently_failed',
  'cas 4b : statut inchangé après le refus'
);

-- Cas 5 : admin sur une entrée open → resolved, avec resolved_by/resolved_at/resolution_note
-- corrects, ET une ligne audit_log (action reconciliation.resolve).
select is(
  (select resolve_reconciliation_entry(
     '88910000-0000-4000-8000-000000000061', 'Reserva confirmada manualmente en LobbyPMS'
   )),
  jsonb_build_object('ok', true),
  'cas 5 : appel admin valide sur entrée open → succès'
);
select is(
  (select jsonb_build_object(
     'status', status, 'resolved_by', resolved_by, 'resolution_note', resolution_note,
     'resolved_at_not_null', resolved_at is not null
   ) from pms_reconciliation_entries where id = '88910000-0000-4000-8000-000000000061'),
  jsonb_build_object(
    'status', 'resolved', 'resolved_by', '88910000-0000-4000-8000-000000000031',
    'resolution_note', 'Reserva confirmada manualmente en LobbyPMS', 'resolved_at_not_null', true
  ),
  'cas 5 : entrée open → resolved, resolved_by/resolved_at/resolution_note corrects'
);
select is(
  (select jsonb_build_object('action', action, 'entity_table', entity_table, 'entity_id', entity_id)
     from audit_log where entity_id = '88910000-0000-4000-8000-000000000061'),
  jsonb_build_object(
    'action', 'reconciliation.resolve', 'entity_table', 'pms_reconciliation_entries',
    'entity_id', '88910000-0000-4000-8000-000000000061'
  ),
  'cas 5 : ligne audit_log correcte (action reconciliation.resolve)'
);

-- Cas 6 : admin sur une entrée retrying → resolved (même transition depuis les 2 statuts
-- actionnables autorisés par le plan).
select is(
  (select resolve_reconciliation_entry(
     '88910000-0000-4000-8000-000000000062', 'Sincronización reintentada con éxito'
   )),
  jsonb_build_object('ok', true),
  'cas 6 : appel admin valide sur entrée retrying → succès'
);
select is(
  (select status from pms_reconciliation_entries where id = '88910000-0000-4000-8000-000000000062'),
  'resolved',
  'cas 6 : entrée retrying → resolved'
);

select * from finish();
rollback;
