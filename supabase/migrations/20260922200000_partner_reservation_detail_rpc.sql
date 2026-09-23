-- Fermeture de la fuite des colonnes de commission (docs/backlog.md, mesurée le 2026-09-11) —
-- site 7/10, LE PLUS SENSIBLE DU LOT : apps/admin/app/partner/(app)/reservations/[id]/page.tsx n'a
-- AUCUN filtre applicatif aujourd'hui (commentaire d'origine : « RLS order_lines_select_operator
-- fait déjà foi : aucune nouvelle policy ») — la RLS EST le seul rempart qui empêche un socio de
-- lire la réservation de n'importe quel autre établissement en devinant/énumérant un UUID.
--
-- ⚠️ Le `where public.has_capability(...)` ci-dessous n'est donc pas une prudence supplémentaire,
-- c'est LE remplacement direct et non négociable de ce rempart — une RPC qui l'omettrait donnerait
-- à n'importe quel socio l'accès au détail de n'importe quelle réservation, une régression bien
-- pire que la fuite de commission que ce chantier ferme par ailleurs. Colonnes de commission
-- toujours hors périmètre socio (spec 22), comme dans le SELECT d'origine.
create or replace function public.partner_reservation_detail(p_order_line_id uuid)
returns table (
  id uuid,
  date date,
  end_date date,
  slot_start_time time,
  qty int,
  status text,
  holder_name text,
  holder_phone text,
  holder_email text,
  total_cop bigint,
  created_at timestamptz,
  product_name jsonb,
  product_type text,
  establishment_name jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return query
  select
    ol.id, ol.date, ol.end_date, ol.slot_start_time, ol.qty, ol.status,
    ol.holder_name, ol.holder_phone, ol.holder_email, ol.total_cop, ol.created_at,
    p.name, p.type, e.name
  from public.order_lines ol
  join public.products p on p.id = ol.product_id
  join public.establishments e on e.id = p.establishment_id
  where ol.id = p_order_line_id
    and public.has_capability(auth.uid(), 'operator', p.establishment_id);
end;
$$;

revoke all on function public.partner_reservation_detail(uuid) from public, anon, authenticated;
grant execute on function public.partner_reservation_detail(uuid) to authenticated;
