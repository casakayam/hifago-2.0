-- L'invariant que les deux failles du 2026-08-27 ont rendu nécessaire, et qui les aurait toutes
-- attrapées : TOUTE fonction SECURITY DEFINER de `public` exposée à `anon` ou `authenticated` doit
-- porter un garde interne — sinon la RLS ne la rattrape pas (elle s'exécute avec les droits du
-- propriétaire) et le seul rempart devient un grant, qui se perd en silence.
--
-- Ce test remplace le point (5) laissé non automatisé dans rls_rpc_only_checklist.test.sql : il ne
-- demande plus de convention de marquage, il déduit le garde de la source (is_admin, auth.uid,
-- has_capability) et exige que toute exception soit NOMMÉE ici, avec sa raison.
--
-- Exclues à juste titre : les fonctions `returns trigger`, que Postgres refuse d'appeler
-- directement et que PostgREST n'expose pas.
--
-- ⚠️ Ajouter un nom à la liste ci-dessous n'est PAS une formalité : c'est déclarer qu'une fonction
-- exécutable par n'importe quel visiteur, avec les droits du propriétaire, est sans danger. Le
-- faire seulement après avoir lu son corps.

begin;
select plan(1);

select is(
  (
    select coalesce(string_agg(p.oid::regprocedure::text, ', ' order by p.proname), '')
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and pg_get_function_result(p.oid) <> 'trigger'
      and (
        has_function_privilege('anon', p.oid, 'EXECUTE')
        or has_function_privilege('authenticated', p.oid, 'EXECUTE')
      )
      and p.prosrc !~* 'is_admin\s*\('
      and p.prosrc !~* 'auth\.uid\s*\('
      and p.prosrc !~* 'has_capability\s*\('
      and p.proname not in (
        -- Prédicats appelés DANS des policies RLS : une policy s'évalue avec les droits du rôle
        -- appelant, donc leur EXECUTE par anon/authenticated est nécessaire au fonctionnement de
        -- la RLS elle-même. Toutes en lecture seule.
        'is_admin',
        'has_admin_capability',
        'has_capability',
        'partner_id_for_account',
        'establishment_slug_from_name',
        -- Publique par conception : vérifie un jeton d'invitation AVANT toute inscription, donc
        -- nécessairement appelable sans compte (spec 05).
        'check_partner_invitation'
      )
  ),
  '',
  'toute RPC SECURITY DEFINER exposée à anon/authenticated a un garde interne, ou figure dans la liste des exceptions justifiées'
);

select * from finish();
rollback;
