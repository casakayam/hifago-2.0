-- Miroir de disponibilité LobbyPMS (20260917140000) — deux défauts trouvés en relisant tout son
-- cycle de vie, sur demande de Gabriel (« regarde comment mieux faire au niveau de Lobby et le
-- cron »). Aucun des deux ne touche le DÉBIT du cron (déjà sain : 4,5 appels/min pire cas sur 60) —
-- les deux touchent à ce que le miroir SAIT.
--
-- DÉFAUT 1 — le miroir n'apprend RIEN de ce qu'hifago fait lui-même. `reserve-nights` crée un
-- booking Lobby (des nuits viennent d'être occupées), `pms-cancel-bookings` en annule un (des nuits
-- viennent d'être libérées), `pms-poll-bookings` détecte une annulation faite par le staff Lobby
-- (idem) — dans les trois cas, hifago connaît le changement À LA NUIT PRÈS et le miroir ne le
-- découvre qu'à sa prochaine fenêtre de fraîcheur (jusqu'à 24 h pour les mois lointains). Rendre ces
-- trois événements visibles coûte ZÉRO appel Lobby de plus : ils invalident un couple
-- (établissement, mois), ils ne le synchronisent pas eux-mêmes — le cron s'en charge dans les 5 min.
--
-- DÉFAUT 2 — `fail_pms_sync` n'incrémentait jamais `attempts` sur une ligne existante
-- (`do update set last_error` seul) et ne posait aucune date de prochaine tentative. Un
-- établissement au jeton révoqué (401 à chaque appel) a donc `synced_at` qui reste NULL pour
-- toujours : il trie en tête de `claim_pms_sync_batch` (`coalesce(synced_at, '-infinity')`) à
-- CHAQUE passage, et peut occuper la totalité du lot de 6 au détriment d'établissements sains.

-- ── Colonnes ────────────────────────────────────────────────────────────────────────────────────
alter table public.pms_sync_state
  add column if not exists invalidated_at timestamptz,
  add column if not exists next_attempt_at timestamptz;

comment on column public.pms_sync_state.invalidated_at is
  'Posée par mark_pms_sync_due quand hifago sait qu''une réservation/annulation vient de changer la '
  'disponibilité de ce mois. Rend le couple dû si elle est POSTÉRIEURE à claimed_at (course avec un '
  'sync déjà en vol) — jamais réinitialisée explicitement, le prochain claim la dépasse de lui-même.';
comment on column public.pms_sync_state.next_attempt_at is
  'Backoff exponentiel après un échec (fail_pms_sync). Un couple dont next_attempt_at est futur '
  'n''est pas réclamé, même s''il est par ailleurs dû — évite qu''un établissement en échec '
  'permanent monopolise le lot.';

