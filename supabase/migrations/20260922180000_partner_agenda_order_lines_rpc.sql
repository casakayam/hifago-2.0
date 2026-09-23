-- Fermeture de la fuite des colonnes de commission (docs/backlog.md, mesurée le 2026-09-11) —
-- site 5/10 : apps/admin/app/partner/(app)/page.tsx (agenda socio) lit aujourd'hui `order_lines`
-- en RLS directe (`order_lines_select_operator`). Aucune colonne de commission sélectionnée (même
-- pas total_cop), mais la table entière reste lisible avec un jeton socio forgé à la main tant que
-- le GRANT SELECT existe.
--
-- Scope établissement recalculé en SQL via has_capability(auth.uid(), 'operator', ...), jamais un
-- paramètre d'établissements fourni par l'appelant — même discipline que
-- partner_reservations_list (20260922175000).
create or replace function public.partner_agenda_order_lines(p_date_from date, p_date_to date)
returns table (
  id uuid,
  date date,
  end_date date,
  slot_start_time time,
  qty int,
  status text,
  holder_name text,
  product_id uuid,
  product_name jsonb,
  product_type text,
  product_duration_days int
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return query
  select
    ol.id, ol.date, ol.end_date, ol.slot_start_time, ol.qty, ol.status, ol.holder_name,
    p.id, p.name, p.type, p.duration_days
  from public.order_lines ol
  join public.products p on p.id = ol.product_id
  where public.has_capability(auth.uid(), 'operator', p.establishment_id)
    and ol.date >= p_date_from
    and ol.date <= p_date_to
    and ol.status = any(array['reserved', 'fulfilled', 'no_show']);
end;
$$;

revoke all on function public.partner_agenda_order_lines(date, date) from public, anon, authenticated;
grant execute on function public.partner_agenda_order_lines(date, date) to authenticated;
