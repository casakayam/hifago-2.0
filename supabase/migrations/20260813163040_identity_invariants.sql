-- Tranche 1 (identité composable) — invariants : trigger operator ⇒ referrer, helpers RLS.
-- Toujours pas de RLS ici (arrive en 0003_identity_rls).

-- Une capacité operator ne peut exister pour un partenaire que si ce même partenaire porte déjà
-- la capacité referrer — invariant métier (socio §3a), auparavant vérifié côté service, désormais
-- garanti en base.
create or replace function enforce_operator_implies_referrer()
returns trigger
language plpgsql
as $$
begin
  if new.role = 'operator' and not exists (
    select 1 from public.partner_capabilities
    where partner_id = new.partner_id
      and role = 'referrer'
  ) then
    raise exception
      'partner_capabilities: la capacité operator requiert une capacité referrer existante pour le partner_id %',
      new.partner_id;
  end if;
  return new;
end;
$$;

create trigger partner_capabilities_operator_implies_referrer
  before insert or update on partner_capabilities
  for each row
  execute function enforce_operator_implies_referrer();

-- Helpers RLS centralisés — STABLE (jamais volatile par défaut), SECURITY DEFINER + search_path
-- vide car ils lisent des tables (partner_capabilities, partner_accounts) qui seront elles-mêmes
-- sous RLS dès 0003_identity_rls. Le bypass RLS est volontaire (c'est tout le sens du helper) et
-- ne re-déclenche donc aucune policy en cascade.
create or replace function is_admin(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.partner_capabilities
    where account_id = uid
      and role = 'admin'
      and status = 'active'
  );
$$;

create or replace function partner_id_for_account(uid uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select partner_id
  from public.partner_accounts
  where id = uid;
$$;
