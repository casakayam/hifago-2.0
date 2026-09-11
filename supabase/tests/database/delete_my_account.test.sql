-- Spec 35 Tranche 1 — delete_my_account : l'anonymisation d'un compte par son titulaire.
-- Migration 20260911140000_delete_my_account.sql, seule source de vérité pour les `reason`.
--
-- PAS une RPC critique anti-survente (aucun compteur de capacité touché) : pas de test de
-- concurrence à barrière, même calibrage que cancel_order_line.test.sql.
--
-- ⚠️ DEUX GROUPES D'ASSERTIONS PORTENT TOUT LE LOT :
--   — cas 11-12 : la COMMANDE est intacte après l'anonymisation — PII dénormalisée ET commissions
--     figées. C'est la décision ③ (« il faut qu'on ait quand même les infos personnelles pour le
--     prestataire ») faite exécutable : ces deux lignes rougissent à la seconde où quelqu'un fait
--     déborder l'anonymisation sur orders/order_lines.
--   — cas 4-7 : les DEUX chemins du compte professionnel. `partner_capabilities` porte sa contrainte
--     de portée (admin par account_id, référent/opérateur par partner_id) : un test qui ne
--     couvrirait que le premier laisserait passer la régression la plus probable, puisque c'est
--     précisément l'erreur qu'une lecture rapide du schéma fait commettre.
--
-- Fixtures créées directement en SQL (partner_accounts/orders RPC-only) : ce fichier tourne en tant
-- que postgres, qui contourne les grants. La ligne partner_accounts est créée par le trigger
-- d'approvisionnement (20260813163438), jamais insérée à la main — on la met à jour.
begin;
select plan(15);

create function test_login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

-- Cas 1 : rôle authenticated sans aucun claim JWT, AVANT toute fixture.
set local role authenticated;
select is(
  (select public.delete_my_account()->>'reason'),
  'not_authenticated',
  'rôle authenticated sans JWT claims → not_authenticated'
);
reset role;

-- ---------------------------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------------------------
insert into partners (id, display_name) values
  ('88893000-0000-4000-8000-000000000001', 'Delete Account Test Partner');

insert into establishments (id, partner_id, name, slug) values
  ('88893000-0000-4000-8000-000000000011', '88893000-0000-4000-8000-000000000001',
   jsonb_build_object('es', 'Establecimiento Delete Account'), 'est-delete-account');

insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug) values
  ('88893000-0000-4000-8000-000000000021', '88893000-0000-4000-8000-000000000001',
   '88893000-0000-4000-8000-000000000011', 'activity',
   jsonb_build_object('es', 'Actividad Delete Account'), 50000, true, 'delete-account-test');

-- Cinq identités : le client ordinaire, l'anonyme, le référent, l'admin, et l'admin SUSPENDU.
insert into auth.users (id, email) values
  ('88893000-0000-4000-8000-000000000031', 'da-client@test.local'),
  ('88893000-0000-4000-8000-000000000032', 'da-anon@test.local'),
  ('88893000-0000-4000-8000-000000000033', 'da-referrer@test.local'),
  ('88893000-0000-4000-8000-000000000034', 'da-admin@test.local'),
  ('88893000-0000-4000-8000-000000000035', 'da-suspended@test.local');

update auth.users set is_anonymous = true
 where id = '88893000-0000-4000-8000-000000000032';

-- Le client ordinaire a un profil rempli ET une attribution sauvegardée (cas 13).
insert into partner_codes (code, partner_id) values
  ('DA-REF-CODE', '88893000-0000-4000-8000-000000000001');

update partner_accounts
   set full_name = 'Cliente Real',
       phone = '+573001112233',
       saved_attribution_code = 'DA-REF-CODE'
 where id = '88893000-0000-4000-8000-000000000031';

update partner_accounts set full_name = 'Visitante Anónimo'
 where id = '88893000-0000-4000-8000-000000000032';

-- CHEMIN 1 — référent : le rattachement vit sur partner_accounts.partner_id, la capacité est portée
-- par l'ORGANISATION (contrainte partner_capabilities_scope), jamais par le compte.
update partner_accounts
   set partner_id = '88893000-0000-4000-8000-000000000001',
       full_name = 'Referente Real'
 where id = '88893000-0000-4000-8000-000000000033';

insert into partner_capabilities (partner_id, role, status, source) values
  ('88893000-0000-4000-8000-000000000001', 'referrer', 'active', 'newr');

-- CHEMIN 2 — admin : capacité portée par le COMPTE, aucun partner_id.
insert into partner_capabilities (account_id, role, status, source) values
  ('88893000-0000-4000-8000-000000000034', 'admin', 'active', 'admin'),
  -- Et l'admin SUSPENDU : la garde ne regarde pas `status`, volontairement (cas 7).
  ('88893000-0000-4000-8000-000000000035', 'admin', 'suspended', 'admin');

update partner_accounts set full_name = 'Admin Real'
 where id = '88893000-0000-4000-8000-000000000034';
update partner_accounts set full_name = 'Admin Suspendido'
 where id = '88893000-0000-4000-8000-000000000035';

-- La commande du client ordinaire : c'est ELLE qui doit survivre intacte (cas 11-12).
insert into orders (id, account_id, holder_name, holder_email, holder_phone) values
  ('88893000-0000-4000-8000-000000000041', '88893000-0000-4000-8000-000000000031',
   'Cliente Real', 'cliente@test.local', '+573001112233');

