-- Spec 33/35 — trouvé par Jérôme en le vivant réellement (commande en invité, puis inscription) :
-- `attach_orders_to_account` (20260910180000) rattache les COMMANDES au nouveau compte, mais
-- `partner_accounts.full_name`/`phone` du compte fraîchement créé restent NULL — rien ne les
-- avait jamais remplis. `/registro` (SignupForm.tsx) ne demande ni nom ni téléphone (spec 35 :
-- c'est `/cuenta/perfil`, un écran séparé, qui les recueille) ; le client se retrouvait donc avec
-- SES réservations mais un profil vide, alors qu'il avait déjà tapé les deux au checkout invité
-- (`orders.holder_name` not null, `holder_phone` désormais obligatoire côté écran).
--
-- Repris DANS la même fonction/transaction plutôt qu'un second aller-retour depuis
-- `/auth/callback` : les commandes qui viennent d'être rattachées sont déjà là, sous la main, et un
-- échec réseau entre deux appels laisserait le même trou à moitié comblé.
create or replace function public.attach_orders_to_account()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account_id uuid := (select auth.uid());
  v_email text;
  v_confirmed_at timestamptz;
  v_order_ids uuid[];
begin
  if v_account_id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;

  if (select public.is_anonymous_session()) then
    return jsonb_build_object('ok', false, 'reason', 'anonymous_session');
  end if;

  select u.email, u.email_confirmed_at into v_email, v_confirmed_at
    from auth.users u where u.id = v_account_id;

  if v_email is null or v_confirmed_at is null then
    return jsonb_build_object('ok', false, 'reason', 'email_not_confirmed');
  end if;

  select coalesce(array_agg(o.id), array[]::uuid[]) into v_order_ids
    from public.orders o
    join auth.users u on u.id = o.account_id
   where lower(o.holder_email) = lower(v_email)
     and u.is_anonymous
     and o.account_id is distinct from v_account_id;

  if array_length(v_order_ids, 1) is null then
    -- Idempotent : un second appel ne trouve plus rien, et ce n'est pas une erreur.
    return jsonb_build_object('ok', true, 'attached', 0);
  end if;

  update public.orders set account_id = v_account_id where id = any(v_order_ids);

  -- ⚠️ `order_lines.account_id` est DÉNORMALISÉ depuis `orders` (20260813194515 : « évite qu'une
  -- lecture de order_lines déclenche en cascade l'évaluation de la policy RLS d'orders »). Les
  -- deux bougent ensemble ou pas du tout : l'oublier laisserait `/cuenta/reservas` afficher la
  -- commande et `order_lines_select` en masquer les lignes.
  update public.order_lines set account_id = v_account_id where order_id = any(v_order_ids);

  -- Pré-remplit le profil avec ce que le CLIENT a déjà saisi lui-même au checkout invité — jamais
  -- une valeur inventée. `order by created_at desc limit 1` : si plusieurs commandes d'invité sous
  -- la même adresse portent des coordonnées différentes (nom mal tapé une fois, numéro changé),
  -- la plus RÉCENTE gagne, cohérent avec « la dernière chose que le client a dite de lui-même ».
  -- Gardé sur `full_name is null` : ne réécrit JAMAIS un profil déjà renseigné (même logique que
  -- `update_my_account_profile`, qui ne doit jamais écraser silencieusement — 20260819100000).
  update public.partner_accounts pa
     set full_name = o.holder_name,
         phone = o.holder_phone,
         updated_at = now()
    from (
      select holder_name, holder_phone
        from public.orders
       where id = any(v_order_ids)
       order by created_at desc
       limit 1
    ) o
   where pa.id = v_account_id
     and pa.full_name is null;

  return jsonb_build_object('ok', true, 'attached', array_length(v_order_ids, 1));
end;
$$;

-- `create or replace` ne touche ni les grants ni le commentaire existants, mais les reposer ici
-- documente que cette version-ci les porte toujours (`.claude/rules/supabase.md` point 7 : une
-- signature inchangée n'a pas besoin d'un `drop function`, un simple `create or replace` suffit).
revoke all on function public.attach_orders_to_account() from public, anon, authenticated;
grant execute on function public.attach_orders_to_account() to authenticated;

comment on function public.attach_orders_to_account() is
  'Rattache au compte appelant les commandes d''invité portant SON adresse email vérifiée '
  '(spec 33, cahier client §2b.9), et pré-remplit son profil (nom/téléphone) depuis la commande '
  'la plus récente si ce profil est encore vide (2026-09-14, trou trouvé en usage réel). Trois '
  'gardes : session non anonyme, email CONFIRMÉ (le seul rempart contre le pre-account takeover), '
  'et propriétaire actuel anonyme — ne vole jamais la commande d''un compte réel. Idempotente. '
  'Appelée depuis /auth/callback après vérification.';