-- ---------------------------------------------------------------------------------------------
-- 1. Invalider un couple (établissement, mois) sans le synchroniser
-- ---------------------------------------------------------------------------------------------
create or replace function public.mark_pms_sync_due(
  p_establishment_id uuid,
  p_from date,
  p_to date
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_establishment_id is null or p_from is null or p_to is null then
    return;
  end if;

  insert into public.pms_sync_state as st (establishment_id, month, invalidated_at)
  select p_establishment_id, to_char(m, 'YYYY-MM'), now()
    from generate_series(
           date_trunc('month', least(p_from, p_to)),
           date_trunc('month', greatest(p_from, p_to)),
           interval '1 month'
         ) as m
  on conflict on constraint pms_sync_state_pkey
  do update set invalidated_at = now();
end;
$$;

revoke all on function public.mark_pms_sync_due(uuid, date, date) from public, authenticated, anon;
grant execute on function public.mark_pms_sync_due(uuid, date, date) to service_role;

-- ---------------------------------------------------------------------------------------------
-- 2. Même chose, mais depuis un seul order_line (poll des bookings — ne connaît que la ligne)
-- ---------------------------------------------------------------------------------------------
create or replace function public.mark_pms_sync_due_for_order_line(
  p_order_line_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_establishment_id uuid;
  v_date date;
  v_end_date date;
begin
  select pr.establishment_id, ol.date, coalesce(ol.end_date, ol.date)
    into v_establishment_id, v_date, v_end_date
    from public.order_lines ol
    join public.products pr on pr.id = ol.product_id
   where ol.id = p_order_line_id;

  if v_establishment_id is not null then
    perform public.mark_pms_sync_due(v_establishment_id, v_date, v_end_date);
  end if;
end;
$$;

revoke all on function public.mark_pms_sync_due_for_order_line(uuid) from public, authenticated, anon;
grant execute on function public.mark_pms_sync_due_for_order_line(uuid) to service_role;

-- ---------------------------------------------------------------------------------------------
-- 3. claim_pms_sync_batch — un couple invalidé APRÈS son claim reste dû ; un couple en backoff non
-- ---------------------------------------------------------------------------------------------
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
        cross join generate_series(0, 6) as n
       where e.lobby_connector_active = true
         and e.lobby_api_token is not null
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
         -- Backoff : un couple en échec répété ne revient qu'après son délai exponentiel, jamais
         -- à chaque passage du cron (fail_pms_sync, migration 20260918170000).
         and (s.next_attempt_at is null or s.next_attempt_at < now())
         and (
           s.synced_at is null
           or s.synced_at < now() - (case when h.rang <= 1 then p_fresh_near else p_fresh_far end)
           -- Invalidation postérieure au dernier claim : une réservation/annulation hifago (ou une
           -- annulation détectée côté Lobby) a changé ce mois PENDANT ou APRÈS le sync qui l'a
           -- rendu frais. `claimed_at` n'est jamais réinitialisé au succès, donc le prochain claim
           -- dépasse naturellement l'ancienne invalidation — aucune remise à zéro n'est nécessaire.
           -- `coalesce(..., '-infinity')` : un mois écrit par le REPLI (`night-availability`
           -- appelle `sync_pms_availability_month` sans jamais passer par un claim, cf. lot B) n'a
           -- pas de `claimed_at` du tout — sans ce repli, toute invalidation ultérieure d'un tel
           -- mois serait comparée à NULL, donc silencieusement perdue jusqu'à l'expiration de sa
           -- fenêtre de fraîcheur.
           or (s.invalidated_at is not null
               and s.invalidated_at > coalesce(s.claimed_at, '-infinity'::timestamptz))
         )
       order by coalesce(s.synced_at, '-infinity'::timestamptz) asc, h.rang asc
       limit p_limit
    ),
    claimed as (
      insert into public.pms_sync_state as st (establishment_id, month, claimed_at, attempts)
      select d.establishment_id, d.month, now(), 1 from dus d
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
-- 4. sync_pms_availability_month — un succès remet le backoff à zéro
-- ---------------------------------------------------------------------------------------------
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
   on conflict do nothing;
  get diagnostics v_ecrites = row_count;

  delete from public.pms_availability_mirror
   where establishment_id = p_establishment_id
     and date < public.today_in_bogota();

  insert into public.pms_sync_state as st (establishment_id, month, synced_at, attempts, last_error, next_attempt_at)
  values (p_establishment_id, p_month, v_now, 0, null, null)
  on conflict on constraint pms_sync_state_pkey
  do update set synced_at = v_now, attempts = 0, last_error = null, next_attempt_at = null;

  update public.establishments set lobby_last_synced_at = v_now where id = p_establishment_id;

  return jsonb_build_object('ok', true, 'written', v_ecrites, 'removed', v_retirees);
end;
$$;

revoke all on function public.sync_pms_availability_month(uuid, text, jsonb)
  from public, authenticated, anon;
grant execute on function public.sync_pms_availability_month(uuid, text, jsonb) to service_role;

-- ---------------------------------------------------------------------------------------------
-- 5. fail_pms_sync — DROP obligatoire : le 4ᵉ paramètre change la signature (.claude/rules/
--    supabase.md §7), `create or replace` seul créerait une deuxième fonction surchargée au lieu
--    de remplacer celle-ci.
-- ---------------------------------------------------------------------------------------------
drop function if exists public.fail_pms_sync(uuid, text, text);

create function public.fail_pms_sync(
  p_establishment_id uuid,
  p_month text,
  p_error text,
  p_retry_after_seconds int default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempts int;
  v_backoff interval;
begin
  insert into public.pms_sync_state as st (establishment_id, month, attempts, last_error)
  values (p_establishment_id, p_month, 1, left(coalesce(p_error, ''), 300))
  on conflict on constraint pms_sync_state_pkey
  do update set attempts = st.attempts + 1, last_error = left(coalesce(p_error, ''), 300)
  returning st.attempts into v_attempts;

  -- 5 min × 2^(tentatives-1), plafonné à 24 h : 5, 10, 20, 40 min, 1h20, 2h40... jusqu'au plafond.
  -- Un `Retry-After` explicite de Lobby (429) prime s'il excède ce calcul.
  v_backoff := least(
    make_interval(mins => (5 * power(2, greatest(v_attempts, 1) - 1))::int),
    interval '24 hours'
  );
  if p_retry_after_seconds is not null then
    v_backoff := greatest(v_backoff, make_interval(secs => p_retry_after_seconds));
  end if;

  update public.pms_sync_state
     set next_attempt_at = now() + v_backoff
   where establishment_id = p_establishment_id and month = p_month;
end;
$$;

revoke all on function public.fail_pms_sync(uuid, text, text, int) from public, authenticated, anon;
grant execute on function public.fail_pms_sync(uuid, text, text, int) to service_role;

-- ---------------------------------------------------------------------------------------------
-- 6. resolve_pms_cancellation — une annulation ACTÉE côté Lobby invalide le mois concerné
-- ---------------------------------------------------------------------------------------------
-- Signature inchangée (4 params) : `create or replace` suffit, aucun `drop` requis.
create or replace function resolve_pms_cancellation(
  p_entry_id uuid,
  p_outcome text,
  p_lobby_status_code int default null,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_establishment_id uuid;
  v_pms_booking_id text;
  v_from date;
  v_to date;
begin
  if p_outcome not in ('done', 'failed') then
    raise exception 'resolve_pms_cancellation : issue invalide %', p_outcome;
  end if;

  update public.pms_cancellation_queue
     set status = p_outcome,
         lobby_status_code = p_lobby_status_code,
         last_error = p_error,
         processed_at = now()
   where id = p_entry_id
  returning establishment_id, pms_booking_id into v_establishment_id, v_pms_booking_id;

  -- 'done' couvre trois cas (annulée, déjà annulée côté Lobby, refus terminal comme
  -- RESTRICTED_RESERVATION) — seuls les deux premiers libèrent réellement des nuits. Ne pas les
  -- distinguer ici est un choix délibéré : le troisième cas est rare, et marquer le mois dû à tort
  -- coûte un sync de plus dans les 5 minutes, jamais une incohérence. L'inverse (rater une vraie
  -- libération) coûterait jusqu'à 24 h de miroir faux.
  if p_outcome = 'done' and v_establishment_id is not null then
    select min(date), max(coalesce(end_date, date))
      into v_from, v_to
      from public.order_lines
     where pms_booking_id = v_pms_booking_id;

    if v_from is not null then
      perform public.mark_pms_sync_due(v_establishment_id, v_from, v_to);
    end if;
  end if;
end;
$$;

revoke execute on function resolve_pms_cancellation(uuid, text, int, text) from public, authenticated, anon;
grant execute on function resolve_pms_cancellation(uuid, text, int, text) to service_role;
