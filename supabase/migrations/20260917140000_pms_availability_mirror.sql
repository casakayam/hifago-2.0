-- Miroir de disponibilité LobbyPMS — pour que la RECHERCHE DATÉE puisse filtrer les logements
-- adossés au PMS, ce qu'elle ne sait pas faire aujourd'hui.
--
-- LE PROBLÈME. `search_catalog` est du SQL pur : elle ne peut pas appeler LobbyPMS. Elle contourne
-- donc le sujet par une seule ligne — `or e.lobby_connector_active`
-- (20260916110000_search_catalog_date_filter_by_type.sql) — qui court-circuite ENTIÈREMENT le
-- filtre de dates pour tous les produits d'un établissement connecté. Chercher « du 3 au 5
-- octobre » fait donc apparaître Casa Kayam même si tout est complet (« il apparaît, sans garantie
-- de disponibilité », docs/01-cahier-des-charges-client.md §2f, décision différée le 2026-09-07).
-- Cette ligne n'est tenue par AUCUN test : la retirer ne ferait rougir aucune suite.
--
-- ⚠️ LA FRONTIÈRE, ET ELLE N'EST PAS NÉGOCIABLE. docs/specs/24 §0 pose que Lobby fait foi sur la
-- disponibilité, « relue à chaud, jamais copiée en base ». Cette table EST une copie — elle n'est
-- donc légitime qu'à une condition, écrite dans le `comment on table` ci-dessous et à ne jamais
-- relâcher : **elle sert à FILTRER une liste, jamais à décider d'une réservation.** La barrière
-- reste `POST /api/pms/reserve-nights`, qui appelle Lobby à chaud avant toute confirmation
-- (20260829100000 + le réordonnancement du 2026-08-29). C'est la même distinction que
-- `CLAUDE.md` §4.5 pose déjà pour Realtime : un confort d'affichage n'est jamais une source de
-- vérité. Décision de Gabriel le 2026-09-17, à faire valider par Jérôme.
--
-- POURQUOI UN MIROIR PLUTÔT QU'UN APPEL À CHAUD PENDANT LA RECHERCHE. Un appel à chaud fait suivre
-- le coût au TRAFIC, et rien ne le borne : 50 visiteurs/minute sur une recherche datée × K
-- établissements PMS dans la page dépassent immédiatement le quota (60 appels par fenêtre glissante
-- d'une minute, fenêtre mesurée le 2026-08-28), et la recherche casse pour tout le monde. Avec un
-- cron à lot borné, c'est NOUS qui fixons le débit : le nombre d'établissements n'allonge que le
-- délai de rafraîchissement, jamais le débit d'appels.
--
-- CE QUI NE MULTIPLIE PAS : le nombre de chambres. `getLobbyAvailableRooms` est appelé SANS
-- `category_id` (packages/domain/src/pms/lobbyClient.ts) — une réponse porte toutes les catégories
-- de l'établissement. Un appel = un établissement × une plage × toutes ses chambres.
--
-- Pas une RPC critique au sens de CLAUDE.md §4.1 : aucun compteur de capacité n'est décrémenté ici,
-- aucune réservation n'en dépend. Pas de test de concurrence à barrière, donc — .claude/rules/
-- supabase.md le dit explicitement pour une vue miroir.

-- ---------------------------------------------------------------------------------------------
-- 1. Les données
-- ---------------------------------------------------------------------------------------------
create table if not exists public.pms_availability_mirror (
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  -- Entier LOCAL au compte Lobby de cet établissement, jamais un identifiant global : deux
  -- établissements peuvent porter la même valeur pour des chambres sans rapport. D'où la place de
  -- `establishment_id` en tête de la clé primaire.
  lobby_category_id int not null,
  date date not null,
  -- ⚠️ En UNITÉS LOBBY, jamais en cupos hifago. La conversion (`cuposPerUnit`, dorm ⇒ unités ×
  -- capacité) dépend du PRODUIT, pas de la catégorie : deux produits liés à la même catégorie
  -- peuvent avoir des `lodging_kind` différents. Elle reste donc faite par produit, après lecture —
  -- exactement comme le fait déjà /api/pms/night-availability. Pour un FILTRE « reste-t-il quelque
  -- chose ? », le signe suffit et la conversion est inutile.
  available_units int not null,
  -- Restrictions Lobby de la catégorie pour cette nuit. `{0,0,0}` sur les six catégories de Casa
  -- Kayam (mesuré le 2026-08-27, reconfirmé le 28) — stockées pour ne pas avoir à re-sonder le jour
  -- où un socio en pose une, pas parce qu'elles servent déjà.
  min_stay int,
  max_stay int,
  lead_days int,
  synced_at timestamptz not null default now(),
  primary key (establishment_id, lobby_category_id, date)
);

comment on table public.pms_availability_mirror is
  'INDEX DE RECHERCHE, JAMAIS UNE SOURCE DE VÉRITÉ. Copie rafraîchie par cron de la disponibilité '
  'LobbyPMS, dont le seul rôle est de permettre à search_catalog de filtrer par dates un logement '
  'adossé au PMS. AUCUNE décision de réservation ne doit la lire : la barrière est '
  'POST /api/pms/reserve-nights, qui appelle Lobby à chaud avant toute confirmation (spec 24 §0, '
  'CLAUDE.md §4.5). Sa donnée a par construction plusieurs minutes de retard.';

-- L'index de lecture de search_catalog : on demande « existe-t-il une nuit disponible dans cette
-- plage pour ce couple établissement+catégorie ». Le préfixe de la PK sert le couple, mais pas le
-- filtre sur `available_units` — d'où cet index partiel, qui ne porte que les nuits réellement
-- vendables (les nuits à 0 sont nombreuses en haute saison et n'ont aucune raison d'y figurer).
create index if not exists pms_availability_mirror_disponible_idx
  on public.pms_availability_mirror (establishment_id, lobby_category_id, date)
  where available_units > 0;

-- Frontière : lecture publique (search_catalog est SECURITY INVOKER — elle lit avec les droits de
-- l'appelant anonyme, comme product_availability), écriture RPC-only stricte.
alter table public.pms_availability_mirror enable row level security;

create policy pms_availability_mirror_select_public
  on public.pms_availability_mirror for select using (true);

grant select on public.pms_availability_mirror to anon, authenticated;
revoke insert, update, delete on public.pms_availability_mirror from authenticated, anon;
-- aucune policy d'écriture n'est créée sur cette table

-- ---------------------------------------------------------------------------------------------
-- 2. L'état de synchronisation — la file de travail, distincte des données
-- ---------------------------------------------------------------------------------------------
-- Séparée du miroir pour la même raison que `pms_cancellation_queue` vit à côté de
-- `order_lines.pms_booking_id` plutôt que dedans : un mois qui échoue en boucle doit être visible
-- SANS polluer la donnée servie. L'unité de travail est le couple (établissement, mois), parce que
-- c'est exactement l'unité d'UN appel Lobby — borner le lot borne donc directement le débit.
create table if not exists public.pms_sync_state (
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  month text not null check (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  synced_at timestamptz,
  claimed_at timestamptz,
  attempts int not null default 0,
  last_error text,
  primary key (establishment_id, month)
);

comment on table public.pms_sync_state is
  'File de travail du miroir de disponibilité LobbyPMS : un couple (établissement, mois) = un appel '
  'Lobby. RPC-only stricte, aucune policy — seul service_role y touche, via claim_pms_sync_batch et '
  'sync_pms_availability_month.';

alter table public.pms_sync_state enable row level security;
revoke all on public.pms_sync_state from authenticated, anon;
-- aucune policy : RPC-only stricte, cette table n'est jamais lue depuis l'app

-- ---------------------------------------------------------------------------------------------
-- 3. Réclamer un lot de travail
-- ---------------------------------------------------------------------------------------------
-- ⚠️ CRITIQUE : renvoie le jeton Lobby EN CLAIR. Le `revoke` explicite en fin de fichier n'est pas
-- une précaution superflue — PostgreSQL accorde EXECUTE à PUBLIC sur toute nouvelle FONCTION (sens
-- inverse des tables, cf. .claude/rules/supabase.md), donc sans lui `anon` pourrait l'appeler.
--
-- FRAÎCHEUR DIFFÉRENCIÉE : les deux premiers mois bougent en permanence, le sixième presque jamais.
-- Les rafraîchir au même rythme triplerait le coût pour rien.
--
-- PAS de `for update skip locked` ici, et c'est délibéré : il n'y a pas de ligne à verrouiller pour
-- un couple qui n'existe pas encore. Le rôle de garde est tenu par `claimed_at` (un couple réclamé
-- il y a moins de `p_visibility` n'est pas re-servi) — le patron « visibility timeout » d'une file,
-- suffisant ici où le pire cas est un appel Lobby en double sur une écriture idempotente.
create or replace function public.claim_pms_sync_batch(
  p_limit int default 4,
  p_fresh_near interval default '2 hours',
  p_fresh_far interval default '24 hours',
  p_visibility interval default '10 minutes'
)
returns table (
  establishment_id uuid,
  lobby_api_token text,
  month text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
    with horizon as (
      select e.id as establishment_id,
             to_char(date_trunc('month', public.today_in_bogota()::timestamp)
                     + (n || ' months')::interval, 'YYYY-MM') as month,
             n as rang
        from public.establishments e
        -- ⚠️ 0 à 6, donc SEPT mois, et surtout pas six. `isMonthWithinHorizon` accepte un écart
        -- `<= RESERVATION_HORIZON_MONTHS` (6), et `lastBookableDateIso` vaut `aujourd'hui + 6 mois`
        -- — une date qui tombe dans le mois de rang 6. Avec `generate_series(0, 5)`, ce mois-là
        -- n'entrait JAMAIS dans le miroir : une recherche datée dessus trouvait zéro ligne sans
        -- déclencher le repli de fraîcheur (qui est par établissement, pas par mois) et faisait
        -- donc DISPARAÎTRE tous les logements PMS, pendant que les non-PMS restaient visibles.
        -- C'est le quatrième horizon du dépôt : 20260913100000 met en garde nommément contre leur
        -- divergence — d'où l'assertion pgTAP qui tient ce span (pms_availability_mirror.test.sql).
        cross join generate_series(0, 6) as n
       where e.lobby_connector_active = true
         and e.lobby_api_token is not null
         -- Un établissement connecté SANS logement lié et vendable ne coûte rien : il n'a aucune
         -- ligne à filtrer dans search_catalog.
         and exists (
           select 1 from public.products p
            where p.establishment_id = e.id
              and p.type = 'lodging'
              and p.sellable
              and p.lobby_category_id is not null
         )
    ),
    dus as (
      select h.establishment_id, h.month, h.rang, s.synced_at
        from horizon h
        left join public.pms_sync_state s
          on s.establishment_id = h.establishment_id and s.month = h.month
       where (s.claimed_at is null or s.claimed_at < now() - p_visibility)
         and (
           s.synced_at is null
           or s.synced_at < now() - (case when h.rang <= 1 then p_fresh_near else p_fresh_far end)
         )
       -- Le plus ancien d'abord, puis le mois le plus proche : à lot saturé, c'est ce que le
       -- visiteur regarde qui se rafraîchit en premier.
       order by coalesce(s.synced_at, '-infinity'::timestamptz) asc, h.rang asc
       limit p_limit
    ),
    claimed as (
      insert into public.pms_sync_state as st (establishment_id, month, claimed_at, attempts)
      select d.establishment_id, d.month, now(), 1 from dus d
      -- ⚠️ `on constraint`, jamais `on conflict (establishment_id, month)` : les colonnes de SORTIE
      -- de cette fonction portent ces deux noms, et PL/pgSQL les résout alors comme des variables —
      -- « column reference "establishment_id" is ambiguous », à l'exécution seulement. Le nom de
      -- contrainte lève l'ambiguïté sans renommer le contrat de retour.
      on conflict on constraint pms_sync_state_pkey
      do update set claimed_at = now(), attempts = st.attempts + 1
      returning st.establishment_id, st.month
    )
    select c.establishment_id, e.lobby_api_token, c.month
      from claimed c
      join public.establishments e on e.id = c.establishment_id;
end;
$$;

revoke all on function public.claim_pms_sync_batch(int, interval, interval, interval)
  from public, authenticated, anon;
grant execute on function public.claim_pms_sync_batch(int, interval, interval, interval)
  to service_role;

-- ---------------------------------------------------------------------------------------------
-- 4. Écrire un mois synchronisé
-- ---------------------------------------------------------------------------------------------
-- Un seul aller-retour depuis l'Edge Function, tout le mois d'un coup (CLAUDE.md §4.1 pour la
-- forme, même si cette RPC n'est pas critique au sens du §4).
--
-- `p_rows` : [{"category_id":9631,"date":"2026-10-01","available_units":3,
--              "min_stay":0,"max_stay":0,"lead_days":0}, ...]
-- Les dates viennent de la RÉPONSE Lobby, jamais de la requête (.claude/rules/supabase.md) — le
-- parseur du domaine s'en charge en amont, cette fonction ne fait que les écrire.
create or replace function public.sync_pms_availability_month(
  p_establishment_id uuid,
  p_month text,
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_debut date;
  v_fin date;
  v_ecrites int;
  v_retirees int;
begin
  if p_month !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_month');
  end if;

  v_debut := (p_month || '-01')::date;
  v_fin := (v_debut + interval '1 month')::date;

  -- ⚠️ REMPLACEMENT DU MOIS, pas un upsert suivi d'un balayage des lignes non rafraîchies.
  -- La première version comparait `synced_at < v_now` pour retirer ce que Lobby ne cote plus. Ça ne
  -- marche PAS : `now()` est figé pour toute une transaction, donc deux syncs du même mois dans une
  -- même transaction portent le même timestamp et le delete ne retire rien — mesuré le 2026-09-17,
  -- et un test en transaction annulée ne pouvait même pas voir le comportement réel. Un
  -- delete-puis-insert est déterministe et reste ATOMIQUE pour les lecteurs (read committed : on
  -- voit l'ancien mois entier ou le nouveau, jamais un mois vide).
  delete from public.pms_availability_mirror
   where establishment_id = p_establishment_id
     and date >= v_debut and date < v_fin;
  get diagnostics v_retirees = row_count;

  insert into public.pms_availability_mirror as m (
    establishment_id, lobby_category_id, date, available_units, min_stay, max_stay, lead_days, synced_at
  )
  select p_establishment_id,
         (r->>'category_id')::int,
         (r->>'date')::date,
         greatest((r->>'available_units')::int, 0),
         nullif(r->>'min_stay', '')::int,
         nullif(r->>'max_stay', '')::int,
         nullif(r->>'lead_days', '')::int,
         v_now
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) as r
   where (r->>'date')::date >= v_debut and (r->>'date')::date < v_fin
   -- ⚠️ PAS de `on conflict` ici, et la première version en avait un « au cas où Lobby renverrait
   -- deux fois la même (catégorie, date) ». Elle se trompait sur Postgres : deux lignes en conflit
   -- DANS LE MÊME insert ne sont pas absorbées par `on conflict do update`, elles lèvent
   -- « ON CONFLICT DO UPDATE command cannot affect row a second time » (21000). La clause était
   -- donc à la fois inatteignable (le mois vient d'être vidé) et fausse sur le seul cas qu'elle
   -- prétendait couvrir. Si un jour Lobby renvoie des doublons, la parade est un
   -- `select distinct on ((r->>'category_id')::int, (r->>'date')::date)` ci-dessus, pas ici.
   on conflict do nothing;
  get diagnostics v_ecrites = row_count;

  -- La fenêtre glisse : le passé n'a plus aucun usage et ferait gonfler la table indéfiniment.
  delete from public.pms_availability_mirror
   where establishment_id = p_establishment_id
     and date < public.today_in_bogota();

  insert into public.pms_sync_state as st (establishment_id, month, synced_at, attempts, last_error)
  values (p_establishment_id, p_month, v_now, 0, null)
  on conflict on constraint pms_sync_state_pkey
  do update set synced_at = v_now, attempts = 0, last_error = null;

  -- Colonne posée le 2026-08-19 et restée MORTE depuis : jamais écrite par aucun code, seulement
  -- lue et affichée par l'écran admin de l'établissement. Elle dit enfin quelque chose de vrai.
  update public.establishments set lobby_last_synced_at = v_now where id = p_establishment_id;

  return jsonb_build_object('ok', true, 'written', v_ecrites, 'removed', v_retirees);
end;
$$;

revoke all on function public.sync_pms_availability_month(uuid, text, jsonb)
  from public, authenticated, anon;
grant execute on function public.sync_pms_availability_month(uuid, text, jsonb) to service_role;

-- ---------------------------------------------------------------------------------------------
-- 5. Consigner un échec
-- ---------------------------------------------------------------------------------------------
-- Volontairement SANS e-mail ni entrée de réconciliation : la supervision d'une file est un
-- problème de comptage, pas de notification unitaire (même raisonnement que
-- 20260827160000_pms_cancellation_queue.sql, et le trigger notify_all_admins n'a toujours pas de
-- déduplication). Un mois qui échoue laisse simplement vieillir sa donnée, et search_catalog
-- retombe en doctrine optimiste au-delà du seuil de fraîcheur — jamais en faisant disparaître le
-- partenaire du site.
create or replace function public.fail_pms_sync(
  p_establishment_id uuid,
  p_month text,
  p_error text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.pms_sync_state as st (establishment_id, month, attempts, last_error)
  values (p_establishment_id, p_month, 1, left(coalesce(p_error, ''), 300))
  on conflict on constraint pms_sync_state_pkey
  do update set last_error = left(coalesce(p_error, ''), 300);
end;
$$;

revoke all on function public.fail_pms_sync(uuid, text, text) from public, authenticated, anon;
grant execute on function public.fail_pms_sync(uuid, text, text) to service_role;
