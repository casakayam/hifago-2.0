-- Spec 33 Tranche 3 — rattacher les commandes d'un invité à un compte créé après coup.
--
-- La RÈGLE est tranchée depuis le 2026-09-07 (cahier client §2b.9 : « créer un compte depuis cet
-- écran rattache les commandes par adresse email ») ; le MÉCANISME n'existait pas — le cahier §2f
-- le disait en toutes lettres, « périmètre à part entière ».
--
-- ⚠️ POURQUOI UNE RPC, ET POURQUOI IL N'Y AVAIT PAS DE CHEMIN GRATUIT.
-- L'hypothèse commode aurait été : l'invité s'inscrit depuis sa session anonyme, Supabase lie
-- l'email à l'identité existante, `account_id` ne bouge pas, les commandes suivent toutes seules.
-- Elle est FAUSSE, et deux vérifications indépendantes le montrent :
--   * spec 31 invariant 7 l'interdit — « aucun updateUser({email}), aucun linkIdentity » — et son
--     « hors périmètre » l'écrit : « un invité qui crée un compte plus tard ne récupère pas ses
--     commandes, conséquence assumée, À ROUVRIR SI LE BESOIN SE MANIFESTE » ;
--   * le SDK le confirme : `_updateUser` transmet `jwt: session.access_token` (ce qui convertirait
--     une identité), `signUp` n'en transmet AUCUN (@supabase/auth-js, GoTrueClient.js:715-740 vs
--     2838-2860, lu le 2026-09-10) — il crée donc un utilisateur NEUF.
-- Le besoin se manifeste ici, exactement.
--
-- ⚠️ AUCUN EMAIL EN PARAMÈTRE. La fonction lit l'email de `auth.users` elle-même. Un paramètre
-- serait précisément le *pre-account takeover* que la spec 31 décision ⑤ a écarté : n'importe qui
-- réclamerait les commandes de n'importe quelle adresse.

-- Sans cet index, le `where lower(o.holder_email) = lower(v_email)` ci-dessous n'est indexable par
-- rien : `orders` n'a aucun index sur `holder_email` (seulement `orders_account_id_created_at_idx`).
-- Chaque confirmation d'email déclencherait donc un balayage séquentiel complet — invisible sur une
-- base de dev, linéaire en nombre de commandes ensuite. L'index est fonctionnel parce que la
-- comparaison l'est : un index sur `holder_email` nu ne serait jamais utilisé.
create index if not exists orders_holder_email_lower_idx on public.orders (lower(holder_email));

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

  -- Garde explicite, et elle n'est pas seulement défensive : sans elle, cette fonction tomberait
  -- sous le CAS 2 de security_definer_exposure.test.sql (« toute RPC dont le seul garde est
  -- auth.uid() exclut explicitement une session anonyme »), spec 31 invariant 4. Une identité
  -- anonyme n'a de toute façon jamais d'email confirmé — mais le test ne lit pas dans les
  -- intentions, il lit le source.
  if (select public.is_anonymous_session()) then
    return jsonb_build_object('ok', false, 'reason', 'anonymous_session');
  end if;

  select u.email, u.email_confirmed_at into v_email, v_confirmed_at
    from auth.users u where u.id = v_account_id;

  -- ⚠️ LE GESTE QUI REND LE RATTACHEMENT SÛR, et le seul. Sans lui, n'importe qui s'inscrit avec
  -- l'adresse d'un autre et récupère ses réservations — nom, téléphone, email compris. C'est
  -- exactement ce que le cahier §2b.9 avait en tête en écrivant « l'email étant déjà vérifié à
  -- l'inscription, c'est ce qui rend le rattachement sûr ».
  if v_email is null or v_confirmed_at is null then
    return jsonb_build_object('ok', false, 'reason', 'email_not_confirmed');
  end if;

  -- ⚠️ GARDE AJOUTÉE À L'IMPLÉMENTATION, absente de la rédaction de la spec — un scénario trouvé
  -- en écrivant : un compte RÉEL A passe une commande en saisissant l'email de son ami B (rien ne
  -- l'interdit, `holder_email` est un champ libre du checkout). Le jour où B s'inscrit, un
  -- rattachement « par email » seul lui donnerait la commande de A, QUI LA PERDRAIT. On ne
  -- rattache donc QUE des commandes appartenant encore à une identité anonyme — c'est le sens
  -- littéral de ce que le cahier demande : « rattachement d'une commande passée EN INVITÉ ».
  -- Effet de bord utile : le compte technique des réservations comptoir
  -- (`reserva-manual@hifago.local`, spec 31 invariant 8) n'étant pas anonyme, il est exclu par
  -- construction — sans clause nommée qui aurait dupliqué la même idée.
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

  return jsonb_build_object('ok', true, 'attached', array_length(v_order_ids, 1));
end;
$$;

-- ⚠️ `from public, anon, authenticated` — LES TROIS, et ce n'est pas de la superstition : une
-- première version ne révoquait que `public`, et le test pgTAP a montré qu'`anon` gardait EXECUTE.
-- Deux sources cumulées, pas une : PostgreSQL accorde EXECUTE à PUBLIC sur toute fonction neuve
-- (sens INVERSE des tables), ET ce projet porte un `alter default privileges … grant … to anon,
-- authenticated, service_role` (20260813163456) qui accorde NOMMÉMENT à `anon` — qu'un revoke sur
-- `public` ne retire pas. C'est la forme exacte que prescrit `.claude/rules/supabase.md`, et la
-- raison pour laquelle elle la prescrit. Vérifié par `has_function_privilege`, jamais supposé.
--
-- `anon` n'a aucun usage de cette fonction : elle refuse déjà toute session anonyme et toute
-- absence de session. Le grant qui reste décrit donc exactement l'accès voulu.
revoke all on function public.attach_orders_to_account() from public, anon, authenticated;
grant execute on function public.attach_orders_to_account() to authenticated;

comment on function public.attach_orders_to_account() is
  'Rattache au compte appelant les commandes d''invité portant SON adresse email vérifiée '
  '(spec 33, cahier client §2b.9). Trois gardes : session non anonyme, email CONFIRMÉ (le seul '
  'rempart contre le pre-account takeover), et propriétaire actuel anonyme — ne vole jamais la '
  'commande d''un compte réel. Idempotente. Appelée depuis /auth/callback après vérification.';
