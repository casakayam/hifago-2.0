-- Fermeture de la fuite des colonnes de commission (docs/backlog.md, mesurée le 2026-09-11) —
-- site 4/10 : apps/admin/app/admin/orders/[id]/page.tsx (fiche ledger). C'est le SEUL des 10 sites
-- où la lecture des colonnes de commission complètes est un besoin métier réel et légitime — l'admin
-- y voit la répartition app/référent/prestataire par ligne (LedgerLinesTable, deriveLedgerEntry) —
-- mais le GRANT SELECT large sur order_lines qui la permet aujourd'hui expose aussi ces mêmes
-- colonnes à n'importe quel client via son propre jeton, sur n'importe quelle ligne qu'il possède.
create or replace function public.admin_order_line_ledger(p_order_id uuid)
returns table (
  id uuid,
  date date,
  qty int,
  status text,
  total_cop bigint,
  acompte_cop bigint,
  referrer_commission_cop bigint,
  app_commission_cop bigint,
  commission_case text,
  product_name jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (select public.is_admin(auth.uid())) then
    raise exception 'admin_order_line_ledger réservé au rôle admin' using errcode = '42501';
  end if;

  return query
  select
    ol.id, ol.date, ol.qty, ol.status, ol.total_cop, ol.acompte_cop,
    ol.referrer_commission_cop, ol.app_commission_cop, ol.commission_case,
    p.name
  from public.order_lines ol
  join public.products p on p.id = ol.product_id
  where ol.order_id = p_order_id
  order by ol.date asc;
end;
$$;

revoke all on function public.admin_order_line_ledger(uuid) from public, anon, authenticated;
grant execute on function public.admin_order_line_ledger(uuid) to authenticated;
