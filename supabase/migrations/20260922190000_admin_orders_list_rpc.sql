-- Fermeture de la fuite des colonnes de commission (docs/backlog.md, mesurée le 2026-09-11) —
-- site 3/10 : apps/admin/app/admin/orders/page.tsx (liste paginée) lit aujourd'hui `order_lines`
-- en RLS directe (branche is_admin() de `order_lines_select`). Aucune colonne de commission
-- sélectionnée par cette page, mais la table entière reste lisible avec un jeton admin forgé à la
-- main tant que le GRANT SELECT existe. Squelette repris de list_clients (clients_admin_rpc,
-- 20260819210000) : count(*) over() pour la pagination, CASE statique pour le tri, jamais de SQL
-- dynamique même sur une clé déjà whitelistée côté TS (ORDERS_SORT_WHITELIST).
create or replace function public.admin_orders_list(
  p_status text default null,
  p_date_from date default null,
  p_date_to date default null,
  p_q text default null,
  p_product_id uuid default null,
  p_sort_key text default 'created_at',
  p_sort_desc boolean default true,
  p_limit int default 20,
  p_offset int default 0
)
returns table (
  id uuid,
  order_id uuid,
  date date,
  end_date date,
  qty int,
  status text,
  total_cop bigint,
  created_at timestamptz,
  product_name jsonb,
  establishment_name jsonb,
  holder_name text,
  holder_phone text,
  referrer_display_name text,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (select public.is_admin(auth.uid())) then
    raise exception 'admin_orders_list réservé au rôle admin' using errcode = '42501';
  end if;

  return query
  select
    ol.id, ol.order_id, ol.date, ol.end_date, ol.qty, ol.status, ol.total_cop, ol.created_at,
    p.name, e.name,
    o.holder_name, o.holder_phone, rp.display_name,
    count(*) over()
  from public.order_lines ol
  join public.products p on p.id = ol.product_id
  join public.establishments e on e.id = p.establishment_id
  join public.orders o on o.id = ol.order_id
  left join public.partners rp on rp.id = o.referrer_partner_id
  where (p_status is null or ol.status = p_status)
    and (p_date_from is null or ol.date >= p_date_from)
    and (p_date_to is null or ol.date <= p_date_to)
    and (p_q is null or o.holder_name ilike '%' || p_q || '%')
    and (p_product_id is null or ol.product_id = p_product_id)
  order by
    case when p_sort_key = 'date' and not p_sort_desc then ol.date end asc nulls last,
    case when p_sort_key = 'date' and p_sort_desc then ol.date end desc nulls last,
    case when p_sort_key = 'created_at' and not p_sort_desc then ol.created_at end asc nulls last,
    case when p_sort_key = 'created_at' and p_sort_desc then ol.created_at end desc nulls last,
    case when p_sort_key = 'qty' and not p_sort_desc then ol.qty end asc nulls last,
    case when p_sort_key = 'qty' and p_sort_desc then ol.qty end desc nulls last,
    case when p_sort_key = 'status' and not p_sort_desc then ol.status end asc nulls last,
    case when p_sort_key = 'status' and p_sort_desc then ol.status end desc nulls last,
    case when p_sort_key = 'total_cop' and not p_sort_desc then ol.total_cop end asc nulls last,
    case when p_sort_key = 'total_cop' and p_sort_desc then ol.total_cop end desc nulls last
  limit p_limit offset p_offset;
end;
$$;

revoke all on function public.admin_orders_list(text, date, date, text, uuid, text, boolean, int, int)
  from public, anon, authenticated;
grant execute on function public.admin_orders_list(text, date, date, text, uuid, text, boolean, int, int)
  to authenticated;
