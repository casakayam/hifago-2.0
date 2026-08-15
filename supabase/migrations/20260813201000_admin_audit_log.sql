-- Correctif transverse — journal d'audit admin (audit_log) + helper log_admin_action.
-- Constat (03-cahier-des-charges-admin.md §4) : toute écriture admin doit être auditée, attribuée
-- à l'identité nominative qui l'a faite — c'est ce qui rend l'accès total du rôle admin
-- acceptable. Posé maintenant (avant la feature 4, set_product_sellable) plutôt que différé ; les
-- écritures admin des features 1-3 restent non auditées rétroactivement (dette assumée, cf. plan).
--
-- RPC-only (cf. hifago/CLAUDE.md §3, critère 1 : écriture nominative auditable) : un admin qui
-- pourrait écrire directement dans audit_log pourrait aussi maquiller son propre historique, ce
-- qui viderait l'invariant de son sens.
create table audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references partner_accounts(id),
  action text not null,
  entity_table text not null,
  entity_id uuid not null,
  before jsonb,
  after jsonb,
  note text,
  created_at timestamptz not null default now()
);

create index audit_log_entity_idx on audit_log(entity_table, entity_id);
create index audit_log_actor_idx on audit_log(actor_id, created_at desc);

-- Pas de GRANT explicite : audit_log est créée après le ALTER DEFAULT PRIVILEGES de
-- 20260813163456_identity_rls.sql, qui couvre déjà automatiquement toute table future.
alter table audit_log enable row level security;
revoke insert, update, delete on audit_log from authenticated, anon;

create policy audit_log_select_admin on audit_log
  for select
  using ((select is_admin(auth.uid())));
-- Aucune policy update/delete, y compris pour l'admin : le journal est immuable, une correction
-- se fait par une nouvelle entrée, jamais en réécrivant l'historique.

-- Helper centralisé, réutilisable par toute future RPC admin qui écrit et journalise (features 5,
-- 9, 10, 16, 22-25). Auto-gardée par son propre contrôle is_admin() plutôt que dépendante de
-- l'appelant : ça permet de la grant execute largement à authenticated sans risque de forgerie —
-- n'importe quelle future RPC admin (security invoker comme security definer) peut l'appeler en
-- confiance, sans dupliquer un contrôle d'accès à chaque fois.
create or replace function log_admin_action(
  p_action text,
  p_entity_table text,
  p_entity_id uuid,
  p_before jsonb default null,
  p_after jsonb default null,
  p_note text default null
)
returns void
language plpgsql
security definer         -- obligatoire : contourne RLS pour écrire dans audit_log (RPC-only)
set search_path = ''     -- obligatoire : jamais omis sur une fonction SECURITY DEFINER
as $$
begin
  if not (select public.is_admin(auth.uid())) then
    raise exception 'log_admin_action réservé au rôle admin' using errcode = '42501';
  end if;

  insert into public.audit_log (actor_id, action, entity_table, entity_id, before, after, note)
  values ((select auth.uid()), p_action, p_entity_table, p_entity_id, p_before, p_after, p_note);
end;
$$;

-- Le privilège par défaut sur une fonction créée par le rôle postgres n'inclut pas EXECUTE pour
-- anon/authenticated (cf. hifago/CLAUDE.md §11) — accordé explicitement à authenticated seul (pas
-- de rôle admin dédié côté Postgres : le contrôle d'accès est interne à la fonction elle-même).
grant execute on function log_admin_action(text, text, uuid, jsonb, jsonb, text) to authenticated;
