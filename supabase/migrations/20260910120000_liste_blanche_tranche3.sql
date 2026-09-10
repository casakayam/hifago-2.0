-- Spec 31 (Tranche 3) — première extension réelle de la liste blanche au-delà de
-- consume_partner_invitation (20260909200000) : les deux SEULES autres RPC dont le garde
-- d'identité se limitait à `auth.uid() is not null`, sans exclusion explicite ou structurelle
-- d'une session anonyme, trouvées par le contrôle mécanique durci du même geste
-- (security_definer_exposure.test.sql — migration suivante).
--
-- Checklist (CLAUDE.md §3) : aucune des deux n'est une opération critique au sens §4.1 (aucun
-- décompte de capacité) — pas de test de concurrence requis. Aucune table, policy, grant modifiés.
-- set_my_payout_account/update_my_account_profile ne sont accessibles que depuis
-- apps/admin/partner/(app)/account/ — sessions Supabase INDÉPENDANTES de apps/web (CLAUDE.md
-- §2.1) : aucune session anonyme du site vitrine ne peut structurellement les atteindre
-- aujourd'hui. Correctif de défense en profondeur, pas un correctif de fuite réelle constatée.
--
-- Repris de pg_get_functiondef sur la base locale ; seuls les blocs commentés « 2026-09-10 »
-- diffèrent de la version en place.

CREATE OR REPLACE FUNCTION public.set_my_payout_account(p_mercadopago_account text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_partner_id uuid;
  v_account text := btrim(coalesce(p_mercadopago_account, ''));
begin
  if v_account = '' then
    raise exception 'La cuenta de Mercado Pago es obligatoria' using errcode = '22023';
  end if;

  -- 2026-09-10 (spec 31, Tranche 3) — appel au helper NOMMÉ plutôt que la même requête recopiée
  -- en ligne : le contrôle mécanique security_definer_exposure.test.sql reconnaît
  -- partner_id_for_account( comme un garde valide (il exclut structurellement toute identité sans
  -- partenaire, anonyme comprise), ce qu'une requête inline ne pouvait pas prouver sans un cas
  -- particulier. Comportement inchangé : même requête, même résultat.
  v_partner_id := (select public.partner_id_for_account(auth.uid()));

  if v_partner_id is null then
    raise exception 'Cuenta sin partner asociado' using errcode = 'P0002';
  end if;

  insert into public.partner_payout_accounts (partner_id, mercadopago_account, updated_at)
  values (v_partner_id, v_account, now())
  on conflict (partner_id) do update
    set mercadopago_account = excluded.mercadopago_account, updated_at = now();

  return jsonb_build_object('ok', true);
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_my_account_profile(p_full_name text, p_phone text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_full_name text := btrim(coalesce(p_full_name, ''));
begin
  if v_full_name = '' then
    raise exception 'El nombre es obligatorio' using errcode = '22023';
  end if;

  -- 2026-09-10 (spec 31, Tranche 3) — invariant 5 : cette RPC N'EST PAS dans la liste blanche des
  -- sessions anonymes (point ouvert §10 de la spec : faut-il qu'un invité renseigne son nom une
  -- fois pour toutes ? non tranché, donc refusée par défaut comme toute RPC absente de la liste —
  -- invariant 4). Réussissait aujourd'hui pour un anonyme (mesuré le 2026-09-09), précisément
  -- parce que le trigger on_auth_user_created (décision ④, inchangé) lui donne une ligne
  -- partner_accounts comme à tout compte.
  if (select public.is_anonymous_session()) then
    raise exception 'No disponible para una sesión anónima' using errcode = '42501';
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
$function$;
