-- Revue admin clientes (Jérôme, 2026-08-19) — liste refondue sur le pattern DataList/ServerFilters
-- standard (elle utilisait jusqu'ici un Table brut fait main, seul écran admin dans ce cas), filtre
-- par état et fiche détail par client (jamais construite jusqu'ici, ni en V1 ni en V2 — le back-office
-- V1 calcule déjà un tableau de réservations par client mais ne l'affiche jamais côté front).
--
-- client_key_for_order : extrait en fonction partagée pour que list_clients (liste) et
-- list_client_orders (détail) calculent EXACTEMENT la même clé composite — sinon un clic depuis la
-- liste peut atterrir sur un détail vide (divergence silencieuse entre deux copies de la formule).
create or replace function public.client_key_for_order(
  p_account_id uuid, p_holder_email text, p_holder_phone text, p_order_id uuid
)
returns text
language sql
stable
set search_path = ''
as $$
  select coalesce(p_account_id::text, lower(p_holder_email), p_holder_phone, p_order_id::text)
$$;

-- Filtre "état" : un client agrège plusieurs commandes/lignes, chacune avec son propre statut
-- (order_lines.status a 7 valeurs, dont 2 artefacts de bookkeeping interne — expired/superseded —
-- qu'un admin ne choisirait jamais dans un menu). Filtrer sur "au moins une ligne dans cet état"
-- retomberait dans le même travers que le filtre date/nom d'activité déjà écarté par Jérôme pour
-- cette liste (pas pertinent à ce niveau agrégé). À la place : un état DÉRIVÉ par client
-- (proxima/en_casa/pasada/cancelada), même concept que le `stageOf` du back-office V1 (jamais
-- exposé comme un vrai filtre là-bas, juste un badge d'affichage) — le stade le plus "actif"
-- présent parmi les lignes non-superseded du client l'emporte ; un client n'est `cancelada` que si
-- TOUTES ses lignes le sont.
--
-- drop + create (pas create or replace) : le type de retour change (nouvelle colonne
-- client_stage, p_email retiré) — Postgres refuse un create or replace qui change la signature de
-- retour. Seul appelant existant, apps/admin/app/admin/clients/page.tsx, entièrement réécrit dans
-- ce même lot (grep confirmé avant d'y toucher).
drop function if exists public.list_clients(text, text, int, int);

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
        when status = 'reserved' and date > current_date then 'proxima'
        when status = 'reserved' and date <= current_date and coalesce(end_date, date) >= current_date then 'en_casa'
        when status in ('fulfilled', 'no_show') then 'pasada'
        when status = 'reserved' and coalesce(end_date, date) < current_date then 'pasada'
        when status in ('cancelled_by_client', 'cancelled_by_provider', 'expired') then 'cancelada'
      end as stage,
      case
        when status = 'reserved' and date > current_date then 1
        when status = 'reserved' and date <= current_date and coalesce(end_date, date) >= current_date then 2
        when status in ('fulfilled', 'no_show') then 3
        when status = 'reserved' and coalesce(end_date, date) < current_date then 3
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

-- Détail client : résout uniquement client_key → commandes (mêmes garanties RPC-only que
-- list_clients — lecture inter-identités, vue miroir admin, hifago/CLAUDE.md §3 critère 1). Les
-- order_lines/products/establishments/payments du détail restent en RLS-directe + embed
-- PostgREST côté page.tsx (RPC-only ne concerne que l'écriture de ces tables, pas leur lecture).
create or replace function public.list_client_orders(p_client_key text)
returns table (
  order_id uuid,
  holder_name text,
  holder_email text,
  holder_phone text,
  created_at timestamptz,
  payment_status text,
  referrer_partner_id uuid,
  referrer_display_name text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (select public.is_admin(auth.uid())) then
    raise exception 'list_client_orders réservé au rôle admin' using errcode = '42501';
  end if;

  return query
  select o.id, o.holder_name, o.holder_email, o.holder_phone, o.created_at,
         o.payment_status, o.referrer_partner_id, p.display_name
  from public.orders o
  left join public.partners p on p.id = o.referrer_partner_id
  where public.client_key_for_order(o.account_id, o.holder_email, o.holder_phone, o.id) = p_client_key
  -- Même tiebreak order_id ASC que list_clients (sur un vrai ex-æquo de created_at, cf. commentaire
  -- de sa CTE aggregated) — sans lui, la commande affichée en tête ici (identité de la fiche
  -- détail) pourrait diverger silencieusement du display_name montré sur la ligne de la liste.
  order by o.created_at desc, o.id asc;
end;
$$;

grant execute on function public.client_key_for_order(uuid, text, text, uuid) to authenticated;
grant execute on function public.list_clients(text, text, text, boolean, int, int) to authenticated;
grant execute on function public.list_client_orders(text) to authenticated;
