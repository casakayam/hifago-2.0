-- Spec 27 (Lot A) + spec 28 — `search_catalog` : la SEULE lecture du catalogue public.
--
-- Elle sert trois écrans avec une seule requête (spec 28 §0) :
--   buscarSecciones({})            → l'accueil, 8 offres par section
--   buscarSecciones(criterios)     → les résultats de recherche, mêmes sections filtrées
--   buscarTipo(tipo, …)            → une page de listing, paginée
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- SÉCURITÉ — pourquoi `security invoker` et PAS `security definer`
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- Cette fonction ne lit que des données DÉJÀ publiques : `products_select_public` exige
-- `sellable`, `establishments_select_public` exige `status = 'active'`, et les tables de médias,
-- de tags et de calendrier ont leurs propres policies de lecture publique. En `invoker`, ces
-- policies s'appliquent d'elles-mêmes à l'appelant — anon comme authenticated.
--
-- Poser `security definer` ici contournerait RLS SANS AUCUN BESOIN, et c'est exactement ce que
-- CLAUDE.md §3.5 interdit de présenter comme un filet de sécurité. `search_path = ''` est posé
-- quand même (hygiène : tout est qualifié `public.` / `extensions.`, aucune résolution implicite).
--
-- Aucune écriture, aucune table capacitaire touchée : rien ici ne relève de la frontière RPC-only.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- LES DEUX FILTRES, ET POURQUOI ILS NE LISENT AUCUN COMPTEUR
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- Décidé le 2026-09-07 (cahier client §2a), et c'est ce qui garde cette fonction en SQL pur :
--
--   • `p_personas` = CAPACITÉ DÉCLARÉE, jamais les places restantes. Conséquence voulue : la
--     recherche n'interroge aucune disponibilité, donc elle n'appelle JAMAIS LobbyPMS et
--     fonctionne sans dates. ⚠️ La colonne n'a pas le même sens selon le type : `capacity` sur un
--     logement dit combien de personnes y dorment ; sur une activité elle dit le cupo d'une DATE,
--     pas la taille d'un groupe — c'est `max_qty` qui borne une réservation. D'où deux prédicats.
--
--   • `p_desde`/`p_hasta` = « l'offre est PROPOSÉE à ces dates », pas « il reste de la place ».
--     On ne lit donc que `product_calendar` (ouvert/fermé), jamais `product_availability`.
--     Même logique que `p_personas` : une seule barre de recherche, une seule sémantique.
--
-- ⚠️ `product_calendar` est CREUX : l'absence de ligne ne veut pas dire « fermé », elle veut dire
-- « le défaut du produit » (`products.calendar_default_open`, `true` par défaut). D'où les deux
-- branches ci-dessous — compter les fermetures explicites quand le défaut est ouvert, chercher
-- une ouverture explicite quand il est fermé.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- LE REGROUPEMENT SE FAIT ICI, PAS EN TYPESCRIPT — et ce n'est pas un détail
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- Le catalogue actuel groupe les couchages d'un même établissement APRÈS la requête
-- (`apps/web/app/[locale]/page.tsx`). Ça ne marche plus avec un plafond par section : plafonner à
-- huit PRODUITS puis grouper donne moins de huit CARTES. Le plafond porte sur ce que le client
-- voit, donc le regroupement doit le précéder — d'où `es_establecimiento` et le comptage en CTE.
--
-- Le seuil (deux couchages vendables) se calcule sur TOUT le catalogue, jamais sur les résultats
-- filtrés : sinon une même recherche ferait apparaître Casa Kayam tantôt comme un établissement,
-- tantôt comme une chambre isolée, selon les critères. La forme d'une carte ne doit pas dépendre
-- de la requête.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- PAS D'INDEX TRIGRAMME, ET C'EST DÉLIBÉRÉ
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- La spec 27 prévoyait `pg_trgm` + un index sur le texte cherchable. Non fait, pour une raison
-- technique vérifiée : `unaccent()` est déclarée STABLE, pas IMMUTABLE — Postgres refuse donc de
-- l'utiliser dans une expression indexée sans passer par une fonction enveloppe marquée IMMUTABLE
-- à la main, ce qui est un mensonge au planificateur (le dictionnaire unaccent est modifiable).
-- À l'échelle du catalogue (dizaines d'offres), le parcours séquentiel est gratuit. L'index
-- viendra avec sa mesure, pas avant — et il exigera alors une vraie colonne générée plutôt qu'un
-- index d'expression.

