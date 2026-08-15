-- Feature 10 (Admin : changer manuellement le statut d'une ligne de commande) —
-- set_order_line_status. Migration 20260814170000_set_order_line_status_rpc.sql, seule source de
-- vérité pour les messages/logique. Verrou FOR UPDATE simple (propriété/existence de la ligne),
-- même calibrage bas-risque que cancel_order (feature 8) — pas de test de concurrence à barrière.
begin;
select plan(13);

create function test_login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

-- Fixtures : 1 partenaire/établissement/produit, 1 admin, 1 compte non-admin (buyer).
insert into partners (id, display_name) values
  ('88900000-0000-4000-8000-000000000001', 'Set Status Test Partner');
insert into establishments (id, partner_id, name) values
  ('88900000-0000-4000-8000-000000000011', '88900000-0000-4000-8000-000000000001',
   jsonb_build_object('es', 'Establecimiento Set Status'));
insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug)
values (
  '88900000-0000-4000-8000-000000000021', '88900000-0000-4000-8000-000000000001',
  '88900000-0000-4000-8000-000000000011', 'activity',
  jsonb_build_object('es', 'Actividad Set Status'), 50000, true, 'set-status-test'
);

insert into auth.users (id, email) values
  ('88900000-0000-4000-8000-000000000031', 'set-status-admin@test.local'),
  ('88900000-0000-4000-8000-000000000032', 'set-status-buyer@test.local');
insert into partner_capabilities (account_id, role, source, status)
values ('88900000-0000-4000-8000-000000000031', 'admin', 'migration', 'active');

-- Commande + ligne reserved, cible de la plupart des cas. Colonnes de snapshot commission
-- (feature 11, order_lines.price_cop/total_cop/commission_case/...) renseignées avec des valeurs
-- de remplissage neutres (commission_case='direct') — hors de portée de ce fichier, qui teste
-- uniquement la transition de statut et son audit, pas le calcul de commission lui-même.
insert into orders (id, account_id, holder_name)
values (
  '88900000-0000-4000-8000-000000000041', '88900000-0000-4000-8000-000000000032', 'Holder Set Status'
);
insert into order_lines (
  id, order_id, account_id, product_id, date, qty, status,
  price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
  acompte_cop, referrer_commission_cop, app_commission_cop
)
values (
  '88900000-0000-4000-8000-000000000051', '88900000-0000-4000-8000-000000000041',
  '88900000-0000-4000-8000-000000000032', '88900000-0000-4000-8000-000000000021',
  '2028-12-01', 1, 'reserved',
  50000, 50000, 'direct', 0, 0, 0, 0, 0, 0
);

-- Cas 1 : non-admin → exception, rien modifié, aucune ligne audit_log.
set local role authenticated;
select test_login('88900000-0000-4000-8000-000000000032'); -- buyer, pas admin
select throws_ok(
  $$ select set_order_line_status(
       '88900000-0000-4000-8000-000000000051', 'fulfilled', 'Tentative non-admin'
     ) $$,
  '42501'::char(5),
  'set_order_line_status réservé au rôle admin',
  'appel non-admin → exception 42501'
);
select is(
  (select status from order_lines where id = '88900000-0000-4000-8000-000000000051'),
  'reserved',
  'cas 1 : statut inchangé après le refus non-admin'
);
select is(
  (select count(*) from audit_log where entity_id = '88900000-0000-4000-8000-000000000051')::int,
  0,
  'cas 1 : aucune ligne audit_log créée par l''appel refusé'
);

set local role authenticated;
select test_login('88900000-0000-4000-8000-000000000031'); -- admin pour le reste des cas

-- Cas 2 : motif vide ('' et null) → exception, rien modifié.
select throws_ok(
  $$ select set_order_line_status(
       '88900000-0000-4000-8000-000000000051', 'fulfilled', ''
     ) $$,
  'P0001'::char(5),
  'motif obligatoire pour une transition manuelle',
  'motif vide ('''') → exception'
);
select is(
  (select status from order_lines where id = '88900000-0000-4000-8000-000000000051'),
  'reserved',
  'cas 2a : statut inchangé après le refus motif vide'
);
select throws_ok(
  $$ select set_order_line_status(
       '88900000-0000-4000-8000-000000000051', 'fulfilled', null
     ) $$,
  'P0001'::char(5),
  'motif obligatoire pour une transition manuelle',
  'motif null → exception'
);
select is(
  (select status from order_lines where id = '88900000-0000-4000-8000-000000000051'),
  'reserved',
  'cas 2b : statut inchangé après le refus motif null'
);

-- Cas 3 : statut cible hors des 5 valeurs autorisées (jamais un retour vers reserved, ni une
-- valeur inconnue) → exception.
select throws_ok(
  $$ select set_order_line_status(
       '88900000-0000-4000-8000-000000000051', 'bogus', 'Motivo válido'
     ) $$,
  'P0001'::char(5),
  'statut cible invalide : bogus',
  'statut hors des 5 valeurs autorisées → exception'
);
select is(
  (select status from order_lines where id = '88900000-0000-4000-8000-000000000051'),
  'reserved',
  'cas 3 : statut inchangé après le refus statut invalide'
);

-- Cas 4 : ligne de commande introuvable → exception.
select throws_ok(
  $$ select set_order_line_status(
       '00000000-0000-4000-8000-000000000099', 'fulfilled', 'Motivo válido'
     ) $$,
  'P0001'::char(5),
  'ligne de commande introuvable',
  'ligne inexistante → exception'
);

-- Cas 5 : appel admin valide → statut mis à jour ET une ligne audit_log correcte (action, before,
-- after, note = le motif fourni).
select is(
  (select set_order_line_status(
     '88900000-0000-4000-8000-000000000051', 'fulfilled', 'Cliente confirmado en el punto de encuentro'
   )),
  jsonb_build_object('ok', true),
  'cas 5 : appel admin valide → succès'
);
select is(
  (select status from order_lines where id = '88900000-0000-4000-8000-000000000051'),
  'fulfilled',
  'cas 5 : statut mis à jour à fulfilled'
);
select is(
  (select jsonb_build_object(
     'action', action, 'entity_table', entity_table, 'entity_id', entity_id,
     'before', before, 'after', after, 'note', note
   ) from audit_log where entity_id = '88900000-0000-4000-8000-000000000051'),
  jsonb_build_object(
    'action', 'order_line.set_status', 'entity_table', 'order_lines',
    'entity_id', '88900000-0000-4000-8000-000000000051',
    'before', jsonb_build_object('status', 'reserved'),
    'after', jsonb_build_object('status', 'fulfilled'),
    'note', 'Cliente confirmado en el punto de encuentro'
  ),
  'cas 5 : ligne audit_log correcte (action/before/after/note)'
);

select * from finish();
rollback;
