-- T1 du modèle hébergement (spec 24 §4) — de quoi publier une page établissement.
--
-- POURQUOI T1 EST UN PRÉREQUIS ET NON UN CONFORT. La cible retenue le 2026-08-26 est de supprimer
-- l'étage `products.type='hotel'` : l'hôtel devient l'établissement, et chaque chambre un produit.
-- Or la fiche produit « hôtel » est aujourd'hui **le seul écran qui présente le lieu et regroupe ses
-- chambres**. La retirer sans page établissement laisserait un catalogue de chambres orphelines,
-- sans aucun endroit qui dise de quel hôtel elles viennent. On construit donc le remplaçant avant
-- de retirer l'existant, jamais l'inverse.
--
-- QUATRE COLONNES, et ce qu'elles servent :
--
--   slug            l'URL publique. Dérivée du nom, JAMAIS saisie à la main.
--   check_in_time   horaires d'arrivée/départ — aujourd'hui portés par chaque produit `lodging`,
--   check_out_time  alors qu'ils sont une propriété du LIEU. Les répéter chambre par chambre était
--                   déjà une duplication ; la page établissement est l'endroit naturel.
--   mode            'rooms' | 'whole_house' — « cet établissement a-t-il des chambres à choisir, ou
--                   se loue-t-il entier ? »
--
-- `mode` VIENT DE LA V1, ET IL EST RÉEL. `src/config/properties.js` du dépôt legacy porte
-- `mode: 'whole_house'` sur **Bania Travel** pendant que Casa Kayam est en `mode: 'rooms'` — un
-- partenaire en production se loue déjà entier. À NE PAS CONFONDRE avec `products.lodging_kind`
-- (migration 20260827120000), qui décrit une chambre : `lodging_kind` dit ce qu'EST une unité,
-- `mode` dit comment l'établissement se VEND. Une maison entière est les deux à la fois, ce qui
-- rend la confusion facile — d'où ce paragraphe.
--
-- NULLABLE, délibérément : un établissement qui ne vend que des activités n'a pas de mode
-- d'hébergement, et lui en imposer un ('rooms' par défaut) fabriquerait une information fausse.
-- `null` veut dire « pas un hébergement, ou pas encore renseigné ».

alter table public.establishments
  add column slug text,
  add column check_in_time time,
  add column check_out_time time,
  add column mode text check (mode is null or mode in ('rooms', 'whole_house'));

comment on column public.establishments.mode is
  'Comment l''établissement se vend : rooms (des chambres à choisir) ou whole_house (loué entier). Repris de la v1 (src/config/properties.js). null = pas un hébergement, ou pas renseigné. À ne pas confondre avec products.lodging_kind, qui décrit une unité et non l''établissement.';

comment on column public.establishments.slug is
  'Identifiant d''URL publique, dérivé du nom par trigger. JAMAIS saisi ni modifié à la main : le changer casserait toute URL déjà partagée ou indexée.';

-- ============================================================================================
-- Slug — dérivé, unique, jamais saisi
-- ============================================================================================

-- Même boucle de dé-duplication que create_product_from_proposal (20260815110000) : on ne réinvente
-- pas la règle, on la copie, pour que deux établissements homonymes se comportent comme deux
-- produits homonymes.
create or replace function public.establishment_slug_from_name(p_name jsonb, p_exclude uuid default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_base text;
  v_slug text;
  v_suffix int := 1;
begin
  v_base := public.slugify(coalesce(p_name ->> 'es', 'establecimiento'));
  if v_base = '' then
    v_base := 'establecimiento';
  end if;
  v_slug := v_base;
  while exists (
    select 1 from public.establishments
     where slug = v_slug and (p_exclude is null or id <> p_exclude)
  ) loop
    v_suffix := v_suffix + 1;
    v_slug := v_base || '-' || v_suffix;
  end loop;
  return v_slug;
end;
$$;

-- Rétro-remplissage des établissements existants, du plus ancien au plus récent : l'ordre décide
-- qui garde le slug nu et qui reçoit le suffixe, et le plus ancien est le plus susceptible d'avoir
-- déjà été partagé ailleurs.
do $$
declare
  v_row record;
begin
  for v_row in select id, name from public.establishments where slug is null order by created_at asc loop
    update public.establishments
       set slug = public.establishment_slug_from_name(v_row.name, v_row.id)
     where id = v_row.id;
  end loop;
end;
$$;

alter table public.establishments alter column slug set not null;
create unique index establishments_slug_key on public.establishments (slug);

-- Le slug se pose à la CRÉATION et ne bouge plus. Renommer un établissement ne change donc pas son
-- URL — c'est voulu : une URL publique déjà partagée ou indexée ne doit pas se dérober parce que
-- quelqu'un a corrigé une faute de frappe dans le nom.
create or replace function public.set_establishment_slug()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.slug is null then
    new.slug := public.establishment_slug_from_name(new.name, new.id);
  end if;
  return new;
end;
$$;

create trigger establishments_set_slug
before insert on public.establishments
for each row
execute function public.set_establishment_slug();

-- ============================================================================================
-- Lecture publique
-- ============================================================================================

-- ⚠️ INDISPENSABLE, et facile à oublier : `establishments` n'a PAS de grant SELECT global. La
-- migration 20260819110000 a révoqué le grant de table pour protéger `lobby_api_token`, puis
-- ré-accordé COLONNE PAR COLONNE. Une colonne neuve n'est donc lisible par personne — et un
-- `permission denied` survient AVANT que la RLS ne s'applique (hifago/CLAUDE.md §11.1), ce qui se
-- confond aisément avec un bug de policy. Sans ces quatre lignes, la page publique ne renverrait
-- rien et le diagnostic partirait dans la mauvaise direction.
grant select (slug, check_in_time, check_out_time, mode) on public.establishments to anon, authenticated;
