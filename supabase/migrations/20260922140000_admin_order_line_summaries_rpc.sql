-- Fermeture de la fuite des colonnes de commission (docs/backlog.md, mesurée le 2026-09-11) —
-- sites 9-10/10 : apps/admin/app/admin/reconciliation/page.tsx et
-- apps/admin/app/admin/establishments/[id]/resource/page.tsx embarquent tous deux
-- `order_line:order_lines(...)` depuis une AUTRE table (pms_reconciliation_entries/
-- availability_blocks) — invisibles à un grep littéral sur `.from("order_lines")`, mais PostgREST
-- exige un GRANT SELECT sur order_lines pour honorer l'embed, même pour une seule colonne. Une
-- seule RPC sert les deux écrans (même besoin : order_line_id → identité de la commande/produit),
-- sur le modèle de admin_client_order_lines (20260922130000).
create or replace function public.admin_order_line_summaries(p_order_line_ids uuid[])
returns table (
  order_line_id uuid,
  order_id uuid,
  holder_name text,
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
    raise exception 'admin_order_line_summaries réservé au rôle admin' using errcode = '42501';
  end if;

  return query
  select
    ol.id, ol.order_id, o.holder_name, p.name, e.name
  from public.order_lines ol
  join public.orders o on o.id = ol.order_id
  join public.products p on p.id = ol.product_id
  join public.establishments e on e.id = p.establishment_id
  where ol.id = any(p_order_line_ids);
end;
$$;

revoke all on function public.admin_order_line_summaries(uuid[]) from public, anon, authenticated;
grant execute on function public.admin_order_line_summaries(uuid[]) to authenticated;
