-- Spec 19 §0 Tranche 0 — ledger_entries (RLS admin/referrer), mark_ledger_entry_paid (repli manuel
-- de règlement) et establishment_payout_accounts/set_establishment_payout_account (coordonnées de
-- compensation no-show, chemin admin uniquement). Migrations 20260818120000/130000/160000, seules
-- sources de vérité pour les messages/logique. Verrous FOR UPDATE simples (existence/statut d'une
-- ligne), même calibrage bas-risque que pms_reconciliation.test.sql/set_order_line_status.test.sql
-- — pas de test de concurrence à barrière (aucun compteur de capacité touché).
begin;
select plan(22);

create function test_login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;
create function test_logout() returns void language sql as $$
  reset request.jwt.claims;
$$;

-- Fixtures : 1 partenaire propriétaire/établissement/produit, 2 partenaires référents (isolation
-- RLS entre eux), 1 second établissement (cible de set_establishment_payout_account), 1 admin, 1
-- buyer (non-admin), 2 comptes référents rattachés chacun à un des deux partenaires référents.
insert into partners (id, display_name) values
  ('88920000-0000-4000-8000-000000000001', 'Ledger Test Owner Partner'),
  ('88920000-0000-4000-8000-000000000002', 'Ledger Test Referrer A'),
  ('88920000-0000-4000-8000-000000000003', 'Ledger Test Referrer B');
insert into establishments (id, partner_id, name) values
  ('88920000-0000-4000-8000-000000000011', '88920000-0000-4000-8000-000000000001',
   jsonb_build_object('es', 'Establecimiento Ledger')),
  ('88920000-0000-4000-8000-000000000012', '88920000-0000-4000-8000-000000000001',
   jsonb_build_object('es', 'Segundo Establecimiento Ledger'));
insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug)
values (
  '88920000-0000-4000-8000-000000000021', '88920000-0000-4000-8000-000000000001',
  '88920000-0000-4000-8000-000000000011', 'activity',
  jsonb_build_object('es', 'Actividad Ledger'), 50000, true, 'ledger-test'
);

insert into auth.users (id, email) values
  ('88920000-0000-4000-8000-000000000031', 'ledger-admin@test.local'),
  ('88920000-0000-4000-8000-000000000032', 'ledger-buyer@test.local'),
  ('88920000-0000-4000-8000-000000000033', 'ledger-referrer-a@test.local'),
  ('88920000-0000-4000-8000-000000000034', 'ledger-referrer-b@test.local');
insert into partner_capabilities (account_id, role, source, status)
values ('88920000-0000-4000-8000-000000000031', 'admin', 'migration', 'active');
insert into partner_capabilities (partner_id, role, source, status)
values
  ('88920000-0000-4000-8000-000000000002', 'referrer', 'migration', 'active'),
  ('88920000-0000-4000-8000-000000000003', 'referrer', 'migration', 'active');
-- Trigger on_auth_user_created (20260813163438) provisionne déjà partner_accounts(id), partner_id
-- null — même correctif que set_order_line_status.test.sql (UPDATE, jamais un second INSERT).
update partner_accounts set partner_id = '88920000-0000-4000-8000-000000000002'
 where id = '88920000-0000-4000-8000-000000000033';
update partner_accounts set partner_id = '88920000-0000-4000-8000-000000000003'
 where id = '88920000-0000-4000-8000-000000000034';

insert into orders (id, account_id, holder_name, holder_email)
values (
  '88920000-0000-4000-8000-000000000041', '88920000-0000-4000-8000-000000000032',
  'Holder Ledger', 'holder-ledger@test.local'
);
insert into order_lines (
  id, order_id, account_id, product_id, date, qty, status, holder_name,
  price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
  acompte_cop, referrer_commission_cop, app_commission_cop, referrer_partner_id
)
values (
  '88920000-0000-4000-8000-000000000051', '88920000-0000-4000-8000-000000000041',
  '88920000-0000-4000-8000-000000000032', '88920000-0000-4000-8000-000000000021',
  '2028-12-01', 1, 'fulfilled', 'Holder Ledger',
  33333, 33333, 'external_referrer', 0.17, 0.10, 0.07, 5667, 3333, 2333,
  '88920000-0000-4000-8000-000000000002'
);

