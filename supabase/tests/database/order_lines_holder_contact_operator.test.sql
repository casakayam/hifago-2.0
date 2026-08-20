-- Refonte vue prestataire (2026-08-19) — migration 20260819180000. Lève la restriction "PII
-- minimale" documentée en 20260817180000 : le prestataire voit désormais holder_phone/holder_email
-- sur ses propres réservations, pas seulement holder_name. Ne re-teste jamais la logique métier
-- déjà couverte ailleurs (plafonds, verrouillage, calcul de commission — create_order.test.sql/
-- modify_order_line.test.sql/create_manual_order_line.test.sql) : uniquement les 3 sites touchés
-- par cette migration (create_order, modify_order_line, create_manual_order_line) et la lecture
-- operator via order_lines_select_operator (20260817170000, inchangée, mais jamais vérifiée pour
-- ces deux colonnes jusqu'ici).
begin;
select plan(8);

create function test_login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;
create function test_logout() returns void language sql as $$
  reset request.jwt.claims;
$$;

-- Fixtures : 1 partenaire/établissement, 1 compte operator actif sur cet établissement, 1 produit
-- activité simple. anon crée la réservation "achat client" (create_order) ; op1 crée la réservation
-- manuelle et modifie une ligne existante, et relit tout via order_lines_select_operator.
insert into partners (id, display_name) values
  ('88960000-0000-4000-8000-000000000001', 'Holder Contact Test Partner');
insert into establishments (id, partner_id, name) values
  ('88960000-0000-4000-8000-000000000011', '88960000-0000-4000-8000-000000000001',
   jsonb_build_object('es', 'Establecimiento Holder Contact'));
insert into auth.users (id, email) values
  ('88960000-0000-4000-8000-000000000021', 'holder-contact-op@test.local');
update partner_accounts set partner_id = '88960000-0000-4000-8000-000000000001'
 where id = '88960000-0000-4000-8000-000000000021';
insert into partner_capabilities (partner_id, role, source, status) values
  ('88960000-0000-4000-8000-000000000001', 'referrer', 'migration', 'active');
insert into partner_capabilities (partner_id, role, establishment_id, source, status) values
  ('88960000-0000-4000-8000-000000000001', 'operator', '88960000-0000-4000-8000-000000000011',
   'migration', 'active');

insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug) values
  ('88960000-0000-4000-8000-000000000031', '88960000-0000-4000-8000-000000000001',
   '88960000-0000-4000-8000-000000000011', 'activity',
   jsonb_build_object('es', 'Actividad Holder Contact'), 10000, true, 'holder-contact-activity');
insert into product_availability (product_id, date, capacity, booked) values
  ('88960000-0000-4000-8000-000000000031', '2029-06-01', 10, 0),  -- create_order (anon)
  ('88960000-0000-4000-8000-000000000031', '2029-06-05', 10, 0),  -- create_manual_order_line (operator)
  ('88960000-0000-4000-8000-000000000031', '2029-06-10', 10, 0),  -- modify_order_line, date source
  ('88960000-0000-4000-8000-000000000031', '2029-06-11', 10, 0);  -- modify_order_line, date cible

-- Fixture dédiée à modify_order_line (ligne 'reserved' construite directement, pas via create_order,
-- pour isoler le site modifié dans modify_order_line des autres) — posée ICI, avant tout switch de
-- rôle : orders/order_lines sont RPC-only en écriture (revoke insert sur authenticated/anon), seul
-- le rôle de connexion par défaut de ce fichier (avant tout `set local role`) a le grant nécessaire,
-- même contrainte que les inserts partners/establishments/products ci-dessus.
insert into orders (id, holder_name, holder_email, holder_phone) values
  ('88960000-0000-4000-8000-000000000041', 'Holder Contact Modify', 'holder-contact-modify@hifago.test',
   '+57 300 555 6666');
insert into order_lines (
  id, order_id, product_id, date, qty, status, holder_name, holder_phone, holder_email,
  price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
  acompte_cop, referrer_commission_cop, app_commission_cop
) values (
  '88960000-0000-4000-8000-000000000042', '88960000-0000-4000-8000-000000000041',
  '88960000-0000-4000-8000-000000000031', '2029-06-10', 1, 'reserved',
  'Holder Contact Modify', '+57 300 555 6666', 'holder-contact-modify@hifago.test',
  10000, 10000, 'direct', 0.17, 0, 0.17, 1700, 0, 1700
);

