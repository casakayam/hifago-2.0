-- Feature 27 (Admin : page d'accueil et navigation) — RPC list_clients.
-- docs/specs/02-admin-accueil-et-navigation.md §7.
--
-- Pas de table `clients` dédiée (constat 2 de la spec) : ni auth.users ni partner_accounts ne
-- portent de nom, et se limiter aux comptes exclurait structurellement tout client invité
-- (create_order_guest_checkout accepte auth.uid() = null). Construite sur `orders` (holder_name/
-- holder_email/holder_phone), dédupliquée par client_key — PostgREST ne fait pas de GROUP BY,
-- d'où une vraie RPC plutôt qu'un simple .select().
--
-- Action admin bas-volume sans compteur de capacité (même calibrage que create_partner_invitation/
-- list_audience_members) : security definer + is_admin() interne, pas le squelette anti-survente.
create or replace function list_clients(
  p_search text default null,
  p_email text default null,
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
  total_count bigint
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (select public.is_admin(auth.uid())) then
    raise exception 'list_clients réservé au rôle admin' using errcode = '42501';
  end if;

  return query
  with grouped as (
    select
      -- Repli sur l'id de la commande elle-même si ni compte ni email ni téléphone n'existent
      -- (invité sans aucune coordonnée) : jamais fusionner deux clients distincts sous une même
      -- clé nulle (GROUP BY traiterait NULL = NULL comme une seule clé sans ce repli).
      coalesce(o.account_id::text, lower(o.holder_email), o.holder_phone, o.id::text) as client_key,
      o.holder_name,
      o.holder_email,
      o.holder_phone,
      o.created_at
    from public.orders o
  ),
  aggregated as (
    select
      g.client_key,
      (array_agg(g.holder_name order by g.created_at desc))[1] as display_name,
      (array_agg(g.holder_email order by g.created_at desc))[1] as email,
      (array_agg(g.holder_phone order by g.created_at desc))[1] as phone,
      count(*) as orders_count,
      max(g.created_at) as last_order_at
    from grouped g
    group by g.client_key
  )
  select
    a.client_key,
    a.display_name,
    a.email,
    a.phone,
    a.orders_count,
    a.last_order_at,
    count(*) over() as total_count
  from aggregated a
  where
    (p_search is null or a.display_name ilike '%' || p_search || '%' or a.email ilike '%' || p_search || '%')
    and (p_email is null or a.email ilike '%' || p_email || '%')
  order by a.last_order_at desc
  limit p_limit offset p_offset;
end;
$$;

grant execute on function list_clients(text, text, int, int) to authenticated;
