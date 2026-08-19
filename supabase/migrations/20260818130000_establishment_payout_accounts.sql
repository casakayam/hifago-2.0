-- Spec 19 §0 Tranche 0 — coordonnées de règlement de la compensation no-show établissement
-- (Bancolombia/Nequi, canal inchangé — §10 point 9). Forme `bank jsonb` alignée sur
-- partner_crm_profile.bank (20260814233000_partner_direct_creation.sql :
-- {nombre, bancolombia?, nequi?, received_at}), pas une reprise en colonnes séparées.
--
-- Financier, à auditer nominativement → RPC-only, même raisonnement que ledger_entries. Rempli via
-- un chemin ADMIN UNIQUEMENT (décision de session, spec 19 §3) — pas d'écran self-service dans
-- cette tranche, cf. spec 19 §5 (aucun écran établissement listé).
create table establishment_payout_accounts (
  establishment_id uuid primary key references establishments(id),
  bank jsonb not null,
  updated_at timestamptz not null default now()
);

alter table establishment_payout_accounts enable row level security;
revoke insert, update, delete on establishment_payout_accounts from authenticated, anon;

create policy establishment_payout_accounts_select_admin on establishment_payout_accounts
  for select using ((select is_admin(auth.uid())));

-- RPC nécessaire pour que la table ne reste pas un schéma mort : la spec 19 §0 Tranche 0 décrit la
-- table mais n'avait pas figé son propre mécanisme d'écriture — comblé ici (gap trouvé en codant,
-- pas un point à trancher : admin-only, security definer, upsert, même style que
-- mark_ledger_entry_paid). Motif obligatoire (même exigence que set_order_line_status,
-- resolve_reconciliation_entry) : une donnée financière change toujours avec une trace.
create or replace function set_establishment_payout_account(
  p_establishment_id uuid,
  p_bank jsonb,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (select public.is_admin(auth.uid())) then
    raise exception 'set_establishment_payout_account réservé au rôle admin' using errcode = '42501';
  end if;

  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'motif obligatoire pour enregistrer des coordonnées de paiement';
  end if;

  if not exists (select 1 from public.establishments where id = p_establishment_id) then
    raise exception 'établissement introuvable';
  end if;

  insert into public.establishment_payout_accounts (establishment_id, bank, updated_at)
  values (p_establishment_id, p_bank, now())
  on conflict (establishment_id) do update
    set bank = excluded.bank, updated_at = now();

  perform public.log_admin_action(
    'establishment_payout_account.set', 'establishment_payout_accounts', p_establishment_id,
    null, jsonb_build_object('bank_keys', (select jsonb_agg(k) from jsonb_object_keys(p_bank) k)),
    p_reason
  );

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function set_establishment_payout_account(uuid, jsonb, text) to authenticated;
