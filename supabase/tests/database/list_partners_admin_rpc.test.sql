-- Revue admin partenaires (Jérôme, 2026-08-19) — RPC list_partners_admin. Couvre : appel non-admin
-- refusé, recherche unifiée nom+email, filtre role (sans condition de statut, comportement
-- préexistant reproduit à l'identique), filtre city, establishments_count, active_roles
-- (statut='active' seulement), filtre par rayon (inclusion/exclusion), garde-fou partenaire sans
-- coordonnées (exclu si rayon actif, visible sinon), pagination.
--
-- Fixtures marquées 'QAPARTLIST' pour scoper la recherche indépendamment des données de
-- supabase/seed.sql déjà présentes sur cette instance locale partagée.
--
-- partners.status retiré le 2026-08-20 (migration 20260820050000_partners_drop_status.sql, aucun
-- besoin métier au niveau du partenaire entier — cf. son commentaire de tête) : fixture P4
-- "archivado" et les 2 assertions du filtre p_status supprimées avec, plan 13→11.
begin;
select plan(11);

create function test_login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

insert into auth.users (id, email) values
  ('f0000000-0000-4000-8000-000000000001', 'partlist-admin@test.local'),
  ('f0900000-0000-4000-8000-000000000001', 'partlist-stranger@test.local');

insert into partner_capabilities (account_id, role, source, status) values
  ('f0000000-0000-4000-8000-000000000001', 'admin', 'migration', 'active');

-- P1 "Cerca" — 2 établissements, ville Medellín, coordonnées connues.
insert into partners (id, display_name, email, partner_city) values
  ('f0100000-0000-4000-8000-000000000001', 'Cerca QAPARTLIST',
   'cerca.qapartlist@test.local', 'Medellín QAPARTLIST');
insert into establishments (id, partner_id, name) values
  ('f0100000-0000-4000-8000-000000000002', 'f0100000-0000-4000-8000-000000000001',
   jsonb_build_object('es', 'Establecimiento Cerca 1 QAPARTLIST')),
  ('f0100000-0000-4000-8000-000000000003', 'f0100000-0000-4000-8000-000000000001',
   jsonb_build_object('es', 'Establecimiento Cerca 2 QAPARTLIST'));

-- P2 "Lejos" — coordonnées à ~11.12km de P1 (0.1° de latitude, cf. haversine_km déjà vérifié
-- empiriquement : 2 points à 0.1° de latitude ⇒ ≈11.12km).
insert into partners (id, display_name, partner_city) values
  ('f0200000-0000-4000-8000-000000000001', 'Lejos QAPARTLIST', 'Medellín QAPARTLIST');

-- P3 "Sin Coordenadas" — AUCUNE ligne partner_crm_profile (cas réel : 31/32 partenaires
-- aujourd'hui). Doit rester visible sans filtre de rayon, disparaître avec.
insert into partners (id, display_name) values
  ('f0300000-0000-4000-8000-000000000001', 'Sin Coordenadas QAPARTLIST');

-- P4 — capacité referrer ACTIVE (apparaît dans active_roles) + capacité operator SUSPENDED
-- (n'apparaît PAS dans active_roles, mais DOIT quand même matcher le filtre p_role='operator',
-- comportement préexistant reproduit à l'identique — le filtre ne conditionne jamais le statut).
insert into partners (id, display_name) values
  ('f0500000-0000-4000-8000-000000000001', 'ConRoles QAPARTLIST');

-- partner_crm_profile et partner_capabilities sont RPC-only (grants révoqués) : fixtures posées
-- sous le rôle par défaut (postgres), avant tout `set local role authenticated`.
insert into partner_crm_profile (partner_id, lat, lon) values
  ('f0100000-0000-4000-8000-000000000001', 6.2, -75.5),
  ('f0200000-0000-4000-8000-000000000001', 6.3, -75.5);

insert into partner_capabilities (partner_id, role, source, status) values
  ('f0500000-0000-4000-8000-000000000001', 'referrer', 'newp', 'active'),
  ('f0500000-0000-4000-8000-000000000001', 'operator', 'newp', 'suspended');

set local role authenticated;

-- appel non-admin → exception -------------------------------------------------------------------
select test_login('f0900000-0000-4000-8000-000000000001');
select throws_ok(
  $$ select * from list_partners_admin() $$,
  '42501'::char(5), null, 'list_partners_admin refuse un appelant non-admin'
);

select test_login('f0000000-0000-4000-8000-000000000001');

-- recherche unifiée nom + email ------------------------------------------------------------------
select is(
  (select id from list_partners_admin(p_search => 'Cerca QAPARTLIST')),
  'f0100000-0000-4000-8000-000000000001'::uuid,
  'recherche par nom trouve le partenaire attendu'
);
select is(
  (select id from list_partners_admin(p_search => 'cerca.qapartlist@test.local')),
  'f0100000-0000-4000-8000-000000000001'::uuid,
  'recherche par email trouve le même partenaire'
);

-- filtre city -----------------------------------------------------------------------------------
select is(
  (select id from list_partners_admin(p_search => 'Cerca QAPARTLIST', p_city => 'Medellín QAPARTLIST')),
  'f0100000-0000-4000-8000-000000000001'::uuid,
  'filtre city trouve le partenaire correspondant'
);

-- filtre role (sans condition de statut) + active_roles (statut=active seulement) ------------
select is(
  (select id from list_partners_admin(p_search => 'ConRoles QAPARTLIST', p_role => 'operator')),
  'f0500000-0000-4000-8000-000000000001'::uuid,
  'filtre role=operator trouve le partenaire même si sa capacité operator est suspended (comportement préexistant)'
);
select is(
  (select active_roles from list_partners_admin(p_search => 'ConRoles QAPARTLIST')),
  'referrer',
  'active_roles ne montre que la capacité active (referrer), jamais la capacité operator suspended'
);

-- establishments_count -----------------------------------------------------------------------
select is(
  (select establishments_count from list_partners_admin(p_search => 'Cerca QAPARTLIST')),
  2,
  'establishments_count reflète les 2 établissements du partenaire'
);

-- filtre par rayon ----------------------------------------------------------------------------
select ok(
  (select count(*) from list_partners_admin(p_search => 'QAPARTLIST', p_lat => 6.2, p_lon => -75.5, p_radius_km => 15))::int >= 2,
  'rayon 15km depuis P1 inclut P2 (≈11.12km)'
);
select is(
  (select count(*) from list_partners_admin(
    p_search => 'Lejos QAPARTLIST', p_lat => 6.2, p_lon => -75.5, p_radius_km => 10
  ))::int,
  0,
  'rayon 10km depuis P1 exclut P2 (≈11.12km, hors rayon)'
);

-- garde-fou partenaire sans coordonnées --------------------------------------------------------
select is(
  (select count(*) from list_partners_admin(
    p_search => 'Sin Coordenadas QAPARTLIST', p_lat => 6.2, p_lon => -75.5, p_radius_km => 50
  ))::int,
  0,
  'partenaire sans coordonnées exclu quand le filtre rayon est actif (pas de preuve qu''il est dans le rayon)'
);
select is(
  (select count(*) from list_partners_admin(p_search => 'Sin Coordenadas QAPARTLIST'))::int,
  1,
  'partenaire sans coordonnées reste visible quand le filtre rayon n''est PAS actif (garde LEFT JOIN)'
);

select * from finish();
rollback;
