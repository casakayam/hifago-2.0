-- Correctif du garde-fou posé une heure plus tôt (20260827230000) — trouvé par la revue
-- `/simplify`, et vérifié en base avant d'être cru.
--
-- LE DÉFAUT. Le garde s'armait sur `v_unit_count is not null and v_lodging_kind is not null`. Or
-- `products.lodging_kind` est NULLABLE — l'écran la présente comme « opcional », et Lobby ne la
-- renseigne pas quand la catégorie n'a pas de type. Constat en base au moment d'écrire ceci : les
-- CINQ logements existants ont `lodging_kind = NULL`. Le garde ne s'armait donc pour aucun d'eux.
--
-- La version d'origine ne pouvait pas avoir ce défaut : elle testait `quantity is not null` seul,
-- parce que `product_room_types.kind` était `not null`. En transposant la formule j'ai transposé
-- aussi une condition qui n'existait que par accident de schéma.
--
-- LE CORRECTIF, et son arbitrage. Le garde s'arme désormais dès que `unit_count` est renseigné.
-- Reste à décider quelle borne appliquer quand on ignore le type de couchage : sans lui, on ne sait
-- pas si l'on vend des LITS ou des UNITÉS. On retient la borne HAUTE (`unit_count × capacity`),
-- c'est-à-dire la plus permissive des deux.
--
-- Pourquoi la plus permissive : ce garde existe pour arrêter une faute de frappe (999 au lieu de 9),
-- pas pour arbitrer un modèle de vente. Prendre la borne basse bloquerait un dortoir légitime dont
-- le socio n'a simplement pas renseigné le type — un refus incompréhensible sur une donnée
-- facultative. La borne haute reste un plafond physique réel et remplit le rôle attendu.
--
-- SECOND CHANGEMENT, sans effet visible : `products` n'est plus lue deux fois. Le chemin non-admin
-- lisait déjà cette ligne pour vérifier la propriété, et le garde la relisait 25 lignes plus bas.
-- Une seule lecture sert les deux.

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
  -- Une seule lecture de `products` pour les deux besoins (propriété ET capacité physique) :
  -- le chemin non-admin la faisait déjà, le garde-fou physique la refaisait 25 lignes plus bas.
  select establishment_id, lodging_kind, unit_count, capacity
    into v_establishment_id, v_lodging_kind, v_unit_count, v_unit_capacity
    from public.products where id = p_product_id;

  if not v_is_admin then
    v_partner_id := (select public.partner_id_for_account(v_account_id));

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
  if v_unit_count is not null then
    v_max_capacity := case
      when v_lodging_kind is null then v_unit_count * coalesce(v_unit_capacity, 1)
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
