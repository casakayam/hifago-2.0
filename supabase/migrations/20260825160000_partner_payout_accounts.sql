-- Demande Jérôme (2026-08-25) : un referrer doit pouvoir renseigner lui-même son compte Mercado
-- Pago pour recevoir sa commission — jusqu'ici aucun mécanisme n'existait, ni self-service ni
-- admin (cf. hifago/docs/specs/19-paiement-mercadopago-acompte-ledger.md §10 point 7 : table
-- dédiée `partner_payout_accounts`, RPC-only, miroir de `establishment_payout_accounts`, jamais
-- construite — seule sa jumelle établissement l'avait été, admin-only).
--
-- Décisions prises avec Jérôme pour CETTE tranche (au-delà de ce que la spec 19 avait tranché) :
-- écran self-service (pas de moderation, contrairement à establishment_payout_accounts qui reste
-- admin-only) ; application immédiate, pas de circuit d'approbation ; un seul champ, l'identifiant
-- Mercado Pago (texte libre — email/CVU/alias selon ce que Mercado Pago attend, jamais interprété
-- ni validé côté hifago), pas les coordonnées Bancolombia/Nequi de partner_crm_profile.bank
-- (canaux distincts, jamais fusionnés).
--
-- Portée niveau `partner_id` (l'organisation), pas `account_id` (l'individu qui se connecte) —
-- même raisonnement que partner_crm_profile/establishment_payout_accounts : un compte de paiement
-- appartient à l'organisation, jamais à un login individuel, même si plusieurs comptes partagent
-- ce même partner_id (accès égal, 0001).
create table partner_payout_accounts (
  partner_id uuid primary key references partners(id),
  mercadopago_account text not null,
  updated_at timestamptz not null default now()
);

-- RPC-only : financier, self-service, mais jamais de policy RLS d'écriture directe — même
-- raisonnement que partner_accounts (identity_rls) et establishment_payout_accounts. Deux
-- policies SELECT (propriétaire ET admin) : contrairement à la table établissement, ici le
-- partenaire doit pouvoir relire sa propre valeur pour préremplir l'écran "Mi cuenta".
alter table partner_payout_accounts enable row level security;
revoke insert, update, delete on partner_payout_accounts from authenticated, anon;

create policy partner_payout_accounts_select_own on partner_payout_accounts
  for select using (partner_id = (select partner_id_for_account(auth.uid())));

create policy partner_payout_accounts_select_admin on partner_payout_accounts
  for select using ((select is_admin(auth.uid())));

-- Écriture self-service : le seul écart volontaire par rapport au squelette
-- set_establishment_payout_account (admin-only, motif obligatoire, log_admin_action) — pas de
-- garde is_admin, pas de p_reason, pas d'entrée audit_log (log_admin_action est réservé aux
-- actions ADMIN ; une mise à jour de son propre profil suit plutôt le patron de
-- update_my_account_profile, qui n'en écrit pas non plus). La table elle-même reste la seule
-- trace : primary key sur partner_id (un seul enregistrement par organisation, jamais un
-- historique), updated_at pour savoir quand ça a changé.
create or replace function set_my_payout_account(
  p_mercadopago_account text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_partner_id uuid;
  v_account text := btrim(coalesce(p_mercadopago_account, ''));
begin
  if v_account = '' then
    raise exception 'La cuenta de Mercado Pago es obligatoria' using errcode = '22023';
  end if;

  select partner_id into v_partner_id from public.partner_accounts where id = auth.uid();

  if v_partner_id is null then
    raise exception 'Cuenta sin partner asociado' using errcode = 'P0002';
  end if;

  insert into public.partner_payout_accounts (partner_id, mercadopago_account, updated_at)
  values (v_partner_id, v_account, now())
  on conflict (partner_id) do update
    set mercadopago_account = excluded.mercadopago_account, updated_at = now();

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function set_my_payout_account(text) to authenticated;
