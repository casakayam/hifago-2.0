-- Spec 39 (Lot B) — deux trous des deux chemins de secours (cron + surveillance 48h), trouvés en
-- relecture de la PR #2 avant fusion (jamais en préprod) :
--
-- (1) reconcile_order et record_mp_payment_status ne routaient vers apply_payment_webhook_checked
--     que les paiements MP au statut 'approved'. La branche refunded/charged_back d'
--     apply_payment_webhook (Lot B, 20260921100000, entrée refunded_externally pour l'admin)
--     n'était donc atteignable QUE par le webhook temps réel — exactement le canal qui peut rester
--     cassé un mois sans que rien ne le montre (HFG-000013). Un remboursement/contracargo détecté
--     uniquement par un des deux chemins de secours restait invisible.
-- (2) record_mp_payment_status (surveillance 48h) n'avait aucune vérification d'identité du token
--     MP, contrairement à reconcile_order qui porte la garde `identity_mismatch` ajoutée
--     spécifiquement pour le piège 19 (deux comptes MP, cause racine de HFG-000013).
--
-- reconcile_order : CREATE OR REPLACE, signature intacte (§7 point 7 ne s'applique qu'à un
-- changement de signature) — deux modifications comptées dans son unique boucle de décision :
--   (a) le filtre `where m->>'status' = 'approved'` devient `in ('approved', 'refunded',
--       'charged_back')` ;
--   (b) l'appel à apply_payment_webhook_checked, qui passait 'approved' EN DUR (correct tant que
--       (a) filtrait dessus), transmet désormais le vrai statut (`v_mp.m->>'status'`) — sans ce
--       second changement, (a) seul aurait fait passer un refunded pour un approved.
-- Le reste du corps (verrou orders, garde identity_mismatch, décisions pending/expiry) est
-- inchangé et n'est pas retapé ici au-delà des deux lignes touchées.
create or replace function public.reconcile_order(
  p_order_id uuid,
  p_mp_payments jsonb,
  p_checked_at timestamptz,
  p_collector_id text,
  p_expiry_margin interval default interval '2 minutes'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order record;
  v_local record;
  v_mp record;
  v_live boolean;
  v_pending_ids text[] := array[]::text[];
  v_pending_anchor timestamptz;
  v_result jsonb;
  v_applied boolean := false;
  v_status_after text;
begin
  select id, payment_status, created_at into v_order
    from public.orders where id = p_order_id for update;
  if not found then
    return jsonb_build_object('action', 'noop', 'reason', 'order_not_found');
  end if;

  select exists (
    select 1 from public.order_lines ol
     where ol.order_id = p_order_id and ol.status in ('reserved', 'fulfilled', 'no_show')
  ) into v_live;

  if v_order.payment_status not in ('unpaid', 'pending') then
    update public.orders set reconcile_checked_at = now() where id = p_order_id;
    return jsonb_build_object('action', 'noop', 'reason', 'not_candidate');
  end if;

  -- Identité du token : une recherche vide avec le token d'un AUTRE compte MP est exactement
  -- l'incident du 2026-09-20 — elle ne vaut jamais « pas payé ».
  if exists (
    select 1 from public.payments p
     where p.order_id = p_order_id and p.mp_collector_id is not null
       and p_collector_id is not null and p.mp_collector_id <> p_collector_id
  ) then
    return jsonb_build_object('action', 'identity_mismatch');
  end if;

  -- Dernier statut MP connu par paiement local ('none' si MP n'a rien renvoyé).
  for v_local in select p.id from public.payments p where p.order_id = p_order_id loop
    select m->>'status' as status into v_mp
      from jsonb_array_elements(coalesce(p_mp_payments, '[]'::jsonb)) m
     where (m->>'payment_id')::uuid = v_local.id
     order by m->>'date_created' desc nulls last
     limit 1;
    update public.payments
       set mp_last_status = coalesce(v_mp.status, 'none'), mp_last_checked_at = p_checked_at
     where id = v_local.id;
  end loop;

  -- Paiements approuvés OU remboursés/contestés après coup, du plus ancien au plus récent : la
  -- garde du Lot A (rien à honorer, double paiement) et la branche refunded/charged_back du Lot B
  -- décident toutes deux dans apply_payment_webhook_checked ; ici on ne fait que transmettre le
  -- statut réel de chaque paiement, jamais un statut supposé.
  for v_mp in
    select m from jsonb_array_elements(coalesce(p_mp_payments, '[]'::jsonb)) m
     where m->>'status' in ('approved', 'refunded', 'charged_back')
     order by m->>'date_created' asc nulls last
  loop
    v_result := public.apply_payment_webhook_checked(
      v_mp.m->>'mp_payment_id', (v_mp.m->>'payment_id')::uuid, v_mp.m->>'status',
      (v_mp.m->>'transaction_amount')::numeric, v_mp.m
    );
    v_applied := true;
  end loop;

  select payment_status into v_status_after from public.orders where id = p_order_id;
  if v_status_after = 'paid' then
    update public.orders set reconcile_checked_at = now() where id = p_order_id;
    return jsonb_build_object('action', 'applied');
  end if;

  select array_agg(m->>'mp_payment_id'), min((select p.created_at from public.payments p where p.id = (m->>'payment_id')::uuid))
    into v_pending_ids, v_pending_anchor
    from jsonb_array_elements(coalesce(p_mp_payments, '[]'::jsonb)) m
   where m->>'status' in ('pending', 'in_process', 'authorized', 'in_mediation');

  if not v_live then
    -- Plus rien à honorer : on ferme localement (les paiements approuvés ont déjà produit leurs
    -- entrées refund_required ci-dessus) ; un pending chez MP est annulé en meilleur effort par
    -- l'Edge Function (rien à attendre, D2 sans délai).
    update public.payments set status = 'cancelled', updated_at = now()
     where order_id = p_order_id and status = 'pending';
    update public.orders set payment_status = 'unpaid', reconcile_checked_at = now()
     where id = p_order_id;
    return jsonb_build_object('action', 'closed',
      'refund_flagged', v_applied,
      'mp_cancel_ids', coalesce(to_jsonb(v_pending_ids), '[]'::jsonb));
  end if;

  if v_pending_ids is not null and array_length(v_pending_ids, 1) > 0 then
    update public.orders set reconcile_checked_at = now() where id = p_order_id;
    if v_pending_anchor + interval '2 hours' > now() then
      return jsonb_build_object('action', 'kept_pending');
    end if;
    return jsonb_build_object('action', 'cancel_at_mp', 'mp_cancel_ids', to_jsonb(v_pending_ids));
  end if;

  if v_order.created_at + interval '30 minutes' + p_expiry_margin < now() then
    v_result := public.expire_payment_order(p_order_id, p_checked_at);
    return jsonb_build_object('action', case when (v_result->>'ok')::boolean then 'expired' else 'kept' end,
                              'expire', v_result);
  end if;

  update public.orders set reconcile_checked_at = now() where id = p_order_id;
  return jsonb_build_object('action', 'kept');
end;
$$;
-- Signature inchangée : revoke/grant déjà posés par 20260921100000, rien à reposer.

-- record_mp_payment_status change de signature (ajout de p_collector_id) : §7 point 7 impose un
-- drop explicite avant recréation, jamais un create or replace sur une signature différente.
drop function public.record_mp_payment_status(uuid, jsonb, timestamptz);

create function public.record_mp_payment_status(
  p_payment_id uuid,
  p_mp_payments jsonb,
  p_checked_at timestamptz,
  p_collector_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment record;
  v_mp record;
  v_result jsonb := jsonb_build_object('action', 'recorded');
begin
  select p.id, p.order_id, p.mp_collector_id into v_payment
    from public.payments p where p.id = p_payment_id;
  if not found then
    return jsonb_build_object('action', 'noop', 'reason', 'payment_not_found');
  end if;
  perform 1 from public.orders where id = v_payment.order_id for update;

  -- Identité du token : même garde que reconcile_order, symétrique — absente jusqu'ici de ce
  -- chemin (piège 19). Une réponse MP sous un token d'un AUTRE compte ne doit jamais être appliquée.
  if v_payment.mp_collector_id is not null and p_collector_id is not null
     and v_payment.mp_collector_id <> p_collector_id then
    return jsonb_build_object('action', 'identity_mismatch');
  end if;

  -- Approuvés OU remboursés/contestés après coup : même raisonnement que reconcile_order, le vrai
  -- statut de chaque paiement est transmis, jamais 'approved' supposé.
  for v_mp in
    select m from jsonb_array_elements(coalesce(p_mp_payments, '[]'::jsonb)) m
     where m->>'status' in ('approved', 'refunded', 'charged_back')
     order by m->>'date_created' asc nulls last
  loop
    v_result := public.apply_payment_webhook_checked(
      v_mp.m->>'mp_payment_id', p_payment_id, v_mp.m->>'status',
      (v_mp.m->>'transaction_amount')::numeric, v_mp.m
    );
  end loop;

  update public.payments
     set mp_last_status = coalesce(
           (select m->>'status' from jsonb_array_elements(coalesce(p_mp_payments, '[]'::jsonb)) m
             order by m->>'date_created' desc nulls last limit 1),
           'none'),
         mp_last_checked_at = p_checked_at
   where id = p_payment_id;
  return v_result;
end;
$$;
revoke all on function public.record_mp_payment_status(uuid, jsonb, timestamptz, text) from public, anon, authenticated;
grant execute on function public.record_mp_payment_status(uuid, jsonb, timestamptz, text) to service_role;
