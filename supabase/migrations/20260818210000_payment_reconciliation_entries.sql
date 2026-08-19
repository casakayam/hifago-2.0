-- Spec 19 §0 Tranche 1 — file de retry pour les webhooks Mercado Pago non traités avec succès.
-- Miroir structurel de pms_reconciliation_entries (20260814210000) : mêmes 4 statuts, même
-- discipline (admin résout avec motif obligatoire). payment_id nullable : un webhook peut échouer
-- AVANT même d'avoir pu être corrélé à un `payments` connu (external_reference absent/invalide,
-- p_status inattendu) — une entrée reste créée dans tous les cas, jamais un échec silencieux.
create table payment_reconciliation_entries (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid references payments(id),
  mp_payment_id text,
  external_reference text,
  raw_event jsonb not null,
  failure_reason text not null,
  status text not null default 'open' check (status in ('open','retrying','resolved','permanently_failed')),
  attempts int not null default 0,
  last_attempt_at timestamptz,
  resolution_note text,
  resolved_by uuid references partner_accounts(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
alter table payment_reconciliation_entries enable row level security;
revoke insert, update, delete on payment_reconciliation_entries from authenticated, anon;
-- INSERT : jamais via une RPC dédiée — le Route Handler webhook écrit directement avec le client
-- service_role (bypass RLS + grants par défaut déjà accordés à service_role, cf.
-- 20260813163456_identity_rls.sql). Aucun utilisateur authentifié n'a jamais besoin d'insérer ici.
create policy payment_reconciliation_entries_select_admin on payment_reconciliation_entries
  for select using ((select is_admin(auth.uid())));

create or replace function resolve_payment_reconciliation_entry(p_entry_id uuid, p_note text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_status text;
begin
  if not (select public.is_admin(auth.uid())) then
    raise exception 'resolve_payment_reconciliation_entry réservé au rôle admin' using errcode = '42501';
  end if;
  if p_note is null or btrim(p_note) = '' then
    raise exception 'motif obligatoire pour résoudre une entrée';
  end if;
  select status into v_status from public.payment_reconciliation_entries where id = p_entry_id for update;
  if not found then raise exception 'entrée introuvable'; end if;
  if v_status not in ('open', 'retrying') then
    raise exception 'entrée déjà traitée (statut %)', v_status;
  end if;
  update public.payment_reconciliation_entries
     set status = 'resolved', resolution_note = p_note, resolved_by = auth.uid(), resolved_at = now()
   where id = p_entry_id;
  perform public.log_admin_action(
    'payment_reconciliation.resolve', 'payment_reconciliation_entries', p_entry_id, null, null, p_note
  );
  return jsonb_build_object('ok', true);
end; $$;
grant execute on function resolve_payment_reconciliation_entry(uuid, text) to authenticated;
