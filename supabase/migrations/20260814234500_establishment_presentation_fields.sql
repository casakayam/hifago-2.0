-- Feature 28 (Admin : création enrichie d'un établissement) — docs/specs/03-admin-creation-
-- etablissement.md. Additive sur establishments (déjà RLS-directe admin, cf.
-- 20260813210000_establishments_core_table.sql) : aucun des critères RPC-only (CLAUDE.md §3) ne
-- s'applique à de simples colonnes de présentation. Table encore vide à ce stade des migrations
-- (le seed s'exécute après) → aucun backfill nécessaire, même raisonnement que
-- 20260813203000_products_slug.sql.
alter table establishments
  add column description jsonb,
  add column address text,
  add column lat double precision,
  add column lon double precision,
  add column operated_directly boolean not null default false,
  add column photo_urls text[] not null default '{}';

-- Bucket Storage establishment-photos — premier usage de Supabase Storage dans tout le projet
-- hifago/ (aucun précédent à copier ailleurs dans les migrations). Version "basique et
-- provisoire" assumée (spec §2/§10) : upload simple, pas de update/delete — la future spec
-- dédiée "gestion d'image" (réordonnancement, couverture, service partagé admin/socio, cf.
-- cahier admin §3c) remplacera ce mécanisme, pas à anticiper ici. Public en lecture (les photos
-- doivent s'afficher côté vitrine plus tard) ; écriture réservée à l'admin.
insert into storage.buckets (id, name, public)
values ('establishment-photos', 'establishment-photos', true)
on conflict (id) do nothing;

create policy establishment_photos_read on storage.objects
  for select using (bucket_id = 'establishment-photos');

create policy establishment_photos_write_admin on storage.objects
  for insert
  with check (bucket_id = 'establishment-photos' and (select is_admin(auth.uid())));

-- create_establishment change d'arité (Postgres identifie une fonction par nom + types de
-- paramètres — un simple create or replace avec une nouvelle liste ne remplace PAS l'ancienne,
-- laisserait les deux coexister silencieusement) : drop explicite de l'ancienne signature avant
-- la nouvelle définition.
drop function if exists create_establishment(uuid, jsonb);

-- Dette assumée réglée au passage (cf. commentaire de 20260813201000_admin_audit_log.sql :
-- "les écritures admin des features 1-3 restent non auditées rétroactivement (dette assumée,
-- cf. plan)") : create_establishment (Feature 1) n'appelait jamais log_admin_action, contrairement
-- à toute RPC admin créée depuis. Puisque la fonction est réécrite ici de toute façon pour les
-- nouveaux champs, c'est le bon moment pour la corriger.
create or replace function create_establishment(
  p_partner_id uuid,
  p_name jsonb,
  p_description jsonb default null,
  p_address text default null,
  p_lat double precision default null,
  p_lon double precision default null,
  p_operated_directly boolean default false,
  p_photo_urls text[] default '{}'
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
    partner_id, name, description, address, lat, lon, operated_directly, photo_urls
  )
  values (
    p_partner_id, p_name, p_description, p_address, p_lat, p_lon, p_operated_directly,
    coalesce(p_photo_urls, '{}')
  )
  returning id into v_establishment_id;

  -- Une capacité operator "en attente" (establishment_id null, cf. correctif Tranche 1) est
  -- rattachée au nouvel établissement plutôt que dupliquée. S'il n'y en a pas, une nouvelle ligne
  -- operator est créée — statut onboarding, à activer séparément.
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

-- Le privilège par défaut sur une fonction créée par le rôle postgres n'inclut pas EXECUTE pour
-- anon/authenticated (cf. hifago/CLAUDE.md §11) — accordé explicitement à authenticated (le
-- contrôle d'accès réel est le is_admin() interne ci-dessus, pas ce grant).
grant execute on function create_establishment(
  uuid, jsonb, jsonb, text, double precision, double precision, boolean, text[]
) to authenticated;
