-- Fermeture de la fuite des colonnes de commission (docs/backlog.md, mesurée le 2026-09-11) —
-- site 8/10 : apps/web/lib/orders/getPendingOrdersForViewer.ts lit aujourd'hui `orders` avec un
-- embed PostgREST `order_lines(status)` sous RLS directe (`order_lines_select`), qui autorise en
-- réalité la lecture de TOUTES les colonnes d'order_lines par un jeton client forgé à la main,
-- commission comprise — même si l'app ne demande que `status`. Cette migration ne fait que
-- déplacer ce site derrière une RPC étroite ; le `revoke select on order_lines` lui-même est une
-- migration séparée, une fois les 10 sites convertis et vérifiés (cf. plan de migration).
--
-- Garde particulière : ce module DOIT rester utilisable par une session anonyme Supabase (guest
-- checkout, spec 31/32 — un invité dont le paiement échoue doit pouvoir retrouver sa commande sur
-- `/mi-viaje` avant toute identification). `list_my_orders` (20260911100000) refuse explicitement
-- l'anonyme via `is_anonymous_session()` — inadaptée ici. Le seul garde est donc `account_id =
-- auth.uid()`, comme `create_order`/`create_payment_intent` : whitelistée nommément dans
-- security_definer_exposure.test.sql cas 2 (migration suivante), pas is_anonymous_session (qui
-- REFUSE l'anonyme, l'inverse du besoin) ni partner_id_for_account (sans rapport).
create or replace function public.list_pending_orders_for_viewer()
returns table (
  id uuid,
  reference text,
  access_token text,
  line_statuses text[]
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return;
  end if;

  return query
  with recent_orders as (
    select o.id, o.reference, o.access_token, o.created_at
    from public.orders o
    where o.account_id = v_uid
      and o.payment_status = any(array['unpaid', 'pending'])
    order by o.created_at desc
    limit 10
  )
  select
    r.id,
    r.reference,
    r.access_token,
    coalesce(array_agg(ol.status) filter (where ol.status is not null), '{}')
  from recent_orders r
  left join public.order_lines ol on ol.order_id = r.id
  group by r.id, r.reference, r.access_token, r.created_at
  order by r.created_at desc;
end;
$$;

-- PostgreSQL accorde EXECUTE à PUBLIC par défaut sur toute nouvelle fonction (piège documenté
-- .claude/rules/supabase.md, mesuré 2026-08-28/2026-09-10) — revoke explicite avant le grant ciblé,
-- jamais un grant qui suppose l'absence d'accès implicite.
revoke all on function public.list_pending_orders_for_viewer() from public, anon, authenticated;
grant execute on function public.list_pending_orders_for_viewer() to authenticated, anon;
