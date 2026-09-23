-- Fermeture de la fuite des colonnes de commission (docs/backlog.md, mesurée le 2026-09-11) —
-- site 6/10 : apps/admin/app/partner/(app)/reservations/page.tsx (« Mis reservas ») lit
-- aujourd'hui `order_lines` en RLS directe (`order_lines_select_operator`, 20260817170000). Aucune
-- colonne de commission sélectionnée par cette page (déjà hors périmètre socio, spec 22), mais la
-- table entière reste lisible avec un jeton socio forgé à la main tant que le GRANT SELECT existe.
--
-- Scope établissement recalculé en SQL via has_capability(auth.uid(), 'operator', ...), JAMAIS un
-- paramètre d'établissements fourni par l'appelant : une RPC est un endpoint PostgREST autonome,
-- appelable directement par n'importe quel jeton authenticated — un paramètre de confiance
-- réintroduirait la même classe de faille que celle qu'on ferme, juste déplacée du grant de table
-- au paramètre de fonction.
create or replace function public.partner_reservations_list(
  p_date_from date default null,
  p_date_to date default null,
  p_product_id uuid default null,
  p_holder_q text default null,
  p_status text default null,
  p_sort_key text default 'date',
  p_sort_desc boolean default false,
  p_limit int default 20,
  p_offset int default 0
)
returns table (
  id uuid,
  date date,
  qty int,
  status text,
  total_cop bigint,
  holder_name text,
  holder_phone text,
  holder_email text,
  product_name jsonb,
  establishment_name jsonb,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return query
  select
    ol.id, ol.date, ol.qty, ol.status, ol.total_cop,
    ol.holder_name, ol.holder_phone, ol.holder_email,
    p.name, e.name,
    count(*) over()
  from public.order_lines ol
  join public.products p on p.id = ol.product_id
  join public.establishments e on e.id = p.establishment_id
  where public.has_capability(auth.uid(), 'operator', p.establishment_id)
    and (p_date_from is null or ol.date >= p_date_from)
    and (p_date_to is null or ol.date <= p_date_to)
    and (p_product_id is null or ol.product_id = p_product_id)
    and (p_status is null or ol.status = p_status)
    and (
      p_holder_q is null
      or ol.holder_name ilike '%' || p_holder_q || '%'
      or ol.holder_email ilike '%' || p_holder_q || '%'
    )
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

revoke all on function public.partner_reservations_list(date, date, uuid, text, text, text, boolean, int, int)
  from public, anon, authenticated;
grant execute on function public.partner_reservations_list(date, date, uuid, text, text, text, boolean, int, int)
  to authenticated;