create or replace function public.search_catalog(
  p_query    text   default null,
  p_tipos    text[] default null,   -- null = tous les types
  p_tag_slug text   default null,
  p_personas int    default null,
  p_desde    date   default null,
  p_hasta    date   default null,
  p_por_tipo int    default null,   -- plafond par section ; null = pas de plafond
  p_limite   int    default 24,
  p_offset   int    default 0
)
returns table (
  tipo               text,
  es_establecimiento boolean,
  id                 uuid,
  slug               text,
  nombre             jsonb,
  descripcion        jsonb,
  precio_cop         bigint,
  precio_desde       bigint,
  precio_label       text,
  establecimiento    jsonb,
  fotos              jsonb,
  total_seccion      bigint,
  rango_seccion      bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
with
-- Nombre de couchages vendables par établissement, sur TOUT le catalogue (jamais les filtrés).
conteo_alojamientos as (
  select p.establishment_id, count(*) as n
  from public.products p
  where p.type = 'lodging' and p.sellable and p.establishment_id is not null
  group by p.establishment_id
),

-- Les offres candidates, après tous les filtres.
candidatos as (
  select
    p.id,
    p.type,
    p.slug,
    p.name,
    p.description,
    p.price_cop,
    p.price_label,
    p.created_at,
    p.establishment_id,
    e.slug   as est_slug,
    e.name   as est_name,
    coalesce(ca.n, 0) as n_alojamientos
  from public.products p
  join public.establishments e on e.id = p.establishment_id
  left join conteo_alojamientos ca on ca.establishment_id = p.establishment_id
  where p.sellable
    and e.status = 'active'

    -- type
    and (p_tipos is null or p.type = any (p_tipos))

    -- tag
    and (
      p_tag_slug is null
      or exists (
        select 1
        from public.product_tag_assignments pta
        join public.catalog_tags ct on ct.id = pta.tag_id
        where pta.product_id = p.id and ct.slug = p_tag_slug
      )
    )

    -- nombre de personnes : la colonne juste de chaque type (cf. en-tête)
    and (
      p_personas is null
      or (
        -- ⚠️ Une borne ABSENTE ne filtre pas, dans les deux branches. Exclure sur une donnée
        -- manquante cacherait une offre réelle à cause d'un trou de saisie — et la chambre PMS de
        -- Casa Kayam, qui n'a pas de `capacity`, doit apparaître (décision du 2026-09-07 sur les
        -- hébergements adossés à un PMS). Le client voit la capacité réelle sur la fiche.
        case
          when p.type = 'lodging' then p.capacity is null or p.capacity >= p_personas
          else p.max_qty is null or p.max_qty >= p_personas
        end
      )
    )

    -- texte libre : nom de l'offre, nom de son établissement, libellés de ses tags.
    -- JAMAIS le libellé du type, qui est une chaîne d'interface et n'existe dans aucune table.
    and (
      p_query is null
      or extensions.unaccent(
           coalesce(p.name ->> 'es', '') || ' ' || coalesce(p.name ->> 'en', '') || ' ' ||
           coalesce(e.name ->> 'es', '') || ' ' || coalesce(e.name ->> 'en', '')
         ) ilike '%' || extensions.unaccent(p_query) || '%'
      or exists (
        select 1
        from public.product_tag_assignments pta
        join public.catalog_tags ct on ct.id = pta.tag_id
        where pta.product_id = p.id
          and extensions.unaccent(
                coalesce(ct.label ->> 'es', '') || ' ' || coalesce(ct.label ->> 'en', '')
              ) ilike '%' || extensions.unaccent(p_query) || '%'
      )
    )

    -- dates : « proposée à au moins une date de la plage », calendrier seul (cf. en-tête)
    and (
      p_desde is null or p_hasta is null
      or p.schedule = 'none'                 -- aucune date requise : toujours visible
      or e.lobby_connector_active            -- dispo chez LobbyPMS : apparaît sans garantie (§2f)
      or (
        case
          when p.calendar_default_open then
            -- ouvert par défaut : ne disparaît que si TOUTES les dates sont fermées explicitement
            (
              select count(*)
              from public.product_calendar pc
              where pc.product_id = p.id
                and pc.date between p_desde and p_hasta
                and pc.open = false
            ) < (p_hasta - p_desde + 1)
          else
            -- fermé par défaut : n'apparaît que sur une ouverture explicite
            exists (
              select 1
              from public.product_calendar pc
              where pc.product_id = p.id
                and pc.date between p_desde and p_hasta
                and pc.open
            )
        end
      )
    )
),

