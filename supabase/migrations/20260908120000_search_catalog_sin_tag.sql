-- Spec 29 (Tranche 1) — `search_catalog` republiée : un slug de tag inconnu devient ignoré, et
-- `p_sin_tag` ouvre la page des activités que personne n'a classées.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- POURQUOI `drop` PUIS `create`, ET PAS `create or replace`
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- La signature change (`p_sin_tag`). `create or replace` ne remplace jamais une signature
-- différente : il créerait une SURCHARGE, et deux fonctions homonymes cohabiteraient — PostgREST
-- choisirait alors l'une ou l'autre selon les paramètres reçus, sans erreur et sans trace.
-- `.claude/rules/supabase.md` §7 l'interdit explicitement.
--
-- ⚠️ Le `drop` emporte les GRANTS avec lui. Ils sont reposés en fin de fichier : sans eux, la
-- vitrine entière serait muette pour `anon` — et rien ne le signalerait au build ni aux tests
-- unitaires, seulement un catalogue vide en navigateur.
--
-- ⚠️ `p_sin_tag` est inséré à sa place LOGIQUE (juste après `p_tag_slug`), pas en queue de
-- signature : vérifié le 2026-09-08, aucun appelant ne passe ses paramètres par position —
-- `buscar.ts` et `sugerencias.ts` passent un objet, et les 16 assertions de
-- `supabase/tests/database/search_catalog.test.sql` nomment toutes les leurs.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- CE QUI NE CHANGE PAS, ET C'EST L'ESSENTIEL
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- Le corps est repris à l'IDENTIQUE de `20260907200000_search_catalog.sql` (comparé caractère par
-- caractère à la définition vivante en base avant réécriture, cf. règle §7), à l'exception du seul
-- bloc « tag » ci-dessous. Le regroupement des couchages, les prédicats personnes/dates/texte, le
-- plafond par section, le comptage et l'ordre sont intacts — et les 16 assertions pgTAP existantes
-- doivent rester vertes SANS ÊTRE MODIFIÉES. C'est la preuve que cette migration ne change que ce
-- qu'elle annonce : si l'une d'elles devait être ajustée, c'est qu'un prédicat aurait bougé.
--
-- La fonction reste `stable security invoker` : elle ne lit que du public, les policies
-- `_select_public` s'appliquent d'elles-mêmes, et `security definer` contournerait RLS sans aucun
-- besoin (hifago/CLAUDE.md §3.5). L'en-tête de la migration d'origine reste la référence pour tout
-- le reste (le calendrier creux, les deux sens de `capacity`, l'absence d'index trigramme).
--
-- ⚠️ `search_catalog_tags` (l'index de catégories, spec 29 Tranche 2) N'EST PAS ici : elle
-- appellera CETTE fonction plutôt que de recopier ses filtres (spec 29 §6b, arbitré le 2026-09-08).

drop function if exists public.search_catalog(
  text, text[], text, int, date, date, int, int, int
);

create function public.search_catalog(
  p_query    text    default null,
  p_tipos    text[]  default null,   -- null = tous les types
  p_tag_slug text    default null,
  p_sin_tag  boolean default false,  -- true = seulement les offres SANS aucun tag
  p_personas int     default null,
  p_desde    date    default null,
  p_hasta    date    default null,
  p_por_tipo int     default null,   -- plafond par section ; null = pas de plafond
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

    -- tag — ⚠️ TROIS branches, et la deuxième est le correctif du 2026-09-08.
    -- Un slug ABSENT de catalog_tags est IGNORÉ, comme tout paramètre invalide de ce dépôt
    -- (spec 28 §0 « tipo/tag inconnu → ignoré »). Sans elle, il ne restait qu'une échappatoire
    -- (`is null`) : un slug inconnu filtrait TOUT, et comme le bloc de recherche le reporte à
    -- chaque soumission, la page ne se déverrouillait plus jamais. Mesuré en réel le 2026-09-08
    -- (7 lignes sans tag, 0 avec `zzz-inexistant`) — spec 28 §10quinquies.
    and (
      p_tag_slug is null
      or not exists (select 1 from public.catalog_tags ct where ct.slug = p_tag_slug)
      or exists (
        select 1
        from public.product_tag_assignments pta
        join public.catalog_tags ct on ct.id = pta.tag_id
        where pta.product_id = p.id and ct.slug = p_tag_slug
      )
    )

    -- sans tag — la page « Otras actividades » (spec 29 §0), qui rattrape ce qu'aucune catégorie
    -- ne classe. Ce n'est PAS `p_tag_slug` inversé : on ne cherche pas l'absence d'UN tag, mais
    -- l'absence de TOUS. Une offre publiée doit rester atteignable par la navigation même si
    -- personne ne l'a rangée.
    and (
      not p_sin_tag
      or not exists (
        select 1 from public.product_tag_assignments pta where pta.product_id = p.id
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
  'Lecture publique du catalogue (spec 27 Lot A / spec 28 / spec 29). security invoker : les '
  'policies _select_public s''appliquent d''elles-mêmes. Ne lit AUCUN compteur de disponibilité — '
  'p_personas compare des capacités déclarées, p_desde/p_hasta ne lisent que product_calendar. '
  'p_tag_slug inconnu = ignoré ; p_sin_tag = les offres qu''aucune catégorie ne classe.';

-- ⚠️ Reposés après le `drop`, qui les a emportés. Un anonyme doit pouvoir chercher : c'est tout
-- l'objet de la vitrine.
grant execute on function public.search_catalog(
  text, text[], text, boolean, int, date, date, int, int, int
) to anon, authenticated;
