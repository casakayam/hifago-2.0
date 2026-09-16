-- Retour Jérôme (2026-09-15) : les `evento` doivent être triés par prochaine occurrence, du plus
-- proche au plus éloigné — pas juste `created_at desc` comme les quatre autres types aujourd'hui
-- (docs/specs/28-vitrine-accueil-et-resultats.md l'annonçait déjà comme « un point d'extension
-- isolé », jamais comme un choix définitif).
--
-- Aucune fonction "prochaine occurrence" n'existait, ni en SQL ni en TypeScript : `formatOccurrenceLabel`
-- (apps/web/lib/products/formatOccurrenceLabel.ts) ne produit qu'une PHRASE ("tous les 2 jours,
-- jusqu'au ..."), jamais une date ; le JSON-LD `Event` (lib/seo/jsonld/product.ts) reprend l'ANCRE
-- brute (`occurrence_date`), jamais une date recalculée. Cette migration crée cette brique côté SQL
-- (`next_event_occurrence`), seul endroit qui a besoin de comparer/trier — le TypeScript n'a
-- toujours pas besoin de cette date, aucun changement là-bas.
--
-- Décisions produit prises en écrivant ce lot (pas dans la demande initiale, à signaler) :
--   - Un evento `once` déjà passé (`occurrence_date < aujourd'hui`) n'a plus d'occurrence à venir →
--     `null`, trié en DERNIER (`nulls last`), jamais masqué : ceci ne fait que réordonner, pas
--     filtrer ce qui est montré.
--   - Un `recurring` dont la série est terminée (`recurrence_end_date`/`recurrence_end_count`
--     dépassé) → même traitement, `null`, trié en dernier.
--   - Un `recurring` SANS fin (aucune des deux colonnes posée, la 3ᵉ forme autorisée par
--     `products_recurrence_end_shape`) a TOUJOURS une prochaine occurrence — jamais `null`.
--   - "Aujourd'hui" = `today_in_bogota()` (jamais `current_date` nu, cf. scripts/check-timezone.sh) —
--     une occurrence commençant AUJOURD'HUI compte encore comme à venir (`>=`, pas `>`).

-- `next_event_occurrence` — fonction pure, aucune table lue, donc STABLE et non SECURITY DEFINER
-- (elle n'en a pas besoin). PostgreSQL accorde EXECUTE à PUBLIC sur toute nouvelle fonction
-- (supabase.md, piège des grants inversés) : laissé tel quel, elle est sans risque à exposer (aucun
-- accès aux données) et doit de toute façon être appelable par anon/authenticated puisque
-- `search_catalog` (SECURITY INVOKER, plus bas) l'appelle depuis LEUR contexte, pas depuis un
-- contexte privilégié.
create or replace function public.next_event_occurrence(
  p_occurrence_type text,
  p_occurrence_date date,
  p_recurrence_frequency_days int,
  p_recurrence_end_date date,
  p_recurrence_end_count int
)
returns date
language plpgsql
stable
set search_path = ''
as $$
declare
  v_today constant date := public.today_in_bogota();
  v_n int;
  v_candidate date;
begin
  if p_occurrence_type = 'once' then
    if p_occurrence_date is not null and p_occurrence_date >= v_today then
      return p_occurrence_date;
    end if;
    return null;
  end if;

  if p_occurrence_type = 'recurring'
     and p_occurrence_date is not null
     and p_recurrence_frequency_days is not null
     and p_recurrence_frequency_days > 0
  then
    -- Index (0-based) de la première occurrence de la série qui tombe aujourd'hui ou après —
    -- ceil() garantit v_candidate >= v_today par construction, jamais besoin de boucler la série.
    v_n := greatest(
      0,
      ceil((v_today - p_occurrence_date)::numeric / p_recurrence_frequency_days)
    )::int;
    v_candidate := p_occurrence_date + (v_n * p_recurrence_frequency_days);

    if p_recurrence_end_date is not null and v_candidate > p_recurrence_end_date then
      return null; -- la série s'est terminée avant d'atteindre aujourd'hui
    end if;
    if p_recurrence_end_count is not null and v_n >= p_recurrence_end_count then
      return null; -- même chose, bornée par un nombre d'occurrences plutôt qu'une date
    end if;
    return v_candidate;
  end if;

  return null;
end;
$$;

comment on function public.next_event_occurrence is
  'Prochaine date d''occurrence (>= aujourd''hui à Bogotá) d''un evento once/recurring, ou null '
  's''il n''en reste aucune (série terminée, ou date ponctuelle passée) — jamais utilisée pour '
  'filtrer, seulement pour trier (search_catalog).';

-- `today_in_bogota()` avait été explicitement révoquée à anon/authenticated le 2026-08-28, motivé
-- par « aucun appelant PostgREST n'existe » — ce lot en crée un : `search_catalog` est SECURITY
-- INVOKER (délibéré, cf. son commentaire — les policies _select_public s'appliquent d'elles-mêmes),
-- donc l'appel imbriqué à `next_event_occurrence` → `today_in_bogota()` s'exécute avec les
-- PROPRES privilèges de l'appelant (anon pour un visiteur non connecté). Sans ce grant, toute
-- visite anonyme du catalogue échouerait (permission denied), pas seulement le tri des evento.
grant execute on function public.today_in_bogota() to anon, authenticated;

-- search_catalog (create or replace, signature et RETURNS TABLE strictement inchangés — cf.
-- supabase.md règle 7, aucun besoin de drop). Corps repris de la version vivante
-- (20260914110000_search_catalog_tag_bifurcation.sql, aucune migration ultérieure ne la retouche),
-- modifié à 3 endroits comptés, tout le reste inchangé :
--   1. candidatos : 5 colonnes d'occurrence ajoutées à la lecture de products (aucune autre requête).
--   2. filas : une colonne next_occurrence ajoutée aux DEUX branches du UNION ALL (null pour la
--      carte groupée lodging, calculée uniquement pour evento sinon) — jamais exposée dans le
--      RETURNS TABLE final, uniquement interne au tri (aucun changement TypeScript nécessaire).
--   3. clasificadas : le row_number() qui décide rango_seccion trie désormais les evento par
--      next_occurrence croissant (nulls en dernier), et garde created_at desc pour les 4 autres
--      types — un seul row_number(), pas une branche dupliquée par type.
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
    coalesce(ca.n, 0) as n_alojamientos,
    -- Ajout de cette migration — seul evento en porte, null pour tout autre type.
    p.occurrence_type,
    p.occurrence_date,
    p.recurrence_frequency_days,
    p.recurrence_end_date,
    p.recurrence_end_count
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
      c.created_at       as created_at,
      null::date         as next_occurrence
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
    c.created_at       as created_at,
    case when c.type = 'evento' then
      public.next_event_occurrence(
        c.occurrence_type, c.occurrence_date, c.recurrence_frequency_days,
        c.recurrence_end_date, c.recurrence_end_count
      )
    end                as next_occurrence
  from candidatos c
  where not (c.type = 'lodging' and c.n_alojamientos >= 2)
),

clasificadas as (
  select
    f.*,
    count(*)     over (partition by f.tipo)                                as total_seccion,
    row_number() over (
      partition by f.tipo
      order by
        case when f.tipo = 'evento' then f.next_occurrence end asc nulls last,
        case when f.tipo = 'evento' then null else f.created_at end desc,
        f.id
    ) as rango_seccion
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
  'depuis 2026-09-14. Tri par tipo : created_at desc pour 4 types, next_event_occurrence croissant '
  '(nulls last) pour evento depuis 2026-09-15 — cf. commentaire de tête de cette migration.';
