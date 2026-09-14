-- Remplace `search_catalog_tags` (index de catégories SANS items, réservé à `activity`) par
-- `search_catalog_categorias` : les catégories d'UN type, chacune avec ses items PLAFONNÉS —
-- même esprit que `p_por_tipo` de `search_catalog` (le plafond se fait EN SQL, via une fenêtre,
-- jamais en TypeScript), mais partitionné par tag au lieu du type. Généralise le pattern de
-- section de l'accueil (`SeccionOfertas`) à une section PAR CATÉGORIE, pour tout `TipoOferta`.
--
-- Signature différente de `search_catalog_tags` (ajoute les colonnes carte + `p_por_categoria`
-- remplace l'absence de plafond) : `drop function` explicite, jamais un `create or replace` sur
-- une signature qui change (règle §7 de `.claude/rules/supabase.md`). Plus aucun appelant
-- TypeScript de `search_catalog_tags` après ce lot (`listarTagsConOferta` disparaît) : la garder
-- en parallèle créerait exactement le risque de divergence que son propre commentaire de tête
-- dénonçait déjà pour les prédicats de `search_catalog`.
drop function if exists public.search_catalog_tags(text, text, int, date, date);

-- ⚠️ Même convention documentée que l'ancienne `search_catalog_tags` : appelle `search_catalog`
-- plutôt que de recopier ses filtres (6 prédicats, un seul endroit). `p_limite => 1000000` est
-- obligatoire : cette fonction doit voir TOUT le catalogue candidat du type, pas les 24 par défaut.
--
-- Bifurcation IDENTIQUE à celle de `search_catalog` (migration précédente) pour déterminer la
-- source du tag d'une ligne : une carte GROUPÉE (`es_establecimiento`) tire la sienne de
-- `establishment_tag_assignments`, une carte PRODUIT de `product_tag_assignments`. Une même
-- carte peut porter plusieurs tags (table many-to-many) : elle apparaît alors dans plusieurs
-- catégories, comme le faisait déjà `search_catalog_tags` pour les activités.
--
-- La ligne « sans catégorie » (`es_sin_tag`) généralise « Otras actividades » à tout type : une
-- offre publiée qu'aucun tag ne classe reste atteignable depuis la navigation par catégorie. Pas
-- de `having count(*) > 0` nécessaire ici (contrairement à l'ancienne fonction) : `sin_categoria`
-- n'est plus un agrégat sans `group by`, c'est un filtre normal qui ne produit simplement aucune
-- ligne si personne n'est sans tag.
create function public.search_catalog_categorias(
  p_tipo          text,
  p_query         text default null,
  p_personas      int  default null,
  p_desde         date default null,
  p_hasta         date default null,
  p_por_categoria int  default null
)
returns table (
  categoria_slug        text,
  categoria_label       jsonb,
  categoria_description jsonb,
  categoria_image_path  text,
  es_sin_tag            boolean,
  total_categoria       bigint,
  rango_categoria       bigint,
  tipo                  text,
  es_establecimiento    boolean,
  id                    uuid,
  slug                  text,
  nombre                jsonb,
  descripcion           jsonb,
  precio_cop            bigint,
  precio_desde          bigint,
  precio_label          text,
  establecimiento       jsonb,
  fotos                 jsonb,
  n_alojamientos        bigint
)
language sql
stable
set search_path = ''
as $$
with candidatos as (
  select sc.*
  from public.search_catalog(
    p_query    => p_query,
    p_tipos    => array[p_tipo],
    p_personas => p_personas,
    p_desde    => p_desde,
    p_hasta    => p_hasta,
    p_limite   => 1000000
  ) sc
),

-- Une ligne par (candidat, tag) — un candidat portant N tags contribue à N catégories.
etiquetas as (
  select c.id as candidato_id, ct.slug, ct.label, ct.description, ct.image_path
  from candidatos c
  join public.establishment_tag_assignments eta
    on eta.establishment_id = c.id and c.es_establecimiento
  join public.catalog_tags ct on ct.id = eta.tag_id

  union all

  select c.id as candidato_id, ct.slug, ct.label, ct.description, ct.image_path
  from candidatos c
  join public.product_tag_assignments pta
    on pta.product_id = c.id and not c.es_establecimiento
  join public.catalog_tags ct on ct.id = pta.tag_id
),

con_categoria as (
  select
    e.slug                                                            as categoria_slug,
    e.label                                                           as categoria_label,
    e.description                                                     as categoria_description,
    e.image_path                                                      as categoria_image_path,
    false                                                              as es_sin_tag,
    count(*)     over (partition by e.slug)                           as total_categoria,
    row_number() over (partition by e.slug order by c.rango_seccion)  as rango_categoria,
    c.tipo, c.es_establecimiento, c.id, c.slug as item_slug, c.nombre, c.descripcion,
    c.precio_cop, c.precio_desde, c.precio_label, c.establecimiento, c.fotos, c.n_alojamientos
  from etiquetas e
  join candidatos c on c.id = e.candidato_id
),

-- Le « reste » : un candidat qu'AUCUN tag ne classe (ni établissement, ni produit).
sin_categoria as (
  select
    null::text                              as categoria_slug,
    null::jsonb                             as categoria_label,
    null::jsonb                             as categoria_description,
    null::text                              as categoria_image_path,
    true                                     as es_sin_tag,
    count(*) over ()                        as total_categoria,
    row_number() over (order by c.rango_seccion) as rango_categoria,
    c.tipo, c.es_establecimiento, c.id, c.slug as item_slug, c.nombre, c.descripcion,
    c.precio_cop, c.precio_desde, c.precio_label, c.establecimiento, c.fotos, c.n_alojamientos
  from candidatos c
  where not exists (select 1 from etiquetas e where e.candidato_id = c.id)
)

select
  categoria_slug, categoria_label, categoria_description, categoria_image_path, es_sin_tag,
  total_categoria, rango_categoria, tipo, es_establecimiento, id, item_slug as slug, nombre,
  descripcion, precio_cop, precio_desde, precio_label, establecimiento, fotos, n_alojamientos
from (
  select * from con_categoria
  union all
  select * from sin_categoria
) todo
where p_por_categoria is null or rango_categoria <= p_por_categoria
order by categoria_slug nulls last, rango_categoria;
$$;

comment on function public.search_catalog_categorias is
  'Catégories d''un type d''offre, avec leurs items plafonnés par catégorie (remplace '
  'search_catalog_tags, 2026-09-14). Appelle search_catalog plutôt que de recopier ses filtres. '
  'Bifurque la source du tag entre establishment_tag_assignments (carte groupée) et '
  'product_tag_assignments (carte produit) — même règle que search_catalog. Ne trie pas par '
  'libellé : l''ordre alphabétique dépend de la locale, que la base ne connaît pas.';

-- Un anonyme doit pouvoir naviguer par catégorie : c'est tout l'objet de la vitrine.
grant execute on function public.search_catalog_categorias(text, text, int, date, date, int)
  to anon, authenticated;
