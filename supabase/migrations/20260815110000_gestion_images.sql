-- Spec dédiée "gestion d'image" (docs/specs/04-gestion-images.md) — remplace le mécanisme
-- provisoire de la feature 28 (docs/specs/03-admin-creation-etablissement.md, `photo_urls`
-- text[] + bucket establishment-photos public/écriture admin seule, explicitement qualifié de
-- "basique et provisoire" par son propre commentaire de migration).
--
-- Portée de CETTE migration : product_media/establishment_media (RLS directe), remplacement du
-- bucket par un pool unique catalog-media, product_proposals.kind (proposition "photos seules"),
-- 3 RPC (add_catalog_media, submit_photos_proposal, extension de moderate_product_proposal,
-- reorder_gallery), et le retrait de p_photo_urls sur create_establishment.
--
-- Frontière RLS/RPC-only (CLAUDE.md §3) tranchée table par table :
-- - product_media/establishment_media : RLS DIRECTE. Aucun des 4 critères RPC-only ne s'applique
--   à une ligne de galerie (pas de compteur de capacité, pas de verrou optimiste multi-admin, pas
--   de lecture inter-identités — la visibilité hérite simplement de celle du produit/établissement
--   parent). L'ajout ADMIN passe par la RPC add_catalog_media pour l'audit nominatif (même
--   convention que create_establishment : RLS-directe sur la table, RPC utilisée par l'écran pour
--   tracer l'action), mais rien ne l'exige techniquement — la policy write_admin reste en place en
--   défense en profondeur. Le RETRAIT par un socio de sa propre galerie DÉJÀ PUBLIÉE est une vraie
--   écriture directe RLS (cahier des charges socio §3f : "retirer/réordonner = écriture directe").
-- - product_proposals reste RPC-only (déjà tranché, 20260813234500) — kind='photos' est une
--   variante de payload, pas un nouveau critère de frontière.
-- - reorder_gallery reste une RPC malgré l'absence de compteur de capacité : justifié par
--   l'atomicité ("liste réécrite en une seule opération", cahier admin §3c), pas par l'audit —
--   un enchaînement de UPDATE PostgREST déclenchés par le navigateur ne garantit pas qu'une
--   coupure réseau à mi-chemin laisse la galerie dans un état cohérent.

-- ============================================================================================
-- 1. product_media / establishment_media
-- ============================================================================================

create table product_media (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  storage_path text not null,
  sort int not null default 0,
  created_at timestamptz not null default now()
);

-- Pas de GRANT explicite : couverte par ALTER DEFAULT PRIVILEGES (20260813163456_identity_rls.sql).
alter table product_media enable row level security;

-- Visibilité héritée du produit parent (le sous-select re-traverse les policies de select déjà
-- posées sur products — sellable=true, admin, ou partenaire propriétaire — jamais dupliquée ici).
create policy product_media_select on product_media
  for select using (exists (
    select 1 from products p where p.id = product_media.product_id
  ));

create policy product_media_write_admin on product_media
  for all using ((select is_admin(auth.uid())));

-- Retrait direct par le socio de sa PROPRE galerie déjà publiée (cahier des charges socio §3f) —
-- has_capability vérifie déjà le statut 'active' (jamais suspendu), stable + security definer,
-- réutilisée telle quelle (checklist migration point 2).
create policy product_media_delete_own on product_media
  for delete using (exists (
    select 1 from products p
     where p.id = product_media.product_id
       and (select has_capability(auth.uid(), 'operator', p.establishment_id))
  ));

create table establishment_media (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references establishments(id) on delete cascade,
  storage_path text not null,
  sort int not null default 0,
  created_at timestamptz not null default now()
);

alter table establishment_media enable row level security;

-- Établissements : galerie 100% admin (cf. §3f cahier socio — les gestes "photos" décrits pour le
-- socio couvrent explicitement "toute famille d'offre" = les types products, jamais
-- l'établissement lui-même ; establishments reste RLS-directe admin depuis sa création,
-- 20260813210000). Aucune policy delete_own ici, volontairement.
create policy establishment_media_select on establishment_media
  for select using (exists (
    select 1 from establishments e where e.id = establishment_media.establishment_id
  ));

create policy establishment_media_write_admin on establishment_media
  for all using ((select is_admin(auth.uid())));

-- ============================================================================================
-- 2. Dépréciation du mécanisme provisoire (feature 28)
-- ============================================================================================

-- Table encore sans donnée réelle en dehors du seed synthétique au moment de cette migration
-- (vérifié : aucune référence à photo_urls dans supabase/seed.sql) — drop direct, même
-- raisonnement que la migration d'origine pour ne pas prévoir de backfill.
alter table establishments drop column photo_urls;

-- L'ancien bucket establishment-photos n'est PAS supprimé : Supabase interdit le DELETE direct
-- sur storage.buckets en migration SQL ("Use the Storage API instead", constaté en appliquant
-- cette migration) — le supprimer proprement demanderait un appel à l'API Storage, hors périmètre
-- d'une migration. Laissé vide et inutilisé (aucune policy d'écriture ne le référence plus après
-- ce bloc) ; un nettoyage via Studio/API reste possible plus tard, non bloquant ici.
drop policy if exists establishment_photos_read on storage.objects;
drop policy if exists establishment_photos_write_admin on storage.objects;

