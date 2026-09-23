-- Fermeture de la fuite des colonnes de commission (docs/backlog.md, mesurée le 2026-09-11) —
-- site 2/10 : apps/admin/app/admin/clients/[client_key]/page.tsx lit aujourd'hui `order_lines` en
-- RLS directe (branche is_admin() de `order_lines_select`). Aucune colonne de commission
-- sélectionnée par cette page, mais la table entière reste lisible avec un jeton admin forgé à la
-- main tant que le GRANT SELECT existe — même remède que list_client_orders (clients_admin_rpc,
-- 20260819210000), dont cette page consomme déjà `order_ids` en entrée.
create or replace function public.admin_client_order_lines(p_order_ids uuid[])
returns table (
  id uuid,
  order_id uuid,
  date date,
  end_date date,
  qty int,
  status text,
  total_cop bigint,
  product_name jsonb,
  establishment_name jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (select public.is_admin(auth.uid())) then
    raise exception 'admin_client_order_lines réservé au rôle admin' using errcode = '42501';
  end if;

  -- p_order_ids n'est jamais présumé provenir d'un appel préalable à list_client_orders : la garde
  -- admin ci-dessus est la seule protection, comme pour toute RPC PostgREST appelable directement.
  return query
  select
    ol.id, ol.order_id, ol.date, ol.end_date, ol.qty, ol.status, ol.total_cop,
    p.name, e.name
  from public.order_lines ol
  join public.products p on p.id = ol.product_id
  join public.establishments e on e.id = p.establishment_id
  where ol.order_id = any(p_order_ids)
  order by ol.date desc;
end;
$$;

revoke all on function public.admin_client_order_lines(uuid[]) from public, anon, authenticated;
grant execute on function public.admin_client_order_lines(uuid[]) to authenticated;