-- Entrée A : due, référent A (002) — cible du cas mark_ledger_entry_paid positif.
insert into ledger_entries (id, order_line_id, beneficiary_type, referrer_partner_id, entry_type, amount_cop, status)
values (
  '88920000-0000-4000-8000-000000000061', '88920000-0000-4000-8000-000000000051',
  'referrer', '88920000-0000-4000-8000-000000000002', 'referral_earned', 3333, 'due'
);
-- Entrée B : paid, référent A (002) — cible du cas « déjà traitée » (mark_ledger_entry_paid refusé).
insert into ledger_entries (id, order_line_id, beneficiary_type, referrer_partner_id, entry_type, amount_cop, status, paid_at)
values (
  '88920000-0000-4000-8000-000000000062', '88920000-0000-4000-8000-000000000051',
  'referrer', '88920000-0000-4000-8000-000000000002', 'referral_earned', 3333, 'paid', now() - interval '1 day'
);
-- Entrée C : due, établissement (011) — preuve que mark_ledger_entry_paid n'est pas référent-only.
insert into ledger_entries (id, order_line_id, beneficiary_type, establishment_id, entry_type, amount_cop, status)
values (
  '88920000-0000-4000-8000-000000000063', '88920000-0000-4000-8000-000000000051',
  'establishment', '88920000-0000-4000-8000-000000000011', 'establishment_compensation', 3333, 'due'
);
-- Entrée D : estimated, référent B (003) — jamais visible au référent A (isolation RLS).
insert into ledger_entries (id, order_line_id, beneficiary_type, referrer_partner_id, entry_type, amount_cop, status)
values (
  '88920000-0000-4000-8000-000000000064', '88920000-0000-4000-8000-000000000051',
  'referrer', '88920000-0000-4000-8000-000000000003', 'referral_earned', 1000, 'estimated'
);

-- Cas 1 : RLS — le référent A (033) voit ses 3 entrées (A/B, statut 'due'/'paid') mais pas
-- l'entrée D du référent B (isolation stricte, même patron que order_lines_select_referrer).
set local role authenticated;
select test_login('88920000-0000-4000-8000-000000000033'); -- référent A
select is(
  (select count(*)::int from ledger_entries
    where id in ('88920000-0000-4000-8000-000000000061', '88920000-0000-4000-8000-000000000062')),
  2,
  'cas 1a : référent A voit ses 2 entrées propres'
);
select is(
  (select count(*)::int from ledger_entries where id = '88920000-0000-4000-8000-000000000064'),
  0,
  'cas 1b : référent A ne voit jamais l''entrée du référent B (isolation RLS)'
);
select is(
  (select count(*)::int from ledger_entries where id = '88920000-0000-4000-8000-000000000063'),
  0,
  'cas 1c : référent A ne voit pas l''entrée de compensation établissement (beneficiary_type≠referrer)'
);

-- Cas 2 : RLS — un buyer (ni admin ni référent) ne voit aucune entrée du tout.
select test_logout();
select test_login('88920000-0000-4000-8000-000000000032'); -- buyer
select is(
  (select count(*)::int from ledger_entries),
  0,
  'cas 2 : buyer (non-admin, non-référent) → aucune ligne visible'
);

-- Cas 3 : RLS — l'admin voit tout (les 4 entrées de ce fichier).
select test_logout();
select test_login('88920000-0000-4000-8000-000000000031'); -- admin
select is(
  (select count(*)::int from ledger_entries where order_line_id = '88920000-0000-4000-8000-000000000051'),
  4,
  'cas 3 : admin voit les 4 entrées (referrer×3 + establishment×1)'
);

-- Cas 4 : mark_ledger_entry_paid, appel non-admin → exception 42501, rien modifié.
select test_logout();
select test_login('88920000-0000-4000-8000-000000000032'); -- buyer
select throws_ok(
  $$ select mark_ledger_entry_paid(
       '88920000-0000-4000-8000-000000000061', 'comprobantes/x.pdf', 'Tentativa no admin'
     ) $$,
  '42501'::char(5),
  'mark_ledger_entry_paid réservé au rôle admin',
  'cas 4 : appel non-admin → exception 42501'
);

select test_logout();
set local role authenticated;
select test_login('88920000-0000-4000-8000-000000000031'); -- admin pour le reste des cas

-- Cas 5 : motif vide → exception, rien modifié.
select throws_ok(
  $$ select mark_ledger_entry_paid(
       '88920000-0000-4000-8000-000000000061', 'comprobantes/x.pdf', ''
     ) $$,
  'P0001'::char(5),
  'motif obligatoire pour marquer une créance payée',
  'cas 5 : motif vide → exception'
);

-- Cas 6 : entrée introuvable → exception.
select throws_ok(
  $$ select mark_ledger_entry_paid(
       '00000000-0000-4000-8000-000000000099', 'comprobantes/x.pdf', 'Motivo válido'
     ) $$,
  'P0001'::char(5),
  'entrée de ledger introuvable',
  'cas 6 : entrée inexistante → exception'
);

-- Cas 7 : entrée déjà payée (statut ≠ due) → exception, rien modifié.
select throws_ok(
  $$ select mark_ledger_entry_paid(
       '88920000-0000-4000-8000-000000000062', 'comprobantes/x.pdf', 'Motivo válido'
     ) $$,
  'P0001'::char(5),
  'entrée déjà traitée ou non exigible (statut paid)',
  'cas 7 : entrée déjà payée → exception'
);

