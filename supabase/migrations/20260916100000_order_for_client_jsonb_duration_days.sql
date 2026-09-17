-- Une ligne camp ne porte jamais `end_date` (réservé à lodging, 20260910140000 §121) : sa durée
-- vit sur `products.duration_days`, pas sur la ligne. `getCartLines` l'expose déjà depuis
-- 20260915100000 (spec camp_missing_lodging) ; `order_for_client_jsonb` ne le faisait pas, donc
-- `/reserva/<jeton>` et `/cuenta/reservas` n'affichaient que la date de DÉPART d'un camp, jamais
-- sa date de fin (constaté sur `campamento-1`, écran panier corrigé le même jour). Même formule
-- de reconstitution côté écran (`ultimoDiaCampIso`, `apps/web/lib/cart/campMissingLodging.ts`) —
-- cette migration ne fait qu'exposer la donnée qui lui manquait, jamais un calcul en base.
--
-- Seule la fonction PARTAGÉE change (`20260911100000_contrat_commande_client.sql` §1) : elle seule
-- construit la ligne, `get_order_by_token` et `list_my_orders` en héritent sans y toucher.
-- `create or replace` : signature identique (même paramètre, même `returns jsonb`), donc pas de
-- `drop function` préalable (`.claude/rules/supabase.md` §7). Corps repris à l'identique de
-- 20260911100000, un seul champ ajouté.
create or replace function public.order_for_client_jsonb(p_order public.orders)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with lignes as (
    select
      jsonb_build_object(
        'id', ol.id,
        'product_name', p.name,
        'product_type', p.type,
        'product_slug', p.slug,
        'establishment_name', e.name,
        'establishment_slug', e.slug,
        'establishment_contact_phone', e.contact_phone,
        'date', ol.date,
        'end_date', ol.end_date,
        -- `duration_days` — NUL pour tout ce qui n'est pas `camp` (contrainte
        -- `products_duration_days_required_for_camp`, 20260814220000). L'écran reconstitue la
        -- date de fin d'un camp à partir de `date` + cette valeur, jamais l'inverse.
        'duration_days', p.duration_days,
        'slot_start_time', ol.slot_start_time,
        'qty', ol.qty,
        'price_cop', ol.price_cop,
        'total_cop', ol.total_cop,
        'acompte_cop', ol.acompte_cop,
        'status', ol.status
      ) as ligne,
      ol.created_at as ligne_created_at,
      ol.id as ligne_id,
      ol.total_cop as ligne_total_cop,
      ol.acompte_cop as ligne_acompte_cop,
      (ol.status not in ('cancelled_by_client', 'cancelled_by_provider', 'expired', 'superseded'))
        as vivante
    from public.order_lines ol
    join public.products p on p.id = ol.product_id
    left join public.establishments e on e.id = p.establishment_id
    where ol.order_id = (p_order).id
  )
  select jsonb_build_object(
    'id', (p_order).id,
    'reference', (p_order).reference,
    'payment_status', (p_order).payment_status,
    'created_at', (p_order).created_at,
    'holder_name', (p_order).holder_name,
    'holder_phone', (p_order).holder_phone,
    'holder_email', (p_order).holder_email,
    'total_cop', coalesce(sum(ligne_total_cop) filter (where vivante), 0),
    'acompte_cop', coalesce(sum(ligne_acompte_cop) filter (where vivante), 0),
    -- Ordre INCHANGÉ (20260911100000) : les assertions pgTAP indexent `lines,0`.
    'lines', coalesce(jsonb_agg(ligne order by ligne_created_at, ligne_id), '[]'::jsonb)
  )
  from lignes;
$$;

revoke all on function public.order_for_client_jsonb(public.orders) from public, anon, authenticated;

comment on function public.order_for_client_jsonb(public.orders) is
  'LE contrat « une commande vue par son client » (spec 34, étendu 20260916 avec duration_days '
  'par ligne pour la date de fin d''un camp). Appelée par get_order_by_token (garde = le jeton) et '
  'list_my_orders (garde = l''identité) : une seule définition de ce qu''un client peut voir. '
  'Exclut TOUTE colonne de commission — get_order_by_token.test.sql compte les clés. Jamais '
  'exposée : revoke all, appelable seulement par ses deux appelants security definer.';
