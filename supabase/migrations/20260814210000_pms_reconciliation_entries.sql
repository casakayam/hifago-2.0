create table pms_reconciliation_entries (
  id uuid primary key default gen_random_uuid(),
  order_line_id uuid not null references order_lines(id),
  status text not null default 'open' check (status in ('open','retrying','resolved','permanently_failed')),
  attempts int not null default 0,
  last_attempt_at timestamptz,
  resolution_note text,
  resolved_by uuid references partner_accounts(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
alter table pms_reconciliation_entries enable row level security;
revoke insert, update, delete on pms_reconciliation_entries from authenticated, anon;
create policy pms_reconciliation_entries_select_admin on pms_reconciliation_entries
  for select using ((select is_admin(auth.uid())));

create or replace function resolve_reconciliation_entry(p_entry_id uuid, p_note text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_status text;
begin
  if not (select public.is_admin(auth.uid())) then
    raise exception 'resolve_reconciliation_entry réservé au rôle admin' using errcode = '42501';
  end if;
  if p_note is null or btrim(p_note) = '' then
    raise exception 'motif obligatoire pour résoudre une entrée';
  end if;
  select status into v_status from public.pms_reconciliation_entries where id = p_entry_id for update;
  if not found then raise exception 'entrée introuvable'; end if;
  if v_status not in ('open', 'retrying') then
    raise exception 'entrée déjà traitée (statut %)', v_status;
  end if;
  update public.pms_reconciliation_entries
     set status = 'resolved', resolution_note = p_note, resolved_by = auth.uid(), resolved_at = now()
   where id = p_entry_id;
  perform public.log_admin_action('reconciliation.resolve', 'pms_reconciliation_entries', p_entry_id, null, null, p_note);
  return jsonb_build_object('ok', true);
end; $$;
grant execute on function resolve_reconciliation_entry(uuid, text) to authenticated;
