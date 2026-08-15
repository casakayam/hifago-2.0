-- Tranche 1 (identité composable) — RLS activée sur toutes les tables du socle identité.
--
-- Constat local (vérifié empiriquement) : les tables créées par les migrations sont détenues par
-- le rôle `postgres`, pas `supabase_admin` — le privilège par défaut de `postgres` sur le schéma
-- public n'inclut ni SELECT ni INSERT/UPDATE/DELETE pour anon/authenticated (seulement
-- REFERENCES/TRIGGER/TRUNCATE/MAINTAIN), contrairement à l'hypothèse habituelle « grants larges +
-- RLS comme seule vraie porte ». Sans le GRANT explicite ci-dessous, une policy RLS ne suffit pas
-- à elle seule : la requête échoue en permission denied avant même que RLS ne s'applique. On
-- restaure ici le posture standard Supabase pour toute future table (ALTER DEFAULT PRIVILEGES),
-- puis on l'applique explicitement aux tables déjà créées par 0001 (non rétroactif).
alter default privileges for role postgres in schema public
  grant select, insert, update, delete on tables to anon, authenticated, service_role;

-- partners : RLS directe. Lecture propre organisation + miroir admin. Écriture réservée à
-- l'admin, sauf mise à jour de sa propre fiche par l'organisation elle-même.
grant select, insert, update, delete on partners to authenticated;
alter table partners enable row level security;

create policy partners_select on partners
  for select
  using (
    (select is_admin(auth.uid()))
    or id = (select partner_id_for_account(auth.uid()))
  );

create policy partners_insert_admin on partners
  for insert
  with check ((select is_admin(auth.uid())));

-- Pas de with check explicite : Postgres réutilise la clause using comme with check par
-- défaut pour une policy update quand elles sont identiques.
create policy partners_update on partners
  for update
  using (
    (select is_admin(auth.uid()))
    or id = (select partner_id_for_account(auth.uid()))
  );

create policy partners_delete_admin on partners
  for delete
  using ((select is_admin(auth.uid())));

-- partner_accounts : RLS directe en lecture (propre compte + miroir admin). Aucune policy
-- d'écriture : la ligne est créée par le trigger de provisioning (SECURITY DEFINER, contourne la
-- RLS) et partner_id ne doit jamais être modifiable directement par le titulaire du compte
-- (sans quoi n'importe qui pourrait s'auto-attribuer les données d'un autre partenaire) — son
-- changement passe exclusivement par une RPC (consume_partner_invitation, 0004).
grant select on partner_accounts to authenticated;
alter table partner_accounts enable row level security;

create policy partner_accounts_select on partner_accounts
  for select
  using (
    id = (select auth.uid())
    or (select is_admin(auth.uid()))
  );

-- partner_capabilities : RPC-only (écriture auditable + admin nullable = cas d'école de
-- l'invariant, cf. hifago/CLAUDE.md §3). Lecture : admin, le titulaire de la capacité (admin
-- personnelle), ou tout compte rattaché au partenaire concerné (accès égal au sein d'une même
-- organisation, cf. note différée de la Tranche 1).
grant select on partner_capabilities to authenticated;
alter table partner_capabilities enable row level security;
revoke insert, update, delete on partner_capabilities from authenticated, anon;

create policy partner_capabilities_select on partner_capabilities
  for select
  using (
    (select is_admin(auth.uid()))
    or account_id = (select auth.uid())
    or partner_id = (select partner_id_for_account(auth.uid()))
  );

-- partner_invitations : RPC-only. Le token n'est jamais lisible en clair (seul token_hash est
-- stocké) et la ligne elle-même n'est lisible que par l'admin — un invité consomme son invitation
-- via la RPC (0004), qui hash le token présenté et contourne la RLS, sans jamais avoir besoin de
-- lister la table.
grant select on partner_invitations to authenticated;
alter table partner_invitations enable row level security;
revoke insert, update, delete on partner_invitations from authenticated, anon;

create policy partner_invitations_select_admin on partner_invitations
  for select
  using ((select is_admin(auth.uid())));

-- role_agreements : RPC-only (écriture nominative auditable). Lecture : admin ou le signataire
-- lui-même.
grant select on role_agreements to authenticated;
alter table role_agreements enable row level security;
revoke insert, update, delete on role_agreements from authenticated, anon;

create policy role_agreements_select on role_agreements
  for select
  using (
    (select is_admin(auth.uid()))
    or account_id = (select auth.uid())
  );

-- partner_codes : lecture publique (un code doit être vérifiable avant inscription), écriture
-- RPC-only.
grant select on partner_codes to anon, authenticated;
alter table partner_codes enable row level security;
revoke insert, update, delete on partner_codes from authenticated, anon;

create policy partner_codes_select_public on partner_codes
  for select
  using (true);
