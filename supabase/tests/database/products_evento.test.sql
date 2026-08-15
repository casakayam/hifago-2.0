-- Feature 21 (Admin : créer une fiche evento, vitrine) — contraintes posées sur products par
-- 20260814190000_products_evento_vitrine.sql, seule source de vérité. Aucune RPC ici (RLS-directe
-- admin, products_write_admin déjà en place) — ces tests exercent uniquement les CHECK constraints
-- au niveau schéma, en tant que postgres (superuser, contourne RLS), pas un scénario RLS/RPC.
begin;
select plan(4);

insert into partners (id, display_name) values
  ('88910000-0000-4000-8000-000000000001', 'Evento Test Partner');
insert into establishments (id, partner_id, name) values
  ('88910000-0000-4000-8000-000000000011', '88910000-0000-4000-8000-000000000001',
   jsonb_build_object('es', 'Establecimiento Evento Test'));

-- Cas 1 : recurrence_end_date et recurrence_end_count posés simultanément → rejeté (les 2
-- conditions de fin sont mutuellement exclusives — la 3e condition, indéfini, c'est aucune des
-- deux posée).
select throws_ok(
  $$ insert into products (
       partner_id, establishment_id, type, name, sellable, slug,
       occurrence_type, recurrence_frequency_days, recurrence_end_date, recurrence_end_count
     ) values (
       '88910000-0000-4000-8000-000000000001', '88910000-0000-4000-8000-000000000011',
       'evento', jsonb_build_object('es', 'Evento Fin Incohérent'), false, 'evento-fin-incoherent',
       'recurring', 7, '2028-12-31', 5
     ) $$,
  '23514'::char(5),
  null,
  'recurrence_end_date et recurrence_end_count posés ensemble → rejeté (products_recurrence_end_shape)'
);

-- Cas 2 : type='evento' avec price_cop null → accepté (contrainte conditionnelle). Récurrent sans
-- aucune des deux conditions de fin (indéfini) en prime — la 3e forme valide.
select lives_ok(
  $$ insert into products (
       partner_id, establishment_id, type, name, sellable, slug,
       occurrence_type, recurrence_frequency_days
     ) values (
       '88910000-0000-4000-8000-000000000001', '88910000-0000-4000-8000-000000000011',
       'evento', jsonb_build_object('es', 'Evento Vitrine Valide'), false, 'evento-vitrine-valide',
       'recurring', 7
     ) $$,
  'type=evento, price_cop null, récurrent indéfini → accepté'
);
select is(
  (select price_cop from products where slug = 'evento-vitrine-valide'),
  null::bigint,
  'cas 2 : price_cop reste bien null après insertion (pas de valeur par défaut silencieuse)'
);

-- Cas 3 : type='camp' avec price_cop null → toujours rejeté (la contrainte conditionnelle ne
-- s'applique qu'à evento — pas de régression sur les autres types, camp y compris, tout juste
-- ajouté à products_type_check par cette même migration).
select throws_ok(
  $$ insert into products (
       partner_id, establishment_id, type, name, sellable, slug
     ) values (
       '88910000-0000-4000-8000-000000000001', '88910000-0000-4000-8000-000000000011',
       'camp', jsonb_build_object('es', 'Camp Sans Prix'), false, 'camp-sans-prix'
     ) $$,
  '23514'::char(5),
  null,
  'type=camp, price_cop null → toujours rejeté (products_price_cop_required_unless_evento)'
);

select * from finish();
rollback;
