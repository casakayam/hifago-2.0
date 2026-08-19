-- Spec 19 §0 Tranche 1 — job d'expiration des commandes dont le paiement n'a jamais abouti dans la
-- fenêtre de grâce (30 minutes, §10 point 14, validé par Jérôme le 2026-08-18). Pattern déjà
-- tranché en architecture cible (04-architecture-cible.md:468-498) : pg_cron, sans Fly ni service
-- tiers de jobs. Ici, AUCUN appel externe (contrairement au connecteur PMS) : pas besoin de pg_net,
-- une simple fonction SQL suffit.
--
-- Condition élargie par rapport à la lettre de la spec (« payment_status='pending' ») : couvre
-- AUSSI payment_status='unpaid' — une commande dont create_payment_intent n'a jamais été appelée
-- avec succès (crash navigateur avant la redirection Checkout Pro, juste après create_order)
-- resterait sinon 'unpaid'/'reserved' indéfiniment, cupo bloqué pour toujours, sans jamais entrer
-- dans le champ de la condition littérale. orders.created_at sert de référence unique (pas
-- payments.created_at) : dans le parcours réel, create_payment_intent est appelé dans le même
-- cycle de requête que create_order (spec §4 étape 2), donc quasi simultané — et cette référence
-- unique couvre uniformément les deux cas (intent créé ou jamais créé).
create extension if not exists pg_cron with schema extensions;

create or replace function expire_stale_payment_orders()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stale_order_ids uuid[];
begin
  -- Verrouillage du lot entier en une requête (au lieu d'un curseur `for ... loop` qui verrouillait
  -- commande par commande) — FOR UPDATE interdit dans une requête portant un agrégat (array_agg),
  -- d'où la CTE : verrouillage dans le WITH, agrégation seulement dans le SELECT englobant.
  with stale as (
    select o.id
      from public.orders o
     where o.payment_status in ('unpaid', 'pending')
       and o.created_at < now() - interval '30 minutes'
       and exists (
         select 1 from public.order_lines ol where ol.order_id = o.id and ol.status = 'reserved'
       )
     for update of o
  )
  select array_agg(id) into v_stale_order_ids from stale;

  if v_stale_order_ids is null then
    return;
  end if;

  -- 4 UPDATE set-based sur tout le lot verrouillé, au lieu de 4×N (un par commande dans l'ancienne
  -- boucle) — même prédicat que l'ancienne version, juste `order_id = v_order.id` élargi en
  -- `order_id = any(v_stale_order_ids)`.
  update public.order_lines
     set status = 'expired'
   where order_id = any(v_stale_order_ids) and status = 'reserved';

  -- Même effet ledger que set_order_line_status(..., 'expired', ...) (branche 'expired') pour une
  -- ligne référée par un référent externe — factorisé dans apply_order_line_ledger_transition
  -- (20260818150000), appelée ici avec tout le lot de lignes venant d'expirer dans ce run plutôt
  -- qu'un appel par ligne : cette RPC-gardée exige is_admin(auth.uid()) qu'un job système ne peut
  -- jamais satisfaire (aucune session), d'où l'appel direct à la fonction interne partagée. Filtre
  -- `ol.status = 'expired'` (pas seulement les lignes juste mises à jour ci-dessus) : même portée
  -- que l'ancienne version par commande, qui aurait aussi retenté une ligne déjà 'expired' plus tôt
  -- (no-op si son ledger est déjà 'void', jamais un trou de couverture).
  perform public.apply_order_line_ledger_transition(
    (select coalesce(array_agg(ol.id), array[]::uuid[])
       from public.order_lines ol
      where ol.order_id = any(v_stale_order_ids) and ol.status = 'expired'),
    'expired'
  );

  update public.payments
     set status = 'cancelled', updated_at = now()
   where order_id = any(v_stale_order_ids) and status = 'pending';

  update public.orders
     set payment_status = 'unpaid'
   where id = any(v_stale_order_ids);
end;
$$;

-- Aucun grant à anon/authenticated/service_role : appelée uniquement par pg_cron, qui exécute en
-- tant que propriétaire de la fonction (postgres) — un security definer se suffit à lui-même ici.
select cron.schedule('expire-stale-payment-orders', '*/5 * * * *', $$select expire_stale_payment_orders();$$);
