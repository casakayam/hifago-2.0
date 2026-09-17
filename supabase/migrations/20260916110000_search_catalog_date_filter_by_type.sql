-- Bug remonté par Jérôme (2026-09-16) : filtrer la home par dates (ex. 17-18 septembre) laissait
-- remonter des offres sans AUCUNE date correspondante — `campamento 1` (prochain départ le
-- 2026-10-01), l'événement `kayam-s-jam` (occurrences les 16 et 30/09, jamais le 17-18), et
-- l'activité `yoga-session` (créneau hebdomadaire fixe, un seul jour de semaine).
--
-- Cause : le filtre `p_desde`/`p_hasta` de `search_catalog`, posé le 2026-09-07
-- (20260907200000_search_catalog.sql), ne lit QUE `product_calendar` — un choix documenté à
-- l'époque (« l'offre est PROPOSÉE à ces dates, jamais product_availability, pour ne jamais
-- confondre "proposé" et "il reste de la place" »), pertinent pour lodging/activity/transport où
-- schedule (product_calendar) et capacité (product_availability) sont deux signaux séparés. Mais
-- trois types ont depuis leur PROPRE modèle de date, jamais branché sur ce filtre, et n'écrivent
-- JAMAIS dans product_calendar :
--   - camp : ses départs vivent dans product_availability (date = départ, products.duration_days
--     = longueur du séjour) — calendrier fixe posé une fois par l'admin/seed, aucun repli
--     automatique (20260814220000_camp_multiday_booking.sql).
--   - evento : ses dates vivent dans occurrence_type/occurrence_date/recurrence_* (colonnes de
--     products), déjà lues par next_event_occurrence — mais seulement pour TRIER, jamais pour
--     FILTRER (cf. son propre commentaire).
--   - activity À CRÉNEAUX récurrents (product_slot_rules, ex. yoga) : ses jours vivent dans
--     product_slot_rules.weekdays.
-- Résultat : products.calendar_default_open valant true par défaut et aucune ligne
-- product_calendar n'existant jamais pour ces trois cas, la branche "défaut ouvert" du filtre
-- était vacuously vraie — le filtre de dates ne filtrait RIEN pour camp/evento/activity-à-créneaux,
-- quelle que soit la plage demandée. Une "activity" classique sans créneaux (ex. jetski,
-- schedule='date') n'est PAS concernée : product_calendar reste son signal de "proposé", déjà
-- correct (testé, supabase/tests/database/search_catalog.test.sql).
--
-- ⚠️ Lire product_availability pour CAMP ci-dessous ne contredit PAS la politique du 2026-09-07 :
-- cette politique visait les types où schedule et capacité sont deux signaux séparés. Le camp n'a
-- AUCUN second signal — sa ligne product_availability EST son calendrier (posée une fois, jamais
-- un compteur de remplissage qu'on consulterait en trop). Pour activity-à-créneaux, en revanche, on
-- compare uniquement aux JOURS DE SEMAINE de product_slot_rules — jamais à product_slot_availability
-- (compteur booked/capacité par créneau réel matérialisé par create_order), exactement la même
-- distinction que product_calendar/product_availability pour lodging.
--
-- La question posée au filtre evento — « y a-t-il une occurrence dans [p_desde, p_hasta] ? » — est
-- déjà répondue par `expand_event_occurrences` (20260915120000), dont l'en-tête dit pourquoi elle
-- existe : « plutôt que de réinventer un second calcul de récurrence qui pourrait diverger ».
-- `create_order` l'utilise exactement sous cette forme (`exists (select 1 from ...)`) pour garder
-- une réservation ; la recherche l'utilise ici sous la MÊME forme, pour qu'une offre ne puisse
-- jamais être listée à une date que `create_order` refuserait. Équivalence vérifiée en réel le
-- 2026-09-16 contre l'écriture ad hoc qu'elle remplaçait : 0 divergence sur 319 472 combinaisons
-- (16 eventos x 487 dates de départ x 41 longueurs de plage).

-- search_catalog (create or replace, signature et RETURNS TABLE strictement inchangés — cf.
-- supabase.md règle 7). Corps repris de la version vivante
-- (20260915110000_search_catalog_evento_next_occurrence.sql), UN SEUL bloc modifié : le filtre de
-- dates (auparavant lignes 243-267), qui bifurque désormais par type au lieu de ne lire que
-- product_calendar. Tout le reste (candidatos, filas, clasificadas, tri) est inchangé.
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

    -- Filtre par dates — bifurqué par type (cf. en-tête de cette migration). camp/evento/activity-
    -- à-créneaux ont chacun leur PROPRE modèle de date, jamais écrit dans product_calendar :
    -- product_calendar resterait vacuously "ouvert par défaut" pour eux (bug corrigé ici).
    and (
      p_desde is null or p_hasta is null
      or p.schedule = 'none'
      or e.lobby_connector_active
      or (
        case
          when p.type = 'camp' then
            exists (
              select 1
              from public.product_availability pa
              where pa.product_id = p.id
                -- Arithmétique portée par les PARAMÈTRES, jamais par pa.date : sans ça la borne
                -- basse n'est pas indexable et le scan remonte tous les départs déjà passés.
                and pa.date between p_desde - (p.duration_days - 1) and p_hasta
            )
          when p.type = 'evento' then
            exists (select 1 from public.expand_event_occurrences(p.id, p_desde, p_hasta))
          when p.type = 'activity' and exists (
            select 1 from public.product_slot_rules psr where psr.product_id = p.id
          ) then
            exists (
              select 1
              from public.product_slot_rules psr
              where psr.product_id = p.id
                -- Recouvrement de tableaux plutôt qu'un generate_series corrélé : le sous-select
                -- ne dépend que des paramètres, Postgres l'évalue UNE fois (InitPlan) au lieu de
                -- redérouler la plage par produit candidat. `least(p_desde + 6)` : au-delà de 7
                -- jours consécutifs la plage couvre déjà tous les jours de semaine.
                and psr.weekdays && (
                  select array_agg(distinct extract(isodow from d.jour)::smallint)
                  from generate_series(
                    p_desde, least(p_hasta, p_desde + 6), interval '1 day'
                  ) as d(jour)
                )
            )
          else
            -- Chemin inchangé (lodging, transport, activity sans créneaux) : product_calendar est
            -- CREUX, l'absence de ligne vaut calendar_default_open (true par défaut).
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
  '(nulls last) pour evento depuis 2026-09-15. Filtre par dates (p_desde/p_hasta) bifurqué par '
  'type depuis 2026-09-16 : product_calendar pour lodging/transport/activity sans créneaux, '
  'product_availability (départs) pour camp, expand_event_occurrences pour evento, product_slot_rules '
  '(jours de semaine) pour activity à créneaux — cf. 20260916110000_search_catalog_date_filter_by_type.sql.';