-- Une ligne par CARTE : l'établissement quand il porte deux couchages vendables ou plus,
-- l'offre elle-même sinon. Le regroupement précède le plafonnement (cf. en-tête).
filas as (
  -- ⚠️ La branche `distinct on` DOIT être encapsulée : un `order by` ne peut pas précéder un
  -- `union all` sans parenthèses (Postgres l'interprète comme l'ordre de l'union entière).
  select * from (
    select distinct on (c.establishment_id)
      'lodging'::text    as tipo,
      true               as es_establecimiento,
      c.establishment_id as id,
      c.est_slug         as slug,
      c.est_name         as nombre,
      e.description      as descripcion,
      null::bigint       as precio_cop,
      (
        select min(pl.price_cop)::bigint
        from public.products pl
        where pl.establishment_id = c.establishment_id
          and pl.type = 'lodging'
          and pl.sellable
          and pl.price_cop is not null   -- ⚠️ sans ce filtre, une vitrine sans prix fausse le « desde »
      )                  as precio_desde,
      null::text         as precio_label,
      null::jsonb        as establecimiento,
      -- Photos d'une carte d'établissement : les SIENNES d'abord, celles de son premier couchage
      -- en repli. Le catalogue actuel prend celles du premier couchage parce qu'il listait des
      -- produits et n'avait pas d'autre choix ; une carte qui représente un LIEU doit montrer le
      -- lieu quand il a ses propres photos (`establishment_media`, spec 04). Le repli garde le
      -- comportement actuel quand il n'en a aucune, donc rien ne régresse.
      coalesce(
        (
          select jsonb_agg(jsonb_build_object('storage_path', m.storage_path) order by m.sort)
          from public.establishment_media m
          where m.establishment_id = c.establishment_id
        ),
        (
          select jsonb_agg(jsonb_build_object('storage_path', m.storage_path) order by m.sort)
          from public.product_media m
          where m.product_id = c.id
        )
      )                  as fotos,
      c.created_at       as created_at
    from candidatos c
    join public.establishments e on e.id = c.establishment_id
    where c.type = 'lodging' and c.n_alojamientos >= 2
    order by c.establishment_id, c.created_at
  ) agrupados

  union all

  select
    c.type             as tipo,
    false              as es_establecimiento,
    c.id               as id,
    c.slug             as slug,
    c.name             as nombre,
    c.description      as descripcion,
    c.price_cop::bigint as precio_cop,
    null::bigint       as precio_desde,
    c.price_label      as precio_label,
    case when c.est_slug is null then null
         else jsonb_build_object('slug', c.est_slug, 'nombre', c.est_name) end as establecimiento,
    (
      select jsonb_agg(jsonb_build_object('storage_path', m.storage_path) order by m.sort)
      from public.product_media m
      where m.product_id = c.id
    )                  as fotos,
    c.created_at       as created_at
  from candidatos c
  where not (c.type = 'lodging' and c.n_alojamientos >= 2)
),

-- Total par section AVANT plafonnement (il alimente le libellé « Ver más »), et rang.
-- Ordre décidé le 2026-09-07 : les plus récentes d'abord. `products.sort` existe mais est
-- dormante — jamais renseignée, jamais lue ; le jour où elle sert, c'est ici qu'on la met.
clasificadas as (
  select
    f.*,
    count(*)     over (partition by f.tipo)                                as total_seccion,
    row_number() over (partition by f.tipo order by f.created_at desc, f.id) as rango_seccion
  from filas f
)
select
  c.tipo, c.es_establecimiento, c.id, c.slug, c.nombre, c.descripcion,
  c.precio_cop, c.precio_desde, c.precio_label, c.establecimiento, c.fotos,
  c.total_seccion, c.rango_seccion
from clasificadas c
where p_por_tipo is null or c.rango_seccion <= p_por_tipo
order by c.tipo, c.rango_seccion
limit p_limite offset p_offset;
$$;

comment on function public.search_catalog is
  'Lecture publique du catalogue (spec 27 Lot A / spec 28). security invoker : les policies '
  '_select_public s''appliquent d''elles-mêmes. Ne lit AUCUN compteur de disponibilité — '
  'p_personas compare des capacités déclarées, p_desde/p_hasta ne lisent que product_calendar.';

-- Un anonyme doit pouvoir chercher : c'est tout l'objet de la vitrine.
grant execute on function public.search_catalog(
  text, text[], text, int, date, date, int, int, int
) to anon, authenticated;
