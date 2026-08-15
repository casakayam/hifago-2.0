-- Feature 24 (Admin : offboarding partenaire, workflow 4 étapes) — table partner_offboarding
-- (RPC-only, écriture nominative auditable) + 4 RPC. Chaque colonne horodatée se remplit
-- indépendamment dans l'ordre imposé par les RPC ci-dessous — pas de statut énuméré à maintenir en
-- plus. Étape 2 (honorer les réservations déjà prises) n'a pas de RPC : rien à faire, la
-- dépublication n'annule rien rétroactivement — un non-geste par construction, pas un oubli.
create table partner_offboarding (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references partners(id),
  unpublished_at timestamptz,
  unpublished_by uuid references partner_accounts(id),
  payments_settled_at timestamptz,
  payments_settled_by uuid references partner_accounts(id),
  payments_settled_note text,
  capability_revoked_at timestamptz,
  capability_revoked_by uuid references partner_accounts(id),
  created_at timestamptz not null default now(),
  created_by uuid not null references partner_accounts(id)
);

alter table partner_offboarding enable row level security;
revoke insert, update, delete on partner_offboarding from authenticated, anon;

create policy partner_offboarding_select_admin on partner_offboarding
  for select using ((select is_admin(auth.uid())));

-- 1. start_offboarding — idempotente : un appel répété sur le même partenaire, tant qu'aucun
-- offboarding n'est allé jusqu'à l'étape 4 (capability_revoked_at is null), retourne le même id
-- plutôt que d'en créer un doublon.
create or replace function start_offboarding(p_partner_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not (select public.is_admin(auth.uid())) then
    raise exception 'start_offboarding réservé au rôle admin' using errcode = '42501';
  end if;

  select id into v_id from public.partner_offboarding
   where partner_id = p_partner_id and capability_revoked_at is null;
  if found then
    return jsonb_build_object('ok', true, 'offboarding_id', v_id);
  end if;

  insert into public.partner_offboarding (partner_id, created_by)
  values (p_partner_id, auth.uid())
  returning id into v_id;
  return jsonb_build_object('ok', true, 'offboarding_id', v_id);
end;
$$;

grant execute on function start_offboarding(uuid) to authenticated;

-- 2. offboarding_unpublish — dépublie en masse tous les produits sellable du partenaire. Une seule
-- ligne audit_log consolidée pour l'action groupée, pas une par produit (contrairement à
-- set_product_sellable, feature 4, qui reste ligne par ligne pour un geste individuel) —
-- granularité différente assumée pour une action intrinsèquement collective.
create or replace function offboarding_unpublish(p_offboarding_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_partner_id uuid;
  v_count int;
begin
  if not (select public.is_admin(auth.uid())) then
    raise exception 'offboarding_unpublish réservé au rôle admin' using errcode = '42501';
  end if;

  select partner_id into v_partner_id from public.partner_offboarding where id = p_offboarding_id;
  if not found then
    raise exception 'offboarding introuvable';
  end if;

  update public.products set sellable = false, updated_at = now()
   where partner_id = v_partner_id and sellable = true;
  get diagnostics v_count = row_count;

  update public.partner_offboarding set unpublished_at = now(), unpublished_by = auth.uid()
   where id = p_offboarding_id;

  perform public.log_admin_action(
    'partner.offboarding_unpublish', 'products', null,
    null, jsonb_build_object('partner_id', v_partner_id, 'products_unpublished', v_count), null
  );
  return jsonb_build_object('ok', true, 'products_unpublished', v_count);
end;
$$;

grant execute on function offboarding_unpublish(uuid) to authenticated;

-- 3. offboarding_attest_payments — aucun mécanisme de paiement réel n'existe dans ce backlog (cf.
-- feature 12) : attestation MANUELLE de l'admin, motif obligatoire, pas une vérification calculée.
-- Refuse si l'étape 1 n'est pas faite (unpublished_at is null).
create or replace function offboarding_attest_payments(p_offboarding_id uuid, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_unpublished_at timestamptz;
begin
  if not (select public.is_admin(auth.uid())) then
    raise exception 'offboarding_attest_payments réservé au rôle admin' using errcode = '42501';
  end if;
  if p_note is null or btrim(p_note) = '' then
    raise exception 'motif obligatoire pour attester un règlement';
  end if;

  select unpublished_at into v_unpublished_at from public.partner_offboarding
   where id = p_offboarding_id;
  if not found then
    raise exception 'offboarding introuvable';
  end if;
  if v_unpublished_at is null then
    raise exception 'étape 1 (dépublier) requise avant l''étape 3';
  end if;

  update public.partner_offboarding
     set payments_settled_at = now(), payments_settled_by = auth.uid(), payments_settled_note = p_note
   where id = p_offboarding_id;

  perform public.log_admin_action(
    'partner.offboarding_attest_payments', 'partner_offboarding', p_offboarding_id, null, null, p_note
  );
  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function offboarding_attest_payments(uuid, text) to authenticated;

-- 4. offboarding_revoke_capability — refuse si l'étape 3 n'est pas faite. Suspend UNIQUEMENT les
-- capacités operator de ce partenaire, jamais referrer : un partenaire peut cesser d'être
-- prestataire sans cesser de référer des clients — deux rôles distincts (feature 23). Pas de
-- nouveau statut ajouté à partner_capabilities : réutilise 'suspended' tel quel, le motif porté
-- par log_admin_action distingue une suspension d'offboarding d'une suspension ordinaire.
create or replace function offboarding_revoke_capability(p_offboarding_id uuid, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_partner_id uuid;
  v_payments_settled_at timestamptz;
  v_count int;
begin
  if not (select public.is_admin(auth.uid())) then
    raise exception 'offboarding_revoke_capability réservé au rôle admin' using errcode = '42501';
  end if;

  select partner_id, payments_settled_at into v_partner_id, v_payments_settled_at
    from public.partner_offboarding where id = p_offboarding_id;
  if not found then
    raise exception 'offboarding introuvable';
  end if;
  if v_payments_settled_at is null then
    raise exception 'étape 3 (paiements) requise avant l''étape 4';
  end if;

  update public.partner_capabilities set status = 'suspended', updated_at = now()
   where partner_id = v_partner_id and role = 'operator' and status <> 'suspended';
  get diagnostics v_count = row_count;

  update public.partner_offboarding set capability_revoked_at = now(), capability_revoked_by = auth.uid()
   where id = p_offboarding_id;

  perform public.log_admin_action(
    'partner.offboarding_revoke_capability', 'partner_capabilities', null,
    null, jsonb_build_object('partner_id', v_partner_id, 'capabilities_suspended', v_count), p_note
  );
  return jsonb_build_object('ok', true, 'capabilities_suspended', v_count);
end;
$$;

grant execute on function offboarding_revoke_capability(uuid, text) to authenticated;
