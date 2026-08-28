-- Lot fuseau (2026-08-28) — le côté base de données.
--
-- CE QUI ÉTAIT FAUX. `list_clients` dérive l'état d'un client (proxima / en_casa / pasada /
-- cancelada) en comparant les dates de ses lignes de commande à « aujourd'hui ». Ces six
-- comparaisons utilisaient `current_date`, qui rend la date du fuseau de la SESSION — UTC sur
-- Supabase. Guatapé est à UTC−5 toute l'année : de 19 h à minuit heure locale, `current_date`
-- désigne déjà DEMAIN. Pendant ces cinq heures, chaque soir, la liste clientes de l'admin faisait
-- passer en `pasada` un client qui dort dans la maison ce soir-là, et un client qui arrive demain
-- passait `en_casa`. Le tri s'en trouvait faux aussi (le `case ... stage_rank`, mêmes six bornes).
--
-- CE QU'ON POSE. `today_in_bogota()` — la contrepartie SQL du `todayInBogota()` de
-- packages/domain/src/time/. Une seule expression dans tout le dépôt, testée, et l'unique
-- échappatoire autorisée par scripts/check-timezone.sh à l'interdiction de `current_date` nu dans
-- supabase/migrations.
--
-- `at time zone` plutôt que `current_date` : le résultat ne dépend alors plus du réglage TimeZone
-- de la session, donc plus de l'endroit d'où la requête part. C'est exactement ce que vérifie
-- clients_stage_timezone.test.sql, en rejouant la même question sous deux fuseaux extrêmes.

-- Ni SECURITY DEFINER (elle ne lit aucune donnée), ni VOLATILE (stable dans une transaction, donc
-- utilisable dans une policy si le besoin venait).
create or replace function public.today_in_bogota()
returns date
language sql
stable
set search_path = ''
as $$
  select (current_timestamp at time zone 'America/Bogota')::date
$$;

comment on function public.today_in_bogota() is
  'Date civile à Guatapé (America/Bogota), indépendante du TimeZone de la session. Contrepartie SQL de todayInBogota() (packages/domain/src/time/). À utiliser partout où une migration a besoin de la date du jour — cf. scripts/check-timezone.sh.';

-- Retirée de la Data API, comme toute fonction qui n'a aucune raison d'y être.
--
-- Sans cette ligne elle y serait exposée : `has_function_privilege('anon', …)` rendait `true` avant
-- ce revoke, `false` après (mesuré, pas supposé).
--
-- ⚠️ NUANCE SUR LE MÉCANISME, à ne pas recopier de travers depuis 20260828000103/002053. Ici le
-- grant ne venait PAS d'une entrée `pg_default_acl` : `proacl` était NULL, donc c'était le défaut
-- Postgres intégré des fonctions — `EXECUTE TO PUBLIC`. Les entrées `pg_default_acl` qui accordent
-- EXECUTE nommément à anon/authenticated/service_role existent bien sur ce schéma, mais pour les
-- objets créés par `supabase_admin` ; celle du rôle `postgres` (celui qui exécute les migrations)
-- ne contient que `postgres=X/postgres`. Vérifié dans `pg_default_acl`. Un `revoke ... from public`
-- seul aurait donc suffi POUR CETTE fonction.
--
-- Les rôles sont nommés quand même, et ce n'est pas de la superstition : dès qu'un grant explicite
-- existe (`grant execute ... to authenticated`, comme sur `client_key_for_order` juste au-dessus),
-- `from public` ne le retire pas — c'est précisément la faille de 20260828000103. Nommer coûte
-- zéro et couvre les deux cas. État final `postgres=X/postgres`, identique à celui des six
-- fonctions révoquées par 20260828002053.
--
-- Rien ne casse, et ce n'est pas une supposition non plus : vérifié `set role authenticated` +
-- `select from public.list_clients(...)` → EXECUTE sur today_in_bogota `false`, list_clients répond
-- quand même. Son unique appelant en base est `list_clients`, SECURITY DEFINER, qui s'exécute avec
-- les droits de son propriétaire ; les deux fichiers pgTAP qui l'appellent directement tournent
-- comme `postgres`. Aucun appelant PostgREST n'existe (grep).
--
-- Elle ne rend que la date du jour : l'exposer ne fuiterait rien. Le durcissement n'en est pas
-- moins systématique — une fonction sans usage client sur la Data API, c'est de l'inventaire à
-- réauditer à chaque passage, pour zéro bénéfice.
revoke all on function public.today_in_bogota() from public, anon, authenticated;

