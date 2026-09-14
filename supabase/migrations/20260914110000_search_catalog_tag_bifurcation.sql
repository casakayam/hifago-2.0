-- `search_catalog` doit résoudre un tag (p_tag_slug/p_sin_tag) à la MÊME source que le nouvel
-- index de catégories (`search_catalog_categorias`, migration suivante) — sinon `/[type]/
-- [categoria]` (qui appelle `search_catalog` via `buscarTipo`) afficherait une catégorie vide
-- pour un établissement groupé que l'index, lui, montre bien : les deux écrans se
-- contrediraient silencieusement, exactement le genre de bug qu'aucun test des deux fonctions
-- prises séparément n'attrape.
--
-- `create or replace` : signature STRICTEMENT inchangée depuis
-- `20260908201000_search_catalog_n_alojamientos.sql` (règle §7 de `.claude/rules/supabase.md` —
-- jamais de `drop` quand la signature ne change pas). Corps repris de la définition vivante en
-- base (`pg_get_functiondef`) caractère pour caractère, seuls les deux prédicats de tag changent.
--
-- La bifurcation : une carte GROUPÉE (`p.type = 'lodging' and coalesce(ca.n, 0) >= 2`, la même
-- condition qu'utilise `filas` plus bas pour décider si une ligne devient une carte
-- établissement) tire son tag de `establishment_tag_assignments` ; toute autre ligne (tout autre
-- type, ou un établissement à un seul couchage qui s'affiche lui-même comme carte produit) tire
-- le sien de `product_tag_assignments`, exactement comme avant. `ca.n` est déjà calculé et joint
-- dans cette CTE (`conteo_alojamientos`) — coût nul.
create or replace function public.search_catalog(
  p_query    text    default null,
  p_tipos    text[]  default null,
  p_tag_slug text    default null,
  p_sin_tag  boolean default false,
  p_personas int     default null,
  p_desde    date    default null,
  p_hasta    date    default null,
  p_por_tipo int     default null,
  p_limite   int     default 24,
  p_offset   int     default 0
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
  rango_seccion      bigint,
  n_alojamientos     bigint
)
language sql
stable
set search_path = ''
as $$
with
conteo_alojamientos as (
  select p.establishment_id, count(*) as n
  from public.products p
  where p.type = 'lodging' and p.sellable and p.establishment_id is not null
  group by p.establishment_id
),

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

    and (p_tipos is null or p.type = any (p_tipos))

    -- tag — bifurqué selon la source (cf. en-tête). Un slug ABSENT de catalog_tags est IGNORÉ,
    -- comme tout paramètre invalide de ce dépôt (spec 28 §0 « tipo/tag inconnu → ignoré »).
    and (
      p_tag_slug is null
      or not exists (select 1 from public.catalog_tags ct where ct.slug = p_tag_slug)
      or (
        case
          when p.type = 'lodging' and coalesce(ca.n, 0) >= 2 then
            exists (
              select 1
              from public.establishment_tag_assignments eta
              join public.catalog_tags ct on ct.id = eta.tag_id
              where eta.establishment_id = p.establishment_id and ct.slug = p_tag_slug
            )
          else
            exists (
              select 1
              from public.product_tag_assignments pta
              join public.catalog_tags ct on ct.id = pta.tag_id
              where pta.product_id = p.id and ct.slug = p_tag_slug
            )
        end
      )
    )

    -- sans tag — même bifurcation : un établissement groupé est « sans catégorie » quand AUCUN
    -- tag ne lui est assigné à LUI (pas à une de ses chambres individuellement).
    and (
      not p_sin_tag
      or (
        case
          when p.type = 'lodging' and coalesce(ca.n, 0) >= 2 then
            not exists (
              select 1 from public.establishment_tag_assignments eta
              where eta.establishment_id = p.establishment_id
            )
          else
            not exists (
              select 1 from public.product_tag_assignments pta where pta.product_id = p.id
            )
        end
      )
    )

    and (
      p_personas is null
      or (
        case
          when p.type = 'lodging' then p.capacity is null or p.capacity >= p_personas
          else p.max_qty is null or p.max_qty >= p_personas
        end
      )
    )

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

    and (
      p_desde is null or p_hasta is null
      or p.schedule = 'none'
      or e.lobby_connector_active
      or (
        case
          when p.calendar_default_open then
            (
              select count(*)
              from public.product_calendar pc
              where pc.product_id = p.id
                and pc.date between p_desde and p_hasta
                and pc.open = false
            ) < (p_hasta - p_desde + 1)
          else
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

filas as (
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
          and pl.price_cop is not null
      )                  as precio_desde,
      null::text         as precio_label,
      null::jsonb        as establecimiento,
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
      c.n_alojamientos::bigint as n_alojamientos,
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
    null::bigint       as n_alojamientos,
    c.created_at       as created_at
  from candidatos c
  where not (c.type = 'lodging' and c.n_alojamientos >= 2)
),

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
  c.total_seccion, c.rango_seccion, c.n_alojamientos
from clasificadas c
where p_por_tipo is null or c.rango_seccion <= p_por_tipo
order by c.tipo, c.rango_seccion
limit p_limite offset p_offset;
$$;

comment on function public.search_catalog is
  'Lecture publique du catalogue (spec 27 Lot A / spec 28). security invoker : les policies '
  '_select_public s''appliquent d''elles-mêmes. Le filtre par tag (p_tag_slug/p_sin_tag) bifurque '
  'entre establishment_tag_assignments (carte groupée) et product_tag_assignments (carte produit) '
  'depuis 2026-09-14 — cf. commentaire de tête de la migration.';
