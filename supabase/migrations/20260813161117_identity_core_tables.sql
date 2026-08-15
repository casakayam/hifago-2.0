-- Tranche 1 (identité composable) — création des tables, sans RLS ni triggers.
-- Les invariants (operator ⇒ referrer, helpers is_admin/partner_id_for_account) arrivent en
-- 0002_identity_invariants, la RLS/RPC-only en 0003_identity_rls (cf. plan de développement).

create table partners (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null default 'organization' check (entity_type in ('person', 'organization')),
  display_name text not null,
  legal_name text,
  identification_type text,
  identification_number text,
  partner_city text,
  email text,
  phone text,
  status text not null default 'active' check (status in ('active', 'suspended', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Identité de connexion : miroir 1:1 de auth.users, jamais de mot de passe/hash ici (délégué à
-- Supabase Auth). partner_id nullable : un compte peut être un simple client ou un admin sans
-- organisation partenaire rattachée.
create table partner_accounts (
  id uuid primary key references auth.users(id) on delete cascade,
  partner_id uuid references partners(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index partner_accounts_partner_id_idx on partner_accounts(partner_id);

-- Capacités composables. Une capacité referrer/operator est portée par l'organisation (tous les
-- comptes rattachés au partner_id y ont un accès égal, cf. note différée de la Tranche 1) ; la
-- capacité admin est portée par le compte lui-même, sans organisation nécessaire.
create table partner_capabilities (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid references partners(id),
  account_id uuid references partner_accounts(id),
  role text not null check (role in ('referrer', 'operator', 'admin')),
  status text not null default 'onboarding'
    check (status in ('onboarding', 'pending_review', 'active', 'suspended')),
  source text not null check (source in ('newp', 'newr', 'self_upgrade', 'admin', 'migration')),
  onboarding_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint partner_capabilities_scope check (
    (role = 'admin' and partner_id is null and account_id is not null)
    or (role in ('referrer', 'operator') and partner_id is not null and account_id is null)
  )
);

create unique index partner_capabilities_partner_role_idx
  on partner_capabilities(partner_id, role) where partner_id is not null;
create unique index partner_capabilities_account_role_idx
  on partner_capabilities(account_id, role) where account_id is not null;

-- Code partenaire (ex-code promo). partner_id nullable : un code peut être pré-créé/whitelisté
-- pour une invitation avant que le partenaire n'existe (cf. /newp, /newr), puis attribué à la
-- consommation de l'invitation.
create table partner_codes (
  code text primary key,
  partner_id uuid references partners(id),
  commission_enabled boolean not null default true,
  active boolean not null default true,
  attribution jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index partner_codes_partner_id_idx on partner_codes(partner_id);

-- Invitation à token opaque : seul le hash est stocké, jamais le secret brut.
create table partner_invitations (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  promo_code text not null references partner_codes(code),
  onboarding_path text not null check (onboarding_path in ('referrer', 'provider')),
  partner_hint jsonb,
  status text not null default 'pending'
    check (status in ('pending', 'consumed', 'revoked', 'expired')),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  consumed_by_account_id uuid references partner_accounts(id),
  created_by uuid references partner_accounts(id),
  created_at timestamptz not null default now()
);

create index partner_invitations_promo_code_status_idx on partner_invitations(promo_code, status);

-- Acceptation de contrat par rôle, nominative (qui a accepté, pas seulement quelle organisation).
create table role_agreements (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references partners(id),
  account_id uuid not null references partner_accounts(id),
  role text not null check (role in ('referrer', 'operator')),
  document_version text not null,
  document_hash text,
  signer_name text not null,
  explicit_consent boolean not null default false,
  accepted_at timestamptz not null default now(),
  ip text,
  user_agent text,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index role_agreements_partner_role_idx on role_agreements(partner_id, role);
