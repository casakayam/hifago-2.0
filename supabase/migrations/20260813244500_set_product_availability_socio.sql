-- Feature 17 (Socio : gérer directement son propre calendrier de cupos) — 2e évolution de
-- set_product_availability depuis le correctif Tranche 2/3 (feature 5, admin-only). Le cahier des
-- charges socio §3d exige que le prestataire édite son propre calendrier via le MÊME service que
-- l'admin (jamais deux vérités différentes du même calendrier) — donc étendre cette fonction,
-- jamais en dupliquer une deuxième.
--
-- Refactor assumé du contrat de sortie : cette RPC servait un usage strictement admin-only, donc
-- `raise exception` sur chaque garde-fou était cohérent (un non-admin qui l'appelait était
-- forcément une anomalie). Avec un socio comme appelant légitime, « produit d'un autre
-- partenaire » ou « capacité suspendue » deviennent des issues métier normales, pas des anomalies
-- — retourne désormais jsonb {ok, reason}, jamais une exception pour ces cas. Effet de bord :
-- l'écran admin (feature 5) attrapait une exception générique, retouché pour lire
-- data.ok/data.reason (cf. components/availability-calendar.tsx).
--
-- Constat (au moment d'appliquer cette migration) : Postgres refuse un `create or replace
-- function` qui change le type de retour (`void` → `jsonb`, SQLSTATE 42P13) — un `drop` explicite
-- est nécessaire avant la recréation. Effet de bord non anticipé par le plan : `drop function`
-- supprime aussi les grants existants, `grant execute` doit donc être reposé explicitement
-- ci-dessous, pas seulement laissé "inchangé depuis le correctif".
drop function if exists set_product_availability(uuid, date, int, boolean, text);

create or replace function set_product_availability(
  p_product_id uuid,
  p_date date,
  p_capacity int,
  p_open boolean default true,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account_id uuid := auth.uid();
  v_is_admin boolean;
  v_partner_id uuid;
  v_establishment_id uuid;
  v_before_capacity int;
  v_before_booked int;
  v_before_open boolean;
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
$$;

-- Reposé explicitement : le drop ci-dessus a supprimé le grant existant du correctif Tranche 2/3
-- (cf. constat en tête de fichier) — un socio est un compte authenticated comme un autre, même
-- rôle cible qu'avant.
grant execute on function set_product_availability(uuid, date, int, boolean, text) to authenticated;