insert into order_lines (
  id, order_id, account_id, product_id, date, qty, status, holder_name,
  price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
  acompte_cop, referrer_commission_cop, app_commission_cop
) values
  ('88893000-0000-4000-8000-000000000051', '88893000-0000-4000-8000-000000000041',
   '88893000-0000-4000-8000-000000000031', '88893000-0000-4000-8000-000000000021',
   '2028-11-01', 2, 'reserved', 'Cliente Real', 50000, 100000, 'direct', 0.17, 0.10, 0.07,
   17000, 10000, 7000);

-- ---------------------------------------------------------------------------------------------
-- Cas 2-3 : une session anonyme est refusée, et n'écrit rien
-- ---------------------------------------------------------------------------------------------
set local role authenticated;
select test_login('88893000-0000-4000-8000-000000000032');
select is(
  (select public.delete_my_account()->>'reason'),
  'anonymous_session',
  'une session anonyme est refusée — elle n''a pas de compte à supprimer'
);
reset role;
select is(
  (select full_name from partner_accounts where id = '88893000-0000-4000-8000-000000000032'),
  'Visitante Anónimo',
  'et son profil est INCHANGÉ — un refus est aussi une absence d''écriture'
);

-- ---------------------------------------------------------------------------------------------
-- Cas 4-7 : les DEUX chemins du compte professionnel, et l'indifférence au statut
-- ---------------------------------------------------------------------------------------------
set local role authenticated;
select test_login('88893000-0000-4000-8000-000000000033');
select is(
  (select public.delete_my_account()->>'reason'),
  'professional_account',
  'un RÉFÉRENT est refusé — rattachement lu sur partner_accounts.partner_id, jamais sur account_id'
);

select test_login('88893000-0000-4000-8000-000000000034');
select is(
  (select public.delete_my_account()->>'reason'),
  'professional_account',
  'un ADMIN est refusé — capacité portée par le compte lui-même'
);

select test_login('88893000-0000-4000-8000-000000000035');
select is(
  (select public.delete_my_account()->>'reason'),
  'professional_account',
  'une capacité SUSPENDUE bloque aussi — la garde ne regarde pas status (décision de rédaction)'
);
reset role;

select is(
  (select full_name from partner_accounts where id = '88893000-0000-4000-8000-000000000033'),
  'Referente Real',
  'le profil du référent est intact après le refus'
);

-- ---------------------------------------------------------------------------------------------
-- Cas 8-10 : le client ordinaire, lui, est anonymisé
-- ---------------------------------------------------------------------------------------------
set local role authenticated;
select test_login('88893000-0000-4000-8000-000000000031');
select is(
  (select (public.delete_my_account()->>'ok')::boolean),
  true,
  'un client ordinaire est anonymisé'
);
reset role;

select is(
  (select full_name from partner_accounts where id = '88893000-0000-4000-8000-000000000031'),
  null,
  'full_name est effacé'
);
select is(
  (select phone from partner_accounts where id = '88893000-0000-4000-8000-000000000031'),
  null,
  'phone est effacé'
);

-- ---------------------------------------------------------------------------------------------
-- Cas 11-12 : LA COMMANDE EST INTACTE — décision ③, faite exécutable
-- ---------------------------------------------------------------------------------------------
select is(
  (select holder_name || '|' || holder_email || '|' || holder_phone
     from orders where id = '88893000-0000-4000-8000-000000000041'),
  'Cliente Real|cliente@test.local|+573001112233',
  'LA PII DÉNORMALISÉE DE LA COMMANDE EST INTACTE — le prestataire garde de quoi honorer la réservation'
);
select is(
  (select holder_name || '|' || referrer_commission_cop || '|' || app_commission_cop
     from order_lines where id = '88893000-0000-4000-8000-000000000051'),
  'Cliente Real|10000|7000',
  'les commissions figées et le titulaire de la ligne sont intacts — décision ② (le référent garde sa commission)'
);

-- ---------------------------------------------------------------------------------------------
-- Cas 13 : saved_attribution_code est laissé — ce n'est pas une donnée personnelle
-- ---------------------------------------------------------------------------------------------
select is(
  (select saved_attribution_code from partner_accounts where id = '88893000-0000-4000-8000-000000000031'),
  'DA-REF-CODE',
  'saved_attribution_code est conservé — code partenaire, pas une PII (choix documenté dans la migration)'
);

-- ---------------------------------------------------------------------------------------------
-- Cas 14 : idempotence — un second appel ne casse rien
-- ---------------------------------------------------------------------------------------------
set local role authenticated;
select test_login('88893000-0000-4000-8000-000000000031');
select is(
  (select (public.delete_my_account()->>'ok')::boolean),
  true,
  'un SECOND appel sur un compte déjà anonymisé reste ok — l''écran peut retenter sans erreur'
);
reset role;

-- ---------------------------------------------------------------------------------------------
-- Cas 15 : les grants, lus sur l'ACL
-- ---------------------------------------------------------------------------------------------
select is(
  array[
    has_function_privilege('anon', 'public.delete_my_account()', 'EXECUTE'),
    has_function_privilege('authenticated', 'public.delete_my_account()', 'EXECUTE')
  ],
  array[false, true],
  'authenticated seul peut l''exécuter — anon n''a aucun compte à supprimer'
);

select * from finish();
rollback;
