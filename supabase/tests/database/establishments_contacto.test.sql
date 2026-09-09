-- Spec 30 (Tranche 2) — le contact public d'un établissement, posé par
-- 20260908202000_establishments_contacto_publico.sql.
--
-- Ce fichier tient DEUX choses distinctes, et le mélange serait une erreur :
--   • la CONTRAINTE de format, exercée en `postgres` — en `anon`, une policy refuserait l'écriture
--     avant que la contrainte n'ait son mot à dire, et le test prouverait la policy (leçon du slug
--     réservé, spec 29 §10ter) ;
--   • les DROITS réels d'un visiteur, exercés en `anon` — c'est le seul rôle qui compte pour une
--     colonne qu'on vient de rendre publique.
begin;
select plan(8);

create function test_login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

insert into partners (id, display_name) values
  ('88930000-0000-4000-8000-000000000001', 'Contacto Test Partner');

-- Un vrai compte admin : `update_establishment_contact` est `security invoker` ET journalise via
-- `log_admin_action`, qui refuse tout ce qui n'est pas admin. En `postgres`, `auth.uid()` est nul
-- et la RPC échoue — donc la tester en superuser ne prouverait rien de ce qui se passe en vrai.
insert into auth.users (id, email) values
  ('88930000-0000-4000-8000-000000000031', 'contacto-admin@test.local');
insert into partner_capabilities (account_id, role, source, status) values
  ('88930000-0000-4000-8000-000000000031', 'admin', 'migration', 'active');
insert into establishments (id, partner_id, name, status) values
  ('88930000-0000-4000-8000-000000000011', '88930000-0000-4000-8000-000000000001',
   jsonb_build_object('es', 'Establecimiento Contacto Test'), 'active');
-- Un produit vendable : sans lui, `establishments_select_public` cache l'établissement entier, et
-- les assertions de lecture ci-dessous passeraient pour la mauvaise raison.
insert into products (id, partner_id, establishment_id, type, slug, name, price_cop, sellable) values
  ('88930000-0000-4000-8000-000000000021', '88930000-0000-4000-8000-000000000001',
   '88930000-0000-4000-8000-000000000011', 'activity', 'contacto-test-actividad',
   jsonb_build_object('es', 'Actividad'), 50000, true);

-- ── La contrainte de format, en postgres ───────────────────────────────────────────────────────
select lives_ok(
  $$ update public.establishments set contact_phone = '+573001234567'
      where id = '88930000-0000-4000-8000-000000000011' $$,
  'un numéro E.164 valide est accepté'
);

select throws_ok(
  $$ update public.establishments set contact_phone = '300 123 45 67'
      where id = '88930000-0000-4000-8000-000000000011' $$,
  '23514'::char(5),
  null,
  'un numéro non E.164 est REFUSÉ — sinon wa.me/<numéro> produirait un lien mort, cliquable et vide'
);

select lives_ok(
  $$ update public.establishments set contact_phone = null
      where id = '88930000-0000-4000-8000-000000000011' $$,
  'null reste permis — un établissement sans contact n''affiche simplement pas de bouton'
);

-- ── Les droits réels d'un visiteur anonyme ─────────────────────────────────────────────────────
update public.establishments set contact_phone = '+573001234567'
 where id = '88930000-0000-4000-8000-000000000011';

set local role anon;

-- ⚠️ L'ASSERTION QUI ATTRAPE UN `grant select` OUBLIÉ. `establishments` n'a aucun grant au niveau
-- table pour anon : dix-huit grants colonne par colonne. Sans `grant select (contact_phone)`, ce
-- select lève `permission denied for column` — une erreur qui tombe AVANT la RLS et se confond
-- avec un bug de policy (piège §11.1).
select is(
  (select contact_phone from public.establishments
    where id = '88930000-0000-4000-8000-000000000011'),
  '+573001234567',
  'anon LIT le contact d''un établissement public — le grant select est bien posé'
);

-- ⚠️ ET L'ASSERTION QUI COMPTE LE PLUS. Mesuré le 2026-09-08 : `anon` a le grant UPDATE sur cette
-- colonne, non pas parce qu'on le lui a donné, mais parce qu'une colonne AJOUTÉE hérite des grants
-- au niveau TABLE — et `establishments` en porte pour anon (INSERT/UPDATE/REFERENCES). Le seul
-- rempart est donc la policy `establishments_write_admin`, et rien d'autre. Il faut le prouver,
-- pas l'espérer : c'est exactement ce que CLAUDE.md §3.5 interdit de présenter comme acquis.
-- L'UPDATE ne LÈVE PAS : une policy RLS ne refuse pas, elle ne voit simplement aucune ligne à
-- modifier. C'est exactement ce qui rend ce cas dangereux à supposer — côté client, ça ressemble à
-- un succès.
select lives_ok(
  $$ update public.establishments set contact_phone = '+570000000000'
      where id = '88930000-0000-4000-8000-000000000011' $$,
  'la tentative d''écriture anonyme ne lève aucune erreur — elle est simplement sans effet'
);

select is(
  (select contact_phone from public.establishments
    where id = '88930000-0000-4000-8000-000000000011'),
  '+573001234567',
  'anon N''A RIEN ÉCRIT, malgré un grant UPDATE hérité du niveau table — la RLS tient seule'
);

reset role;

-- ── La RPC d'écriture, dans les conditions réelles : un admin authentifié ──────────────────────
set local role authenticated;
select test_login('88930000-0000-4000-8000-000000000031');
select is(
  public.update_establishment_contact(
    '88930000-0000-4000-8000-000000000011', 'pas-un-numero') ->> 'reason',
  'invalid_phone',
  'la RPC refuse un numéro mal formé par un motif lisible, jamais par une exception SQL'
);

-- Un champ de formulaire vidé vaut « pas de contact », jamais `invalid_phone` : sans ça, effacer le
-- champ dans l'admin renverrait une erreur au lieu de retirer le bouton.
-- ⚠️ L'appel est une instruction À PART, jamais joint à la lecture qui le vérifie : un
-- `select … from (select rpc(…)) t, establishments e` est un CROSS JOIN dont l'ordre d'évaluation
-- n'est pas garanti — la lecture peut précéder l'écriture, et le test échoue pour une raison qui
-- n'existe pas dans le code. Constaté ici même le 2026-09-08.
select public.update_establishment_contact('88930000-0000-4000-8000-000000000011', '   ');

select is(
  (select contact_phone from public.establishments
    where id = '88930000-0000-4000-8000-000000000011'),
  null,
  'une chaîne vide ou blanche EFFACE le contact au lieu d''être refusée'
);

reset role;

select * from finish();
rollback;
