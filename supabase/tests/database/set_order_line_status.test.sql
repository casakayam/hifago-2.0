-- Feature 10 (Admin : changer manuellement le statut d'une ligne de commande) —
-- set_order_line_status. Migration 20260814170000_set_order_line_status_rpc.sql, seule source de
-- vérité pour les messages/logique. Verrou FOR UPDATE simple (propriété/existence de la ligne),
-- même calibrage bas-risque que cancel_order (feature 8) — pas de test de concurrence à barrière.
--
-- Spec 19 §0 Tranche 0 (2026-08-18, migration 20260818150000) — trois extensions couvertes plus
-- bas (cas 6-13) : (a) l'operator peut désormais marquer no_show sur SON établissement, message
-- d'erreur du cas 1 mis à jour en conséquence ; (b) garde de statut de départ (refuse si la ligne
-- n'est plus 'reserved') ; (c) écritures ledger_entries par transition (fulfilled→due,
-- no_show/cancelled_by_client→void+compensation établissement, cancelled_by_provider→reversed,
-- expired→void), seulement pour une ligne external_referrer (referrer_commission_cop > 0).
--
-- Spec 20 §0 (2026-08-18, migration 20260818180000) — élargissement supplémentaire couvert par les
-- cas 13-14 : l'operator peut désormais aussi déclencher cancelled_by_provider sur SON
-- établissement (pas seulement no_show) — messages d'erreur des cas 1/8/9 mis à jour en
-- conséquence (cas 9 reste un refus : fulfilled n'a jamais été ajouté aux transitions operator).
begin;
select plan(34);

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
insert into orders (id, account_id, holder_name, holder_email)
values (
  '88900000-0000-4000-8000-000000000041', '88900000-0000-4000-8000-000000000032', 'Holder Set Status',
  'holder-set-status@test.local'
);
insert into order_lines (
  id, order_id, account_id, product_id, date, qty, status, holder_name,
  price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
  acompte_cop, referrer_commission_cop, app_commission_cop
)
values (
  '88900000-0000-4000-8000-000000000051', '88900000-0000-4000-8000-000000000041',
  '88900000-0000-4000-8000-000000000032', '88900000-0000-4000-8000-000000000021',
  '2028-12-01', 1, 'reserved', 'Holder Set Status',
  50000, 50000, 'direct', 0, 0, 0, 0, 0, 0
);

-- Spec 19 §0 Tranche 0 — fixtures (posées ici, AVANT tout `set local role authenticated` : les
-- inserts dans auth.users exigent le rôle superuser du runner de test, refusés une fois le rôle
-- changé plus bas) : un second établissement/partenaire (autorisation operator négative), un
-- operator actif sur l'établissement d'origine (011), un partenaire référent, et plusieurs lignes
-- reserved à commission externe (+ leur ledger_entries 'estimated') pour tester les écritures
-- ledger par transition indépendamment les unes des autres.
insert into partners (id, display_name) values
  ('88900000-0000-4000-8000-000000000002', 'Set Status Referrer Partner'),
  ('88900000-0000-4000-8000-000000000003', 'Set Status Other Partner');
insert into establishments (id, partner_id, name) values
  ('88900000-0000-4000-8000-000000000012', '88900000-0000-4000-8000-000000000003',
   jsonb_build_object('es', 'Otro Establecimiento'));

insert into auth.users (id, email) values
  ('88900000-0000-4000-8000-000000000033', 'set-status-operator-ok@test.local'),
  ('88900000-0000-4000-8000-000000000034', 'set-status-operator-wrong@test.local');
-- Le trigger on_auth_user_created (20260813163438) provisionne déjà partner_accounts(id) avec
-- partner_id null pour chaque insert ci-dessus — un INSERT explicite entrerait en conflit,
-- l'UPDATE complète simplement la ligne déjà créée.
update partner_accounts set partner_id = '88900000-0000-4000-8000-000000000001'
 where id = '88900000-0000-4000-8000-000000000033';
update partner_accounts set partner_id = '88900000-0000-4000-8000-000000000003'
 where id = '88900000-0000-4000-8000-000000000034';
-- operator ⇒ referrer (trigger enforce_operator_implies_referrer) : une capacité referrer active
-- doit exister pour le même partner_id avant toute capacité operator, même invariant que partout
-- ailleurs dans le projet (§1 note composable).
insert into partner_capabilities (partner_id, role, source, status)
values
  ('88900000-0000-4000-8000-000000000001', 'referrer', 'migration', 'active'),
  ('88900000-0000-4000-8000-000000000003', 'referrer', 'migration', 'active');
insert into partner_capabilities (partner_id, role, establishment_id, source, status)
values
  ('88900000-0000-4000-8000-000000000001', 'operator', '88900000-0000-4000-8000-000000000011',
   'migration', 'active'),
  ('88900000-0000-4000-8000-000000000003', 'operator', '88900000-0000-4000-8000-000000000012',
   'migration', 'active');

insert into order_lines (
  id, order_id, account_id, product_id, date, qty, status, holder_name,
  price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
  acompte_cop, referrer_commission_cop, app_commission_cop, referrer_partner_id
)
select
  v.id, '88900000-0000-4000-8000-000000000041', '88900000-0000-4000-8000-000000000032',
  '88900000-0000-4000-8000-000000000021', v.date, 1, 'reserved', 'Holder Set Status',
  33333, 33333, 'external_referrer', 0.17, 0.10, 0.07, 5667, 3333, 2333,
  '88900000-0000-4000-8000-000000000002'
from (values
  ('88900000-0000-4000-8000-000000000052'::uuid, '2028-12-02'::date), -- cas 7 : operator OK → no_show
  ('88900000-0000-4000-8000-000000000053'::uuid, '2028-12-03'::date), -- cas 8 : operator mauvais établissement
  ('88900000-0000-4000-8000-000000000054'::uuid, '2028-12-04'::date), -- cas 9 : operator tente fulfilled (refusé)
  ('88900000-0000-4000-8000-000000000055'::uuid, '2028-12-05'::date), -- cas 10 : admin fulfilled → ledger due
  ('88900000-0000-4000-8000-000000000056'::uuid, '2028-12-06'::date), -- cas 11 : admin cancelled_by_provider → reversed
  ('88900000-0000-4000-8000-000000000057'::uuid, '2028-12-07'::date)  -- cas 12 : admin expired → void
) as v(id, date);

insert into ledger_entries (order_line_id, beneficiary_type, referrer_partner_id, entry_type, amount_cop, status)
select id, 'referrer', '88900000-0000-4000-8000-000000000002', 'referral_earned', 3333, 'estimated'
  from order_lines
 where id in (
   '88900000-0000-4000-8000-000000000052', '88900000-0000-4000-8000-000000000053',
   '88900000-0000-4000-8000-000000000054', '88900000-0000-4000-8000-000000000055',
   '88900000-0000-4000-8000-000000000056', '88900000-0000-4000-8000-000000000057'
 );

-- Cas 1 : non-admin → exception, rien modifié, aucune ligne audit_log.
set local role authenticated;
select test_login('88900000-0000-4000-8000-000000000032'); -- buyer, pas admin
select throws_ok(
  $$ select set_order_line_status(
       '88900000-0000-4000-8000-000000000051', 'fulfilled', 'Tentative non-admin'
     ) $$,
  '42501'::char(5),
  'set_order_line_status réservé au rôle admin (ou à l''operator du même établissement, pour no_show/cancelled_by_provider uniquement)',
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

-- Cas 6 : garde de statut de départ — la ligne 051 est déjà 'fulfilled' (cas 5), toute nouvelle
-- transition est refusée, quel que soit le rôle appelant.
set local role authenticated;
select test_login('88900000-0000-4000-8000-000000000031'); -- admin
select throws_ok(
  $$ select set_order_line_status(
       '88900000-0000-4000-8000-000000000051', 'no_show', 'Nouvelle tentative'
     ) $$,
  'P0001'::char(5),
  'transition refusée : la ligne n''est plus reserved (statut actuel : fulfilled)',
  'cas 6 : ligne déjà terminale → transition refusée'
);
select is(
  (select status from order_lines where id = '88900000-0000-4000-8000-000000000051'),
  'fulfilled',
  'cas 6 : statut inchangé après le refus'
);

-- Cas 7 : operator actif sur SON établissement (011) → peut marquer no_show. La part référent
-- (estimée) est annulée et redirigée vers l'établissement (compensation due), jamais un split en
-- temps réel — cf. spec 19 §0 invariants.
select test_login('88900000-0000-4000-8000-000000000033'); -- operator_ok, établissement 011
select is(
  (select set_order_line_status(
     '88900000-0000-4000-8000-000000000052', 'no_show', 'Cliente no llegó al punto de encuentro'
   )),
  jsonb_build_object('ok', true),
  'cas 7 : operator de l''établissement propriétaire → no_show accepté'
);
select is(
  (select status from order_lines where id = '88900000-0000-4000-8000-000000000052'),
  'no_show',
  'cas 7 : statut mis à jour à no_show'
);
-- ledger_entries n'a pas de policy select operator (seulement admin/referrer, spec 19 §0) : bascule
-- admin pour lire l'état écrit par l'appel operator ci-dessus, comme cas 8/9 plus bas.
select test_login('88900000-0000-4000-8000-000000000031'); -- admin
select is(
  (select status from ledger_entries
    where order_line_id = '88900000-0000-4000-8000-000000000052' and beneficiary_type = 'referrer'),
  'void',
  'cas 7 : entrée référent (estimated) → void, jamais payée'
);
select is(
  (select jsonb_build_object(
     'beneficiary_type', beneficiary_type, 'establishment_id', establishment_id,
     'entry_type', entry_type, 'amount_cop', amount_cop, 'status', status
   ) from ledger_entries
    where order_line_id = '88900000-0000-4000-8000-000000000052' and beneficiary_type = 'establishment'),
  jsonb_build_object(
    'beneficiary_type', 'establishment', 'establishment_id', '88900000-0000-4000-8000-000000000011',
    'entry_type', 'establishment_compensation', 'amount_cop', 3333, 'status', 'due'
  ),
  'cas 7 : compensation établissement créée, due, même montant que la part référent redirigée'
);

-- Cas 8 : operator actif mais sur un AUTRE établissement (012 ≠ 011, propriétaire réel de la
-- ligne) → refusé, même transition no_show.
select test_login('88900000-0000-4000-8000-000000000034'); -- operator_wrong, établissement 012
select throws_ok(
  $$ select set_order_line_status(
       '88900000-0000-4000-8000-000000000053', 'no_show', 'Tentative operator mauvais établissement'
     ) $$,
  '42501'::char(5),
  'set_order_line_status réservé au rôle admin (ou à l''operator du même établissement, pour no_show/cancelled_by_provider uniquement)',
  'cas 8 : operator d''un autre établissement → refusé'
);
-- order_lines_select_operator scope operator_wrong à SON établissement (012) : la ligne 053
-- (établissement 011) lui est invisible, pas seulement en écriture — bascule admin pour vérifier
-- l'état réel plutôt qu'une lecture bloquée par RLS (NULL ≠ preuve d'un statut inchangé).
select test_login('88900000-0000-4000-8000-000000000031'); -- admin
select is(
  (select status from order_lines where id = '88900000-0000-4000-8000-000000000053'),
  'reserved',
  'cas 8 : statut inchangé après le refus'
);

-- Cas 9 : operator de l'établissement propriétaire, mais transition hors du jeu autorisé
-- (fulfilled) → toujours refusé — l'élargissement d'autorisation ne couvre QUE no_show/
-- cancelled_by_provider (spec 20 §0), jamais fulfilled/cancelled_by_client/expired.
select test_login('88900000-0000-4000-8000-000000000033'); -- operator_ok, établissement 011
select throws_ok(
  $$ select set_order_line_status(
       '88900000-0000-4000-8000-000000000054', 'fulfilled', 'Tentative operator hors no_show'
     ) $$,
  '42501'::char(5),
  'set_order_line_status réservé au rôle admin (ou à l''operator du même établissement, pour no_show/cancelled_by_provider uniquement)',
  'cas 9 : operator tentant une transition autre que no_show → refusé'
);
select is(
  (select status from order_lines where id = '88900000-0000-4000-8000-000000000054'),
  'reserved',
  'cas 9 : statut inchangé après le refus'
);

-- Cas 10 : admin, fulfilled → la créance référent (estimated) devient exigible (due).
select test_login('88900000-0000-4000-8000-000000000031'); -- admin
select is(
  (select set_order_line_status(
     '88900000-0000-4000-8000-000000000055', 'fulfilled', 'Cliente confirmado'
   )),
  jsonb_build_object('ok', true),
  'cas 10 : admin fulfilled → succès'
);
select is(
  (select status from ledger_entries where order_line_id = '88900000-0000-4000-8000-000000000055'),
  'due',
  'cas 10 : entrée référent (estimated) → due'
);

-- Cas 11 : admin, cancelled_by_provider → plus aucune commission due, la créance référent est
-- reversée (« Reprise »).
select is(
  (select set_order_line_status(
     '88900000-0000-4000-8000-000000000056', 'cancelled_by_provider', 'El establecimiento no puede recibir'
   )),
  jsonb_build_object('ok', true),
  'cas 11 : admin cancelled_by_provider → succès'
);
select is(
  (select status from ledger_entries where order_line_id = '88900000-0000-4000-8000-000000000056'),
  'reversed',
  'cas 11 : entrée référent (estimated) → reversed'
);

-- Cas 12 : admin, expired → la créance référent (jamais réalisée) est exclue des totaux (void).
select is(
  (select set_order_line_status(
     '88900000-0000-4000-8000-000000000057', 'expired', 'Reserva no completada a tiempo'
   )),
  jsonb_build_object('ok', true),
  'cas 12 : admin expired → succès'
);
select is(
  (select status from ledger_entries where order_line_id = '88900000-0000-4000-8000-000000000057'),
  'void',
  'cas 12 : entrée référent (estimated) → void'
);

-- Cas 13 (spec 20 §0) : operator actif sur SON établissement (011) → peut désormais aussi annuler
-- lui-même (cancelled_by_provider), pas seulement no_show. La créance référent (estimated) est
-- reversée ; aucune compensation établissement créée (rien n'a été vendu, contrairement au no_show).
select test_login('88900000-0000-4000-8000-000000000033'); -- operator_ok, établissement 011
select is(
  (select set_order_line_status(
     '88900000-0000-4000-8000-000000000054', 'cancelled_by_provider', 'No podemos recibir al cliente'
   )),
  jsonb_build_object('ok', true),
  'cas 13 : operator de l''établissement propriétaire → cancelled_by_provider accepté'
);
select is(
  (select status from order_lines where id = '88900000-0000-4000-8000-000000000054'),
  'cancelled_by_provider',
  'cas 13 : statut mis à jour à cancelled_by_provider'
);
select test_login('88900000-0000-4000-8000-000000000031'); -- admin, ledger_entries sans policy select operator
select is(
  (select status from ledger_entries
    where order_line_id = '88900000-0000-4000-8000-000000000054' and beneficiary_type = 'referrer'),
  'reversed',
  'cas 13 : entrée référent (estimated) → reversed'
);

-- Cas 14 (spec 20 §0) : operator actif mais sur un AUTRE établissement (012 ≠ 011) → refusé, même
-- chose pour cancelled_by_provider (pas seulement no_show, cf. cas 8).
select test_login('88900000-0000-4000-8000-000000000034'); -- operator_wrong, établissement 012
select throws_ok(
  $$ select set_order_line_status(
       '88900000-0000-4000-8000-000000000053', 'cancelled_by_provider', 'Tentative operator mauvais établissement'
     ) $$,
  '42501'::char(5),
  'set_order_line_status réservé au rôle admin (ou à l''operator du même établissement, pour no_show/cancelled_by_provider uniquement)',
  'cas 14 : operator d''un autre établissement → refusé (cancelled_by_provider)'
);
select test_login('88900000-0000-4000-8000-000000000031'); -- admin
select is(
  (select status from order_lines where id = '88900000-0000-4000-8000-000000000053'),
  'reserved',
  'cas 14 : statut inchangé après le refus'
);

select * from finish();
rollback;
