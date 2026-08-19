-- Spec 19 §0 Tranche 0 — repli manuel de règlement d'une créance ledger (référent ou compensation
-- établissement) : admin-only, même style que resolve_reconciliation_entry (20260814210000).
-- p_comprobante_path reste un texte libre (URL/chemin) dans cette tranche — aucune infrastructure
-- d'upload nouvelle n'est requise par la spec 19 §5 (aucun écran d'upload dédié listé) ; l'écran
-- admin (ci-après) se contente d'un champ texte, cohérent avec la simplicité déjà acceptée pour
-- resolve_reconciliation_entry (une simple note, pas de fichier).
create or replace function mark_ledger_entry_paid(
  p_ledger_entry_id uuid,
  p_comprobante_path text,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  if not (select public.is_admin(auth.uid())) then
    raise exception 'mark_ledger_entry_paid réservé au rôle admin' using errcode = '42501';
  end if;

  if p_note is null or btrim(p_note) = '' then
    raise exception 'motif obligatoire pour marquer une créance payée';
  end if;

  select status into v_status from public.ledger_entries where id = p_ledger_entry_id for update;

  if not found then
    raise exception 'entrée de ledger introuvable';
  end if;

  if v_status <> 'due' then
    raise exception 'entrée déjà traitée ou non exigible (statut %)', v_status;
  end if;

  update public.ledger_entries
     set status = 'paid', comprobante_path = p_comprobante_path, note = p_note, paid_at = now()
   where id = p_ledger_entry_id;

  perform public.log_admin_action(
    'ledger_entry.mark_paid', 'ledger_entries', p_ledger_entry_id,
    jsonb_build_object('status', 'due'), jsonb_build_object('status', 'paid'), p_note
  );

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function mark_ledger_entry_paid(uuid, text, text) to authenticated;
