-- Correctif Tranche 2/3 — fermeture de calendrier appliquée + RPC d'édition des cupos.
-- Constat : product_calendar.open/closed_slot (Tranche 2, RLS directe admin) n'était jamais lu
-- par reserve_order_line (Tranche 3) — une date explicitement fermée restait réservable tant
-- qu'il restait de la capacité configurée. products.calendar_default_open (posée en Tranche 2)
-- n'était non plus jamais consommée. Ce correctif branche l'un et l'autre, et ajoute la RPC de
-- cupos manquante. schedule='slot' (granularité créneau) reste hors périmètre — aucun produit de
-- ce type n'existe encore dans le seed, différé à une feature dédiée.

-- 1. reserve_order_line (Tranche 3, create or replace — migration d'origine jamais réécrite) :
-- vérification de fermeture AJOUTÉE APRÈS le verrouillage FOR UPDATE de product_availability,
-- jamais avant — c'est ce même verrou, partagé avec set_product_availability ci-dessous, qui
-- sérialise les deux opérations : lire product_calendar après l'avoir obtenu suffit à voir l'état
-- réellement à jour (lecture read-committed post-verrou), sans verrou supplémentaire sur
-- product_calendar elle-même. Une vérification placée avant le FOR UPDATE laisserait une fenêtre
-- où un client ayant lu open=true pourrait aboutir sur une date qu'un admin vient de fermer.
create or replace function reserve_order_line(
  p_product_id uuid,
  p_date date,
  p_qty int,
  p_holder_name text,
  p_holder_email text default null,
  p_holder_phone text default null
)
returns jsonb
language plpgsql
security definer         -- obligatoire : contourne RLS explicitement pour cette RPC
set search_path = ''     -- obligatoire : jamais omis sur une fonction SECURITY DEFINER
as $$
declare
  v_account_id uuid := auth.uid();
  v_capacity int;
  v_booked int;
  v_calendar_open boolean;
  v_order_id uuid;
  v_line_id uuid;
begin
  if v_account_id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;

  -- Verrouillage explicite : bloque toute autre transaction visant la même ligne
  -- jusqu'au commit/rollback de celle-ci. C'est CE verrou, pas une vérification
  -- applicative préalable, qui garantit l'invariant sous concurrence réelle.
  select capacity, booked
    into v_capacity, v_booked
    from public.product_availability
   where product_id = p_product_id
     and date = p_date
   for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'slot_not_found');
  end if;

  -- Fermeture de calendrier, lue APRÈS le verrou ci-dessus (jamais avant, cf. commentaire en
  -- tête de fonction). Une ligne product_calendar explicite prime toujours sur le défaut du
  -- produit (calendar_default_open) ; sans ligne explicite pour cette date, le défaut s'applique.
  select coalesce(pc.open, p.calendar_default_open)
    into v_calendar_open
    from public.products p
    left join public.product_calendar pc
      on pc.product_id = p.id and pc.date = p_date
   where p.id = p_product_id;

  if not v_calendar_open then
    return jsonb_build_object('ok', false, 'reason', 'date_closed');
  end if;

  if v_booked + p_qty > v_capacity then
    return jsonb_build_object('ok', false, 'reason', 'full', 'capacity', v_capacity, 'booked', v_booked);
  end if;

  update public.product_availability
     set booked = booked + p_qty
   where product_id = p_product_id
     and date = p_date;

  insert into public.orders (account_id, holder_name, holder_email, holder_phone)
  values (v_account_id, p_holder_name, p_holder_email, p_holder_phone)
  returning id into v_order_id;

  insert into public.order_lines (order_id, account_id, product_id, date, qty)
  values (v_order_id, v_account_id, p_product_id, p_date, p_qty)
  returning id into v_line_id;

  return jsonb_build_object('ok', true, 'order_id', v_order_id, 'order_line_id', v_line_id);
end;
$$;

-- 2. product_calendar reclassée RPC-only — corrigé (bug bloquant identifié en audit) : la
-- Tranche 2 avait posé product_calendar en RLS directe (product_calendar_write_admin) faute de
-- capacité liée à l'époque. Ce correctif la fait écrire par set_product_availability
-- (verrouillée, auditée) sans révoquer l'ancienne policy directe, un admin pourrait contourner
-- entièrement le verrouillage et l'audit de cette RPC en écrivant product_calendar.open en
-- direct. Seule set_product_availability peut désormais y écrire, pour personne d'autre — lecture
-- publique (product_calendar_select_public) inchangée.
revoke insert, update, delete on product_calendar from authenticated, anon;
drop policy if exists product_calendar_write_admin on product_calendar;

-- 3. set_product_availability — security definer (contrairement à create_establishment/
-- set_product_sellable) : product_availability et product_calendar sont RPC-only, aucun accès
-- RLS direct même pour l'admin, pas de raccourci security invoker possible ici.
create or replace function set_product_availability(
  p_product_id uuid,
  p_date date,
  p_capacity int,
  p_open boolean default true,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before_capacity int;
  v_before_booked int;
  v_before_open boolean;
begin
  if not (select public.is_admin(auth.uid())) then
    raise exception 'set_product_availability réservé au rôle admin' using errcode = '42501';
  end if;

  select capacity, booked into v_before_capacity, v_before_booked
    from public.product_availability
   where product_id = p_product_id and date = p_date
   for update;

  if found and p_capacity < v_before_booked then
    raise exception 'capacité (%) inférieure aux places déjà vendues (%)', p_capacity, v_before_booked;
  end if;

  if found then
    update public.product_availability set capacity = p_capacity
     where product_id = p_product_id and date = p_date;
  else
    insert into public.product_availability (product_id, date, capacity, booked)
    values (p_product_id, p_date, p_capacity, 0);
  end if;

  select open into v_before_open
    from public.product_calendar
   where product_id = p_product_id and date = p_date;

  insert into public.product_calendar (product_id, date, open)
  values (p_product_id, p_date, p_open)
  on conflict (product_id, date) do update set open = excluded.open;

  -- entity_id = product_id (pas l'id de la ligne product_availability, sans signification isolée
  -- de sa date) — la date voyage donc dans before/after plutôt que dans entity_id, léger écart à
  -- la convention du correctif audit_log, documenté ici pour ne pas surprendre une future lecture.
  perform public.log_admin_action(
    'product.set_availability', 'product_availability', p_product_id,
    jsonb_build_object('date', p_date, 'capacity', v_before_capacity, 'booked', v_before_booked, 'open', v_before_open),
    jsonb_build_object('date', p_date, 'capacity', p_capacity, 'open', p_open),
    p_note
  );
end;
$$;

-- Le privilège par défaut sur une fonction créée par le rôle postgres n'inclut pas EXECUTE pour
-- anon/authenticated (cf. hifago/CLAUDE.md §11) — accordé explicitement à authenticated (le
-- contrôle d'accès réel est le is_admin() interne ci-dessus, pas ce grant).
grant execute on function set_product_availability(uuid, date, int, boolean, text) to authenticated;