-- `create or replace` à signature RIGOUREUSEMENT identique : c'est ce qui conserve les privilèges
-- déjà posés (leçon du 2026-08-27 — recréer sous une NOUVELLE signature repart des privilèges par
-- défaut de Supabase, qui grantent explicitement anon/authenticated). Aucun grant n'est donc
-- rejoué ici, et le garde interne `is_admin` reste en place.
--
-- Le corps est repris VERBATIM de 20260819210000_clients_admin_rpc.sql, à trois différences près :
-- la déclaration de `v_today`, et les deux `case` dont les six `current_date` deviennent `v_today`.
-- Aucune autre ligne ne change (commentaires d'origine conservés, ils expliquent des pièges encore
-- actuels).
create or replace function public.list_clients(
  p_search text default null,
  p_status text default null,
  p_sort_key text default 'last_order_at',
  p_sort_desc boolean default true,
  p_limit int default 20,
  p_offset int default 0
)
returns table (
  client_key text,
  display_name text,
  email text,
  phone text,
  orders_count bigint,
  last_order_at timestamptz,
  client_stage text,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
-- Résolu UNE fois pour toute la requête : les six bornes ci-dessous doivent répondre à la même
-- question au même instant. Six appels séparés seraient corrects (la fonction est stable) mais
-- laisseraient croire qu'ils pourraient diverger.
declare
  v_today constant date := public.today_in_bogota();
begin
  if not (select public.is_admin(auth.uid())) then
    raise exception 'list_clients réservé au rôle admin' using errcode = '42501';
  end if;

  -- Alias interne `ckey` (jamais `client_key`) dans toutes les CTE intermédiaires : `client_key`
  -- est aussi une colonne du RETURNS TABLE, donc une variable PL/pgSQL implicite dans toute cette
  -- fonction — une CTE qui l'utilise comme nom de colonne provoque une ambiguïté ("column
  -- reference client_key is ambiguous") entre la variable et la colonne, détectée à l'exécution
  -- (pas au moment d'écrire la migration). Seule la toute dernière projection `select a.ckey as
  -- client_key, ...` mappe vers le nom de sortie, sans ambiguïté possible à ce niveau (qualifié).
  return query
  with lines as (
    select
      public.client_key_for_order(o.account_id, o.holder_email, o.holder_phone, o.id) as ckey,
      ol.status, ol.date, ol.end_date
    from public.order_lines ol
    join public.orders o on o.id = ol.order_id
    where ol.status <> 'superseded'
  ),
  staged as (
    select
      ckey,
      case
        when status = 'reserved' and date > v_today then 'proxima'
        when status = 'reserved' and date <= v_today and coalesce(end_date, date) >= v_today then 'en_casa'
        when status in ('fulfilled', 'no_show') then 'pasada'
        when status = 'reserved' and coalesce(end_date, date) < v_today then 'pasada'
        when status in ('cancelled_by_client', 'cancelled_by_provider', 'expired') then 'cancelada'
      end as stage,
      case
        when status = 'reserved' and date > v_today then 1
        when status = 'reserved' and date <= v_today and coalesce(end_date, date) >= v_today then 2
        when status in ('fulfilled', 'no_show') then 3
        when status = 'reserved' and coalesce(end_date, date) < v_today then 3
        when status in ('cancelled_by_client', 'cancelled_by_provider', 'expired') then 4
      end as stage_rank
    from lines
  ),
  client_stage as (
    select ckey, (array_agg(stage order by stage_rank asc))[1] as stage
    from staged
    group by ckey
  ),
  grouped as (
    select
      public.client_key_for_order(o.account_id, o.holder_email, o.holder_phone, o.id) as ckey,
      o.id as order_id, o.holder_name, o.holder_email, o.holder_phone, o.created_at
    from public.orders o
  ),
  -- Un même compte peut porter 2 commandes au holder_name/email différents avec un created_at
  -- rigoureusement identique (deux réservations posées dans la même transaction seed, ex-æquo réel
  -- constaté sur l'instance locale — "le plus récent gagne" ci-dessous n'a alors plus de signal
  -- pour départager, cf. tiebreak order_id ci-dessous, arbitraire mais déterministe). La recherche
  -- doit donc matcher sur TOUTE commande du client, jamais seulement sur celle qui gagne l'agrégat
  -- d'affichage — sinon un client reste introuvable par un nom/email qu'il a bien utilisé, juste
  -- parce qu'une autre de ses commandes a hérité du même timestamp.
  search_match as (
    select ckey, bool_or(
      p_search is null or holder_name ilike '%' || p_search || '%' or holder_email ilike '%' || p_search || '%'
    ) as matches
    from grouped
    group by ckey
  ),
  -- Tiebreak sur order_id ASC (arbitraire mais déterministe et reproductible) : sur un vrai
  -- ex-æquo de created_at, "premier inséré" est un critère aussi défendable que n'importe quel
  -- autre — l'important est que le résultat ne varie jamais d'une exécution à l'autre.
  aggregated as (
    select
      g.ckey,
      (array_agg(g.holder_name order by g.created_at desc, g.order_id asc))[1] as display_name,
      (array_agg(g.holder_email order by g.created_at desc, g.order_id asc))[1] as email,
      (array_agg(g.holder_phone order by g.created_at desc, g.order_id asc))[1] as phone,
      count(*) as orders_count,
      max(g.created_at) as last_order_at
    from grouped g
    group by g.ckey
  )
  select
    a.ckey,
    a.display_name,
    a.email,
    a.phone,
    a.orders_count,
    a.last_order_at,
    cs.stage,
    count(*) over()
  from aggregated a
  join search_match sm on sm.ckey = a.ckey
  left join client_stage cs on cs.ckey = a.ckey
  where sm.matches and (p_status is null or cs.stage = p_status)
  order by
    case when p_sort_key = 'display_name' and not p_sort_desc then a.display_name end asc nulls last,
    case when p_sort_key = 'display_name' and p_sort_desc then a.display_name end desc nulls last,
    case when p_sort_key = 'orders_count' and not p_sort_desc then a.orders_count end asc nulls last,
    case when p_sort_key = 'orders_count' and p_sort_desc then a.orders_count end desc nulls last,
    case when p_sort_key not in ('display_name', 'orders_count') and not p_sort_desc then a.last_order_at end asc nulls last,
    case when p_sort_key not in ('display_name', 'orders_count') and p_sort_desc then a.last_order_at end desc nulls last
  limit p_limit offset p_offset;
end;
$$;
