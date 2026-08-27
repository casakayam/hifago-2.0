-- Le garde-fou `capacity_exceeds_physical` revient, porté sur `products` — dernière pièce de T2
-- (spec 24 §4), laissée ouverte par T3 étape 2.
--
-- CE QU'IL EMPÊCHE. Ouvrir plus de places qu'il n'en existe physiquement : un dortoir de 6 lits
-- en 2 exemplaires ne peut pas vendre 30 nuitées pour une même date. Sans lui, rien n'arrête une
-- faute de frappe dans `set_product_availability` — et la survente qui en découle ne se voit qu'au
-- moment où deux clients se présentent pour le même lit.
--
-- D'OÙ IL VIENT. Il vivait dans `set_room_type_availability` (migration 20260817210000), supprimée
-- avec les chambres par 20260827220000. La formule est la sienne, transposée terme à terme :
--
--     avant : kind = 'dorm' ? quantity × capacity : quantity        (product_room_types)
--     après : lodging_kind = 'dorm' ? unit_count × capacity : unit_count   (products)
--
-- Elle suit ce qu'on VEND. Un dortoir se vend au LIT, donc le produit des deux. Une chambre privée
-- se vend à l'UNITÉ, donc le nombre d'unités seul. `whole_house` — qui n'existait pas du temps des
-- chambres — suit `private` : on ne loue pas une maison à la personne.
--
-- CE QU'IL NE TOUCHE PAS. Un produit sans `unit_count` ou sans `lodging_kind` passe exactement
-- comme avant : une activité n'a pas de capacité physique en ce sens, et un logement dont les
-- unités ne sont pas renseignées n'a rien à quoi se comparer. Le garde est donc strictement
-- additif pour tous les types autres que lodging.

create or replace function public.set_product_availability(p_product_id uuid, p_date date, p_capacity integer, p_open boolean DEFAULT true, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_account_id uuid := auth.uid();
  v_is_admin boolean;
  v_partner_id uuid;
  v_establishment_id uuid;
  v_before_capacity int;
  v_before_booked int;
  v_before_open boolean;
  v_lodging_kind text;
  v_unit_count int;
  v_unit_capacity int;
  v_max_capacity int;
begin
  if v_account_id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;

  v_is_admin := (select public.is_admin(v_account_id));

  -- Garde-fous 1+2+3 (identité/propriété/capacité), mêmes que submit_product_proposal (feature
  -- 15), même ordre — UNIQUEMENT pour un appelant non-admin. Le chemin admin reste strictement
  -- inchangé : verrouillage et logique de capacité identiques à avant.
  if not v_is_admin then
    v_partner_id := (select public.partner_id_for_account(v_account_id));
    select establishment_id into v_establishment_id
      from public.products where id = p_product_id;

    if v_establishment_id is null or not exists (
      select 1 from public.establishments
       where id = v_establishment_id and partner_id = v_partner_id
    ) then
      return jsonb_build_object('ok', false, 'reason', 'product_not_found');
    end if;

    if not (select public.has_capability(v_account_id, 'operator', v_establishment_id)) then
      return jsonb_build_object('ok', false, 'reason', 'capability_suspended');
    end if;
  end if;

  -- Garde-fou physique, PORTÉ depuis set_room_type_availability (20260817210000), que T3 étape 2
  -- a supprimée avec les chambres. Il empêche d'ouvrir plus de places qu'il n'en existe
  -- réellement — un dortoir de 6 lits en 2 exemplaires ne peut pas vendre 30 nuitées.
  --
  -- La formule suit ce qu'on VEND, et c'est celle d'origine transposée de kind/quantity vers
  -- lodging_kind/unit_count : un dortoir se vend au LIT (unit_count × capacity), une chambre
  -- privée ou une maison entière se vend à l'UNITÉ (unit_count). `whole_house`, qui n'existait pas
  -- du temps des chambres, suit private — on ne loue pas une maison à la personne.
  --
  -- Ne s'applique qu'aux logements dont unit_count est renseigné : une activité n'a pas de capacité
  -- physique en ce sens, et un logement sans unit_count n'a rien à quoi se comparer. Le chemin des
  -- autres types reste donc strictement inchangé.
  select p.lodging_kind, p.unit_count, p.capacity
    into v_lodging_kind, v_unit_count, v_unit_capacity
    from public.products p where p.id = p_product_id;

  if v_unit_count is not null and v_lodging_kind is not null then
    v_max_capacity := case
      when v_lodging_kind = 'dorm' then v_unit_count * coalesce(v_unit_capacity, 1)
      else v_unit_count
    end;
    if p_capacity > v_max_capacity then
      return jsonb_build_object('ok', false, 'reason', 'capacity_exceeds_physical', 'max', v_max_capacity);
    end if;
  end if;

  select capacity, booked into v_before_capacity, v_before_booked
    from public.product_availability
   where product_id = p_product_id and date = p_date
   for update;

  if found and p_capacity < v_before_booked then
    return jsonb_build_object('ok', false, 'reason', 'below_booked', 'booked', v_before_booked);
  end if;

  if found then
    update public.product_availability set capacity = p_capacity
     where product_id = p_product_id and date = p_date;
  else
    insert into public.product_availability (product_id, date, capacity, booked)
    values (p_product_id, p_date, p_capacity, 0);
  end if;

  select open into v_before_open from public.product_calendar
   where product_id = p_product_id and date = p_date;

  insert into public.product_calendar (product_id, date, open)
  values (p_product_id, p_date, p_open)
  on conflict (product_id, date) do update set open = excluded.open;

  -- Journalisation réservée aux écritures admin : un socio qui gère sa propre disponibilité n'a
  -- pas besoin d'être audité comme un admin (cahier des charges socio §3d, "lui appartient par
  -- nature") — et log_admin_action refuserait l'appel de toute façon pour un non-admin.
  if v_is_admin then
    perform public.log_admin_action(
      'product.set_availability', 'product_availability', p_product_id,
      jsonb_build_object('date', p_date, 'capacity', v_before_capacity, 'booked', v_before_booked, 'open', v_before_open),
      jsonb_build_object('date', p_date, 'capacity', p_capacity, 'open', p_open),
      p_note
    );
  end if;

  return jsonb_build_object('ok', true);
end;
$function$
;