-- Cas 8 : admin valide sur une entrée référent due → paid, comprobante/note/paid_at corrects, ET
-- une ligne audit_log.
select is(
  (select mark_ledger_entry_paid(
     '88920000-0000-4000-8000-000000000061', 'comprobantes/referente-a.pdf', 'Transferencia Bancolombia confirmada'
   )),
  jsonb_build_object('ok', true),
  'cas 8 : appel admin valide (référent, due) → succès'
);
select is(
  (select jsonb_build_object(
     'status', status, 'comprobante_path', comprobante_path, 'note', note, 'paid_at_not_null', paid_at is not null
   ) from ledger_entries where id = '88920000-0000-4000-8000-000000000061'),
  jsonb_build_object(
    'status', 'paid', 'comprobante_path', 'comprobantes/referente-a.pdf',
    'note', 'Transferencia Bancolombia confirmada', 'paid_at_not_null', true
  ),
  'cas 8 : entrée due → paid, comprobante_path/note/paid_at corrects'
);
select is(
  (select jsonb_build_object('action', action, 'entity_table', entity_table, 'entity_id', entity_id)
     from audit_log where entity_id = '88920000-0000-4000-8000-000000000061'),
  jsonb_build_object(
    'action', 'ledger_entry.mark_paid', 'entity_table', 'ledger_entries',
    'entity_id', '88920000-0000-4000-8000-000000000061'
  ),
  'cas 8 : ligne audit_log correcte (action ledger_entry.mark_paid)'
);

-- Cas 9 : même RPC sur une entrée establishment_compensation due → succès (pas référent-only).
select is(
  (select mark_ledger_entry_paid(
     '88920000-0000-4000-8000-000000000063', 'comprobantes/establecimiento.pdf', 'Compensación no-show pagada'
   )),
  jsonb_build_object('ok', true),
  'cas 9 : appel admin valide (établissement, due) → succès'
);
select is(
  (select status from ledger_entries where id = '88920000-0000-4000-8000-000000000063'),
  'paid',
  'cas 9 : entrée établissement due → paid'
);

-- Cas 10 : set_establishment_payout_account, appel non-admin → exception 42501.
select test_logout();
select test_login('88920000-0000-4000-8000-000000000032'); -- buyer
select throws_ok(
  $$ select set_establishment_payout_account(
       '88920000-0000-4000-8000-000000000012', jsonb_build_object('nombre', 'Test'), 'Tentativa no admin'
     ) $$,
  '42501'::char(5),
  'set_establishment_payout_account réservé au rôle admin',
  'cas 10 : appel non-admin → exception 42501'
);

select test_logout();
set local role authenticated;
select test_login('88920000-0000-4000-8000-000000000031'); -- admin pour le reste des cas

-- Cas 11 : motif vide → exception.
select throws_ok(
  $$ select set_establishment_payout_account(
       '88920000-0000-4000-8000-000000000012', jsonb_build_object('nombre', 'Test'), ''
     ) $$,
  'P0001'::char(5),
  'motif obligatoire pour enregistrer des coordonnées de paiement',
  'cas 11 : motif vide → exception'
);

-- Cas 12 : établissement introuvable → exception.
select throws_ok(
  $$ select set_establishment_payout_account(
       '00000000-0000-4000-8000-000000000099', jsonb_build_object('nombre', 'Test'), 'Motivo válido'
     ) $$,
  'P0001'::char(5),
  'établissement introuvable',
  'cas 12 : établissement inexistant → exception'
);

-- Cas 13 : appel admin valide (première saisie, INSERT) → ligne créée avec le bon bank jsonb.
select is(
  (select set_establishment_payout_account(
     '88920000-0000-4000-8000-000000000012',
     jsonb_build_object('nombre', 'Segundo Establecimiento SAS', 'nequi', '3001234567'),
     'Coordonnées saisies par admin'
   )),
  jsonb_build_object('ok', true),
  'cas 13 : première saisie (insert) → succès'
);
select is(
  (select bank from establishment_payout_accounts where establishment_id = '88920000-0000-4000-8000-000000000012'),
  jsonb_build_object('nombre', 'Segundo Establecimiento SAS', 'nequi', '3001234567'),
  'cas 13 : bank jsonb correctement enregistré'
);

-- Cas 14 : second appel sur le MÊME établissement (upsert) → met à jour, ne duplique jamais la
-- ligne (PK establishment_id).
select is(
  (select set_establishment_payout_account(
     '88920000-0000-4000-8000-000000000012',
     jsonb_build_object('nombre', 'Segundo Establecimiento SAS', 'bancolombia', '999888777'),
     'Coordonnées corrigées par admin'
   )),
  jsonb_build_object('ok', true),
  'cas 14 : second appel (upsert) → succès'
);
select is(
  (select count(*)::int from establishment_payout_accounts
    where establishment_id = '88920000-0000-4000-8000-000000000012'),
  1,
  'cas 14 : toujours une seule ligne (upsert, pas un doublon)'
);
select is(
  (select bank from establishment_payout_accounts where establishment_id = '88920000-0000-4000-8000-000000000012'),
  jsonb_build_object('nombre', 'Segundo Establecimiento SAS', 'bancolombia', '999888777'),
  'cas 14 : bank jsonb remplacé par la nouvelle valeur'
);

select * from finish();
rollback;