-- Bucket unique pour tout le catalogue (produits ET établissements) — miroir de data/media/
-- legacy, qui sert déjà plusieurs entités depuis un même répertoire. Public en lecture (décision
-- explicite avec Jérôme, 2026-08-14, docs/specs/04-gestion-images.md §3) : la règle "buckets
-- privés uniquement" (04-architecture-cible.md:646) visait les fichiers porteurs de PII
-- (justificatifs), pas les photos de catalogue — SEO, cache CDN, og:image en dépendent.
insert into storage.buckets (id, name, public)
values ('catalog-media', 'catalog-media', true)
on conflict (id) do nothing;

create policy catalog_media_read on storage.objects
  for select using (bucket_id = 'catalog-media');

-- Écriture directe (insert) réservée à l'admin, en défense en profondeur seulement : TOUT upload
-- réel (admin comme socio) passe par le Route Handler service_role (spec §7, contre C29/G5) —
-- aucun client n'écrit jamais directement dans ce bucket depuis le navigateur. Pas de policy de
-- delete côté storage.objects : l'effacement du fichier physique est un geste serveur
-- (service_role) déclenché après la suppression réussie de la ligne product_media/
-- establishment_media, jamais une écriture RLS directe — son échec est absorbé côté app (spec §8,
-- invariant socio §3f repris : jamais remonté comme une erreur à l'utilisateur).
create policy catalog_media_write_admin on storage.objects
  for insert
  with check (bucket_id = 'catalog-media' and (select is_admin(auth.uid())));

-- ============================================================================================
-- 3. product_proposals — proposition "photos seules"
-- ============================================================================================

alter table product_proposals
  add column kind text not null default 'content' check (kind in ('content', 'photos'));

-- ============================================================================================
-- 4. RPC add_catalog_media — admin, écriture directe auditée
-- ============================================================================================

create or replace function add_catalog_media(
  p_entity_type text,      -- 'product' | 'establishment'
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
  if p_entity_type not in ('product', 'establishment') then
    raise exception 'p_entity_type invalide : %', p_entity_type;
  end if;
  v_table := case p_entity_type when 'product' then 'product_media' else 'establishment_media' end;

  if p_entity_type = 'product' then
    select count(*), coalesce(max(sort), -1) + 1 into v_count, v_next_sort
      from public.product_media where product_id = p_entity_id;
  else
    select count(*), coalesce(max(sort), -1) + 1 into v_count, v_next_sort
      from public.establishment_media where establishment_id = p_entity_id;
  end if;

  -- Plafond 6 uniforme (décision explicite Jérôme, 2026-08-14) — s'applique aussi à l'admin, pas
  -- seulement au socio, pour rester réellement "uniforme".
  if v_count >= 6 then
    raise exception 'plafond de 6 photos déjà atteint pour cette galerie' using errcode = 'P0001';
  end if;

  if p_entity_type = 'product' then
    insert into public.product_media (product_id, storage_path, sort)
    values (p_entity_id, p_storage_path, coalesce(p_sort, v_next_sort))
    returning id into v_media_id;
  else
    insert into public.establishment_media (establishment_id, storage_path, sort)
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

grant execute on function add_catalog_media(text, uuid, text, int) to authenticated;

-- ============================================================================================
-- 5. RPC submit_photos_proposal — socio, proposition "photos seules" (produits uniquement)
-- ============================================================================================

-- Même 3 garde-fous que submit_product_proposal (identité/propriété/capacité), même calibrage
-- bas-volume (pas le squelette anti-survente §4 — aucun compteur de capacité touché). Une seule
-- proposition 'photos' en attente par produit : les ajouts suivants s'agrègent dedans plutôt que
-- d'en créer une nouvelle (cahier des charges socio §3f — "réutilisée pour tous les ajouts en
-- attente d'une même fiche, pas une proposition par photo").
create or replace function submit_photos_proposal(p_product_id uuid, p_storage_paths text[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account_id uuid := auth.uid();
  v_partner_id uuid;
  v_establishment_id uuid;
  v_existing record;
  v_has_existing boolean;
  v_proposal_id uuid;
  v_existing_count int;
  v_gallery_count int;
  v_new_photos jsonb;
begin
  if v_account_id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;
  if p_storage_paths is null or array_length(p_storage_paths, 1) is null then
    return jsonb_build_object('ok', false, 'reason', 'no_photos');
  end if;

  v_partner_id := (select public.partner_id_for_account(v_account_id));

  select establishment_id into v_establishment_id
    from public.products where id = p_product_id;

  -- Garde-fous 1+2 (identité + propriété), même réponse "introuvable" dans les deux cas — même
  -- raisonnement que submit_product_proposal (jamais révéler l'existence du produit d'un tiers).
  if v_establishment_id is null or not exists (
    select 1 from public.establishments
     where id = v_establishment_id and partner_id = v_partner_id
  ) then
    return jsonb_build_object('ok', false, 'reason', 'product_not_found');
  end if;

  -- Garde-fou 3 (capacité) : operator actif pour CET établissement précis.
  if not (select public.has_capability(v_account_id, 'operator', v_establishment_id)) then
    return jsonb_build_object('ok', false, 'reason', 'capability_suspended');
  end if;

  select id, payload into v_existing
    from public.product_proposals
   where product_id = p_product_id and kind = 'photos' and status = 'pending'
   for update;
  -- FOUND est écrasé par le prochain SELECT INTO (count(*) renvoie toujours exactement une
  -- ligne, donc FOUND vaudrait toujours true après lui) — capturé ici, juste après la seule
  -- requête dont le résultat nous intéresse réellement.
  v_has_existing := found;

  select count(*) into v_gallery_count
    from public.product_media where product_id = p_product_id;
  v_existing_count := coalesce(jsonb_array_length(v_existing.payload -> 'photos'), 0);

  -- Plafond 6 uniforme : galerie déjà publiée + proposition en attente + nouvel ajout.
  if v_gallery_count + v_existing_count + array_length(p_storage_paths, 1) > 6 then
    return jsonb_build_object('ok', false, 'reason', 'gallery_cap_exceeded');
  end if;

  v_new_photos := (
    select jsonb_agg(jsonb_build_object('storage_path', sp)) from unnest(p_storage_paths) as sp
  );

  if v_has_existing then
    update public.product_proposals
       set payload = jsonb_set(
             v_existing.payload, '{photos}',
             coalesce(v_existing.payload -> 'photos', '[]'::jsonb) || v_new_photos
           ),
           updated_at = now()
     where id = v_existing.id
    returning id into v_proposal_id;
  else
    -- Plafond de propositions en attente (même valeur que submit_product_proposal, §3e) — vérifié
    -- seulement à la création d'une NOUVELLE ligne pending, jamais quand on agrège dans
    -- l'existante.
    if (
      select count(*) from public.product_proposals
       where partner_id = v_partner_id and status = 'pending'
    ) >= 10 then
      return jsonb_build_object('ok', false, 'reason', 'pending_cap_exceeded');
    end if;

    insert into public.product_proposals (product_id, partner_id, submitted_by, kind, payload)
    values (p_product_id, v_partner_id, v_account_id, 'photos',
      jsonb_build_object('photos', v_new_photos))
    returning id into v_proposal_id;
  end if;

  return jsonb_build_object('ok', true, 'proposal_id', v_proposal_id);
end;
$$;

grant execute on function submit_photos_proposal(uuid, text[]) to authenticated;

-- withdraw_product_proposal (20260813234500) fonctionne déjà tel quel sur une proposition
-- kind='photos' — générique sur status/ownership, rien à étendre.

-- ============================================================================================
-- 6. Extension de moderate_product_proposal — branche kind='photos'
-- ============================================================================================

-- Signature INCHANGÉE (pas de drop function nécessaire) : le branchement kind se fait entièrement
-- à l'intérieur du corps. Comportement kind='content' repris à l'identique (aucune régression),
-- nouvelle branche kind='photos' qui n'écrit QUE product_media — jamais les colonnes de contenu
-- (cahier des charges socio §3f / admin §3b : "l'approbation n'ajoute que les images").
create or replace function moderate_product_proposal(
  p_proposal_id uuid,
  p_decision text,
  p_expected_version int,
  p_corrected_payload jsonb default null,
  p_rejection_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_proposal record;
  v_final_payload jsonb;
  v_reviewer_email text;
  v_photo jsonb;
  v_next_sort int;
begin
  if not (select public.is_admin(auth.uid())) then
    raise exception 'moderate_product_proposal réservé au rôle admin' using errcode = '42501';
  end if;
  if p_decision not in ('approve', 'reject') then
    raise exception 'décision invalide : %', p_decision;
  end if;
  if p_decision = 'reject' and (p_rejection_reason is null or btrim(p_rejection_reason) = '') then
    raise exception 'motif obligatoire pour un rejet';
  end if;

  select id, product_id, payload, status, version, reviewed_by, kind
    into v_proposal
    from public.product_proposals where id = p_proposal_id for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'proposal_not_found');
  end if;
  if v_proposal.status <> 'pending' then
    select email into v_reviewer_email from auth.users where id = v_proposal.reviewed_by;
    return jsonb_build_object('ok', false, 'reason', 'already_handled',
      'status', v_proposal.status, 'reviewed_by_email', v_reviewer_email);
  end if;
  if v_proposal.version <> p_expected_version then
    return jsonb_build_object('ok', false, 'reason', 'version_conflict');
  end if;

  if p_decision = 'approve' and v_proposal.kind = 'photos' then
    v_final_payload := coalesce(p_corrected_payload, v_proposal.payload);

    select coalesce(max(sort), -1) + 1 into v_next_sort
      from public.product_media where product_id = v_proposal.product_id;

    for v_photo in select * from jsonb_array_elements(v_final_payload -> 'photos')
    loop
      insert into public.product_media (product_id, storage_path, sort)
      values (v_proposal.product_id, v_photo ->> 'storage_path', v_next_sort);
      v_next_sort := v_next_sort + 1;
    end loop;

    update public.product_proposals
       set status = 'approved', payload = v_final_payload, reviewed_by = auth.uid(),
           reviewed_at = now(), version = version + 1, updated_at = now()
     where id = p_proposal_id;

    perform public.log_admin_action('product_proposal.approve_photos', 'product_media',
      v_proposal.product_id, null, v_final_payload, null);

  elsif p_decision = 'approve' then
    v_final_payload := jsonb_build_object(
      'name', coalesce(p_corrected_payload -> 'name', v_proposal.payload -> 'name'),
      'description', coalesce(p_corrected_payload -> 'description', v_proposal.payload -> 'description'),
      'price_cop', coalesce(p_corrected_payload -> 'price_cop', v_proposal.payload -> 'price_cop'),
      'category', coalesce(p_corrected_payload -> 'category', v_proposal.payload -> 'category')
    );

    update public.products
       set name = v_final_payload -> 'name',
           description = v_final_payload -> 'description',
           price_cop = (v_final_payload ->> 'price_cop')::bigint,
           category = v_final_payload ->> 'category',
           updated_at = now()
     where id = v_proposal.product_id;

    update public.product_proposals
       set status = 'approved', payload = v_final_payload, reviewed_by = auth.uid(),
           reviewed_at = now(), version = version + 1, updated_at = now()
     where id = p_proposal_id;

    perform public.log_admin_action('product_proposal.approve', 'products', v_proposal.product_id,
      null, v_final_payload, null);
  else
    update public.product_proposals
       set status = 'rejected', rejection_reason = p_rejection_reason, reviewed_by = auth.uid(),
           reviewed_at = now(), version = version + 1, updated_at = now()
     where id = p_proposal_id;

    perform public.log_admin_action('product_proposal.reject', 'product_proposals', p_proposal_id,
      null, null, p_rejection_reason);
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

-- ============================================================================================
-- 7. RPC reorder_gallery — admin (produit ou établissement) ou socio (son propre produit)
-- ============================================================================================

-- Seule RPC de ce lot justifiée par l'ATOMICITÉ, pas par l'audit ni un compteur de capacité :
-- "liste réécrite en une seule opération" (cahier admin §3c) — un enchaînement de UPDATE
-- PostgREST déclenché par le navigateur (un par ligne déplacée) ne garantit pas cette atomicité
-- en cas de coupure réseau à mi-parcours.
create or replace function reorder_gallery(
  p_entity_type text,          -- 'product' | 'establishment'
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
  if p_entity_type not in ('product', 'establishment') then
    raise exception 'p_entity_type invalide : %', p_entity_type;
  end if;

  v_is_admin := (select public.is_admin(v_account_id));

  if not v_is_admin then
    -- Le socio ne réordonne jamais un établissement (§3f : les gestes socio couvrent les
    -- produits, jamais l'établissement lui-même — établissement = admin seul).
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
  else
    select count(*) into v_expected_count
      from public.establishment_media where establishment_id = p_entity_id;
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
  else
    update public.establishment_media m
       set sort = o.ord - 1
      from unnest(p_ordered_media_ids) with ordinality as o(id, ord)
     where m.id = o.id and m.establishment_id = p_entity_id;
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function reorder_gallery(text, uuid, uuid[]) to authenticated;

-- ============================================================================================
-- 8. create_establishment — retrait de p_photo_urls (Storage remplace le tableau plat)
-- ============================================================================================

-- Changement d'arité : drop explicite avant de recréer (Postgres n'écrase pas silencieusement
-- une signature différente — même précaution que 20260814234500).
drop function if exists create_establishment(
  uuid, jsonb, jsonb, text, double precision, double precision, boolean, text[]
);

create or replace function create_establishment(
  p_partner_id uuid,
  p_name jsonb,
  p_description jsonb default null,
  p_address text default null,
  p_lat double precision default null,
  p_lon double precision default null,
  p_operated_directly boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_establishment_id uuid;
begin
  if not (select public.is_admin(auth.uid())) then
    raise exception 'create_establishment réservé au rôle admin' using errcode = '42501';
  end if;

  insert into public.establishments (
    partner_id, name, description, address, lat, lon, operated_directly
  )
  values (
    p_partner_id, p_name, p_description, p_address, p_lat, p_lon, p_operated_directly
  )
  returning id into v_establishment_id;

  update public.partner_capabilities
     set establishment_id = v_establishment_id
   where partner_id = p_partner_id
     and role = 'operator'
     and establishment_id is null;

  if not found then
    insert into public.partner_capabilities (partner_id, establishment_id, role, source, status)
    values (p_partner_id, v_establishment_id, 'operator', 'admin', 'onboarding');
  end if;

  perform public.log_admin_action(
    'establishment.create', 'establishments', v_establishment_id, null,
    jsonb_build_object('partner_id', p_partner_id, 'name', p_name), null
  );

  return v_establishment_id;
end;
$$;

grant execute on function create_establishment(
  uuid, jsonb, jsonb, text, double precision, double precision, boolean
) to authenticated;
