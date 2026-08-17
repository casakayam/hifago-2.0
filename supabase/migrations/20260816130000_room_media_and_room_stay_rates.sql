-- Suite de la spec 13 (docs/specs/13-admin-hotel-habitaciones.md §10, points signalés puis
-- explicitement demandés par Jérôme) : photos par chambre + prix par période par chambre.
--
-- Prix par période : réactive le mécanisme stay_rates déjà construit pour l'alojamiento (spec 12),
-- posé cette fois sur product_room_types plutôt que products — aucun nouveau mécanisme.
alter table product_room_types add column stay_rates jsonb;

-- Photos par chambre : même patron exact que product_media/establishment_media
-- (20260815110000_gestion_images.sql) — RLS lecture héritée du parent, écriture admin.
create table room_media (
  id uuid primary key default gen_random_uuid(),
  room_type_id uuid not null references product_room_types(id) on delete cascade,
  storage_path text not null,
  sort int not null default 0,
  created_at timestamptz not null default now()
);
create index room_media_room_type_id_idx on room_media(room_type_id);
alter table room_media enable row level security;
create policy room_media_select on room_media
  for select using (exists (select 1 from product_room_types r where r.id = room_media.room_type_id));
create policy room_media_write_admin on room_media
  for all using ((select is_admin(auth.uid())));

-- Extension mécanique de add_catalog_media/reorder_gallery à 'room_type' — même signature exacte,
-- pas de drop nécessaire. Comportement product/establishment strictement inchangé.
create or replace function add_catalog_media(
  p_entity_type text,      -- 'product' | 'establishment' | 'room_type'
  p_entity_id uuid,
  p_storage_path text,
  p_sort int default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_media_id uuid;
  v_count int;
  v_next_sort int;
  v_table text;
begin
  if not (select public.is_admin(auth.uid())) then
    raise exception 'add_catalog_media réservé au rôle admin' using errcode = '42501';
  end if;
  if p_entity_type not in ('product', 'establishment', 'room_type') then
    raise exception 'p_entity_type invalide : %', p_entity_type;
  end if;
  v_table := case p_entity_type
    when 'product' then 'product_media'
    when 'establishment' then 'establishment_media'
    else 'room_media'
  end;

  if p_entity_type = 'product' then
    select count(*), coalesce(max(sort), -1) + 1 into v_count, v_next_sort
      from public.product_media where product_id = p_entity_id;
  elsif p_entity_type = 'establishment' then
    select count(*), coalesce(max(sort), -1) + 1 into v_count, v_next_sort
      from public.establishment_media where establishment_id = p_entity_id;
  else
    select count(*), coalesce(max(sort), -1) + 1 into v_count, v_next_sort
      from public.room_media where room_type_id = p_entity_id;
  end if;

  -- Plafond 6 uniforme (décision Jérôme 2026-08-14) — étendu tel quel aux chambres.
  if v_count >= 6 then
    raise exception 'plafond de 6 photos déjà atteint pour cette galerie' using errcode = 'P0001';
  end if;

  if p_entity_type = 'product' then
    insert into public.product_media (product_id, storage_path, sort)
    values (p_entity_id, p_storage_path, coalesce(p_sort, v_next_sort))
    returning id into v_media_id;
  elsif p_entity_type = 'establishment' then
    insert into public.establishment_media (establishment_id, storage_path, sort)
    values (p_entity_id, p_storage_path, coalesce(p_sort, v_next_sort))
    returning id into v_media_id;
  else
    insert into public.room_media (room_type_id, storage_path, sort)
    values (p_entity_id, p_storage_path, coalesce(p_sort, v_next_sort))
    returning id into v_media_id;
  end if;

  perform public.log_admin_action('catalog_media.add', v_table, v_media_id, null,
    jsonb_build_object('entity_type', p_entity_type, 'entity_id', p_entity_id,
      'storage_path', p_storage_path),
    null);

  return v_media_id;
end;
$$;

create or replace function reorder_gallery(
  p_entity_type text,          -- 'product' | 'establishment' | 'room_type'
  p_entity_id uuid,
  p_ordered_media_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account_id uuid := auth.uid();
  v_is_admin boolean;
  v_owner_ok boolean;
  v_expected_count int;
  v_given_count int;
begin
  if p_entity_type not in ('product', 'establishment', 'room_type') then
    raise exception 'p_entity_type invalide : %', p_entity_type;
  end if;

  v_is_admin := (select public.is_admin(v_account_id));

  if not v_is_admin then
    -- Une chambre n'a aujourd'hui aucun flux socio (gestion hôtel admin-only, spec 13) — même
    -- refus que pour establishment : seul 'product' a un chemin socio légitime.
    if p_entity_type <> 'product' then
      return jsonb_build_object('ok', false, 'reason', 'not_authorized');
    end if;
    select exists (
      select 1 from public.products p
       where p.id = p_entity_id
         and (select public.has_capability(v_account_id, 'operator', p.establishment_id))
    ) into v_owner_ok;
    if not v_owner_ok then
      return jsonb_build_object('ok', false, 'reason', 'not_authorized');
    end if;
  end if;

  if p_entity_type = 'product' then
    select count(*) into v_expected_count
      from public.product_media where product_id = p_entity_id;
  elsif p_entity_type = 'establishment' then
    select count(*) into v_expected_count
      from public.establishment_media where establishment_id = p_entity_id;
  else
    select count(*) into v_expected_count
      from public.room_media where room_type_id = p_entity_id;
  end if;
  v_given_count := coalesce(array_length(p_ordered_media_ids, 1), 0);

  -- Liste incomplète/en trop : refus explicite plutôt qu'un réordonnancement partiel silencieux.
  if v_given_count <> v_expected_count then
    return jsonb_build_object('ok', false, 'reason', 'incomplete_order');
  end if;

  if p_entity_type = 'product' then
    update public.product_media m
       set sort = o.ord - 1
      from unnest(p_ordered_media_ids) with ordinality as o(id, ord)
     where m.id = o.id and m.product_id = p_entity_id;
  elsif p_entity_type = 'establishment' then
    update public.establishment_media m
       set sort = o.ord - 1
      from unnest(p_ordered_media_ids) with ordinality as o(id, ord)
     where m.id = o.id and m.establishment_id = p_entity_id;
  else
    update public.room_media m
       set sort = o.ord - 1
      from unnest(p_ordered_media_ids) with ordinality as o(id, ord)
     where m.id = o.id and m.room_type_id = p_entity_id;
  end if;

  return jsonb_build_object('ok', true);
end;
$$;
