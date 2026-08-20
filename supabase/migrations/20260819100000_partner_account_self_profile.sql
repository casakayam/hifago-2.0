-- Écran "Mi cuenta" (socio, apps/admin/app/partner) — profil individuel du compte de connexion.
-- partner_accounts n'avait jusqu'ici aucun champ de profil. Volontairement PAS sur `partners`
-- (l'organisation) : ce dernier peut être partagé par plusieurs partner_accounts (aucune
-- contrainte d'unicité sur partner_accounts.partner_id, "accès égal" documenté en 0001) — un écran
-- de compte personnel ne doit jamais écraser silencieusement ce que voit un collègue du même
-- partenaire.
alter table partner_accounts
  add column full_name text,
  add column phone text;

-- Pas de nouveau GRANT/policy : partner_accounts a RLS activée sans aucune policy d'écriture
-- (20260813163456_identity_rls.sql) — les writes restent bloquées par défaut pour
-- authenticated/anon, exactement comme aujourd'hui pour partner_id. Cette RPC, SECURITY DEFINER,
-- contourne RLS pour ne toucher QUE full_name/phone de la propre ligne de l'appelant (jamais
-- partner_id, qui reste exclusivement modifiable via consume_partner_invitation).
create or replace function update_my_account_profile(
  p_full_name text,
  p_phone text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_full_name text := btrim(coalesce(p_full_name, ''));
begin
  if v_full_name = '' then
    raise exception 'El nombre es obligatorio' using errcode = '22023';
  end if;

  update public.partner_accounts
     set full_name = v_full_name,
         phone = nullif(btrim(coalesce(p_phone, '')), ''),
         updated_at = now()
   where id = auth.uid();

  if not found then
    raise exception 'Cuenta no encontrada' using errcode = 'P0002';
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function update_my_account_profile(text, text) to authenticated;
