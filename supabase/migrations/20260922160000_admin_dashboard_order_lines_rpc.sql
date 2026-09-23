-- Fermeture de la fuite des colonnes de commission (docs/backlog.md, mesurée le 2026-09-11) —
-- site 1/10 : apps/admin/app/admin/page.tsx (tableau de bord) lit `order_lines` en RLS directe
-- (branche is_admin()) via 5 requêtes distinctes, agrégées en mémoire côté JS (PostgREST ne fait
-- pas de GROUP BY). Chaque RPC ci-dessous mirrore EXACTEMENT sa requête d'origine — même filtre,
-- même forme de ligne — pour que toute la logique JS existante (.reduce(), Map par jour/partenaire)
-- reste inchangée au caractère près ; seul le mécanisme de fetch change.
--
-- p_today/p_since sont des paramètres, jamais recalculés côté SQL : ce projet s'est déjà fait
-- piéger une fois (2026-08-28, cf. dateWindow.ts) par deux calculs indépendants de « aujourd'hui »
-- qui divergeaient — todayInBogota()/computeDateWindow() côté TS restent la seule source.

-- 1a — KPI "Ingresos generados" : somme de total_cop, statuts terminaux non annulés, sans fenêtre
-- de date (lifetime).
create or replace function public.admin_order_lines_revenue_rows()
returns table (total_cop bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (select public.is_admin(auth.uid())) then
    raise exception 'admin_order_lines_revenue_rows réservé au rôle admin' using errcode = '42501';
  end if;

  return query
  select ol.total_cop
  from public.order_lines ol
  where ol.status = any(array['confirmed', 'fulfilled', 'no_show']);
end;
$$;

-- 1b — KPI "Comisiones generadas" (+ répartition par partenaire référent) : lignes fulfilled
-- uniquement, sans fenêtre de date (lifetime).
create or replace function public.admin_order_lines_commission_rows()
returns table (
  referrer_commission_cop bigint,
  app_commission_cop bigint,
  referrer_partner_id uuid
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (select public.is_admin(auth.uid())) then
    raise exception 'admin_order_lines_commission_rows réservé au rôle admin' using errcode = '42501';
  end if;

  return query
  select ol.referrer_commission_cop, ol.app_commission_cop, ol.referrer_partner_id
  from public.order_lines ol
  where ol.status = 'fulfilled';
end;
$$;

-- 1c — KPI "Pedidos pendientes de acción" : count des lignes confirmed dont la date de service est
-- déjà passée.
create or replace function public.admin_order_lines_pending_action_count(p_today date)
returns table (pending_count bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (select public.is_admin(auth.uid())) then
    raise exception 'admin_order_lines_pending_action_count réservé au rôle admin' using errcode = '42501';
  end if;

  return query
  select count(*)
  from public.order_lines ol
  where ol.status = 'confirmed' and ol.date < p_today;
end;
$$;

-- 1d — Séries journalières (graphiques ventes + commissions) sur la fenêtre [p_since, aujourd'hui].
create or replace function public.admin_order_lines_daily_series(p_since date)
returns table (
  date date,
  status text,
  total_cop bigint,
  referrer_commission_cop bigint,
  app_commission_cop bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (select public.is_admin(auth.uid())) then
    raise exception 'admin_order_lines_daily_series réservé au rôle admin' using errcode = '42501';
  end if;

  return query
  select ol.date, ol.status, ol.total_cop, ol.referrer_commission_cop, ol.app_commission_cop
  from public.order_lines ol
  where ol.date >= p_since
    and ol.status = any(array['confirmed', 'fulfilled', 'no_show']);
end;
$$;

-- 1e — Volume de ventes par partenaire (graphique "top partenaires"), sans fenêtre de date
-- (lifetime) : jamais de colonne commission, `status` filtré mais jamais relu côté TS.
create or replace function public.admin_order_lines_volume_by_partner_rows()
returns table (
  total_cop bigint,
  establishment_id uuid,
  partner_id uuid,
  partner_display_name text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (select public.is_admin(auth.uid())) then
    raise exception 'admin_order_lines_volume_by_partner_rows réservé au rôle admin' using errcode = '42501';
  end if;

  return query
  select ol.total_cop, p.establishment_id, e.partner_id, pt.display_name
  from public.order_lines ol
  join public.products p on p.id = ol.product_id
  join public.establishments e on e.id = p.establishment_id
  join public.partners pt on pt.id = e.partner_id
  where ol.status = any(array['confirmed', 'fulfilled', 'no_show']);
end;
$$;

revoke all on function public.admin_order_lines_revenue_rows() from public, anon, authenticated;
revoke all on function public.admin_order_lines_commission_rows() from public, anon, authenticated;
revoke all on function public.admin_order_lines_pending_action_count(date) from public, anon, authenticated;
revoke all on function public.admin_order_lines_daily_series(date) from public, anon, authenticated;
revoke all on function public.admin_order_lines_volume_by_partner_rows() from public, anon, authenticated;

grant execute on function public.admin_order_lines_revenue_rows() to authenticated;
grant execute on function public.admin_order_lines_commission_rows() to authenticated;
grant execute on function public.admin_order_lines_pending_action_count(date) to authenticated;
grant execute on function public.admin_order_lines_daily_series(date) to authenticated;
grant execute on function public.admin_order_lines_volume_by_partner_rows() to authenticated;