-- ===== create_order : holder_phone/holder_email propagés sur order_lines =========================
-- Résultat non capturé (jamais relu depuis anon, cf. commentaire ci-dessous) — même idiome que
-- create_order.test.sql cas 14a : un simple `select create_order(...)`, sans temp table (une temp
-- table créée sous un rôle ne peut être ni relue ni droppée sous un autre rôle : "must be owner").
select test_logout();
set local role anon;
select create_order(
  jsonb_build_array(jsonb_build_object(
    'product_id', '88960000-0000-4000-8000-000000000031', 'date', '2029-06-01', 'qty', 1
  )),
  'Holder Contact Buyer', 'holder-contact-buyer@hifago.test', '+57 300 111 2222'
);
reset role;

-- Lu via l'operator (RLS order_lines_select_operator) plutôt que le rôle anon qui a écrit la ligne :
-- même piège que create_order.test.sql cas 16 (anon ne peut jamais relire ce qu'il vient d'insérer,
-- account_id = auth.uid() vaut null = null → NULL, pas true) — et ça prouve la lecture operator au
-- passage, exactement le comportement qu'on veut vérifier.
set local role authenticated;
select test_login('88960000-0000-4000-8000-000000000021'); -- operator

select is(
  (select holder_phone from order_lines where product_id = '88960000-0000-4000-8000-000000000031'
    and date = '2029-06-01'),
  '+57 300 111 2222',
  'create_order : holder_phone propagé sur order_lines, lisible par l''operator du même établissement'
);
select is(
  (select holder_email from order_lines where product_id = '88960000-0000-4000-8000-000000000031'
    and date = '2029-06-01'),
  'holder-contact-buyer@hifago.test',
  'create_order : holder_email propagé sur order_lines, lisible par l''operator du même établissement'
);

-- ===== create_manual_order_line : p_holder_phone propagé, holder_email = sentinelle ===============
-- Déjà connecté comme operator ci-dessus.
create temp table tmp_manual_contact as
  select create_manual_order_line(
    '88960000-0000-4000-8000-000000000031', '2029-06-05', 1, 'Holder Contact Manual', null,
    '+57 300 333 4444'
  ) as result;

select is(
  (select holder_phone from order_lines
    where id = (select (result->>'order_line_id')::uuid from tmp_manual_contact)),
  '+57 300 333 4444',
  'create_manual_order_line : p_holder_phone (déjà existant) propagé sur order_lines.holder_phone'
);
select is(
  (select holder_email from order_lines
    where id = (select (result->>'order_line_id')::uuid from tmp_manual_contact)),
  'reserva-manual@hifago.local',
  'create_manual_order_line : order_lines.holder_email reçoit la sentinelle walk-in (aucun email réel collecté)'
);
drop table tmp_manual_contact;

-- ===== modify_order_line : holder_phone/holder_email survivent au remplacement de ligne ===========
-- Fixture posée plus haut (avant le switch de rôle). Toujours connecté comme operator ci-dessus
-- (has_capability sur l'établissement 011 suffit — modify_order_line autorise admin OU operator du
-- même établissement).
create temp table tmp_modify_contact as
  select modify_order_line(
    '88960000-0000-4000-8000-000000000042', '2029-06-11', 1, 'test PII holder_phone/holder_email'
  ) as result;

select is(
  (select status from order_lines where id = '88960000-0000-4000-8000-000000000042'),
  'superseded',
  'modify_order_line : ancienne ligne bien marquée superseded (contrôle du fixture, pas le vrai objet du test)'
);
select is(
  (select holder_phone from order_lines
    where id = (select (result->>'order_line_id')::uuid from tmp_modify_contact)),
  '+57 300 555 6666',
  'modify_order_line : holder_phone copié depuis v_old_line sur la nouvelle ligne de remplacement'
);
select is(
  (select holder_email from order_lines
    where id = (select (result->>'order_line_id')::uuid from tmp_modify_contact)),
  'holder-contact-modify@hifago.test',
  'modify_order_line : holder_email copié depuis v_old_line sur la nouvelle ligne de remplacement'
);
select is(
  (select (result->>'ok')::boolean from tmp_modify_contact),
  true,
  'modify_order_line : appel réussi (contrôle du fixture)'
);
drop table tmp_modify_contact;

select * from finish();
rollback;
