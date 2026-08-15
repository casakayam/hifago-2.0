-- Feature 19 — Spike technique : valider le blocage multi-jour partagé (05-reference-technique.md
-- §1bis, pas encore spikée techniquement avant cette feature).
--
-- Schéma et RPC EXPLICITEMENT JETABLES : la feature 20 supprimera ces tables spike_* et
-- reconstruira le schéma réel avec les vrais noms de domaine, informée par ce qui est validé ici.
-- Ne pas faire correspondre ce schéma à un modèle "propre" — ce n'est pas le but de ce spike.
--
-- Ce qui reste à prouver ici, non couvert par la feature 6 (déjà validée empiriquement : verrouiller
-- N ressources en ordre stable, tout-ou-rien, mais toujours plusieurs LIGNES d'un même panier) :
-- une réservation multi-jours qui bloque une ressource partagée ENTRE PLUSIEURS PRODUITS DISTINCTS,
-- et l'interaction entre deux types d'opérations différents (camp multi-jours vs activité
-- ordinaire un seul jour) qui se disputent la même ressource — jamais exercé jusqu'ici.
create table spike_provider_resource_calendar (
  provider_id uuid not null,
  slot_date date not null,
  capacity int not null,
  booked int not null default 0,
  primary key (provider_id, slot_date)
);

create table spike_availability_block (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null,
  start_date date not null,
  end_date date not null,
  source_order_line_id uuid not null,
  created_at timestamptz not null default now()
);

-- RLS/grants minimaux (authenticated seul, pas de policy de production) — sans objet pour un
-- schéma jetable jamais exposé à un vrai rôle métier. RPC-only par construction (même invariant
-- que product_availability : aucune policy d'écriture directe), cohérent avec le pattern validé
-- même si le schéma lui-même ne survivra pas à la feature 20.
alter table spike_provider_resource_calendar enable row level security;
revoke insert, update, delete on spike_provider_resource_calendar from authenticated, anon;
alter table spike_availability_block enable row level security;
revoke insert, update, delete on spike_availability_block from authenticated, anon;

-- spike_book_camp : reproduit les 6 étapes de 05-reference-technique.md §1bis. Étapes 5 (fermeture
-- dérivée des autres produits) et 6 (notification post-commit) hors périmètre du spike : aucune des
-- deux n'introduit de risque de concurrence sur l'invariant testé ici (l'une est une lecture
-- dérivée, l'autre est post-commit et asynchrone).
create or replace function spike_book_camp(
  p_provider_id uuid,
  p_start_date date,
  p_days int,
  p_qty int
)
returns jsonb
language plpgsql
security definer         -- obligatoire : reproduit le squelette exact d'une RPC critique
set search_path = ''     -- obligatoire : jamais omis sur une fonction SECURITY DEFINER
as $$
declare
  v_dates date[];
  v_locked_count int := 0;
  v_row record;
  v_block_id uuid;
begin
  -- Étape 1 : construire les dates D…D+N-1 (arithmétique date+int, jamais date+interval qui
  -- convertirait implicitement en timestamp et casserait la comparaison avec slot_date).
  select array_agg(p_start_date + n)
    into v_dates
    from generate_series(0, p_days - 1) as n;

  -- Étape 2 : verrouiller les lignes ressource/date dans un ordre déterministe (ORDER BY
  -- slot_date FOR UPDATE) — condition nécessaire et suffisante pour exclure tout interblocage
  -- entre deux réservations multi-jours concurrentes, y compris sur des plages qui se chevauchent
  -- partiellement (cf. raisonnement du plan, à confirmer empiriquement par le test ci-contre).
  for v_row in
    select slot_date, capacity, booked
      from public.spike_provider_resource_calendar
     where provider_id = p_provider_id
       and slot_date = any(v_dates)
     order by slot_date
     for update
  loop
    v_locked_count := v_locked_count + 1;
    -- Étape 3 (moitié pleine) : refuse dès la première date insuffisamment disponible — aucune
    -- écriture n'a encore eu lieu, tout-ou-rien garanti par ce retour anticipé.
    if v_row.booked + p_qty > v_row.capacity then
      return jsonb_build_object('ok', false, 'reason', 'full', 'slot_date', v_row.slot_date);
    end if;
  end loop;

  -- Étape 3 (moitié manquante) : une date sans ligne du tout n'a rien verrouillé dans la boucle
  -- ci-dessus — un compte de lignes verrouillées inférieur à p_days le révèle après coup, avant
  -- toute écriture.
  if v_locked_count < p_days then
    return jsonb_build_object('ok', false, 'reason', 'slot_not_found');
  end if;

  -- Étape 4 : incrémenter les N lignes et poser le bloc de disponibilité, dans la même
  -- transaction que le verrouillage ci-dessus.
  update public.spike_provider_resource_calendar
     set booked = booked + p_qty
   where provider_id = p_provider_id
     and slot_date = any(v_dates);

  insert into public.spike_availability_block (
    provider_id, start_date, end_date, source_order_line_id
  ) values (
    p_provider_id, p_start_date, p_start_date + (p_days - 1), gen_random_uuid()
  )
  returning id into v_block_id;

  return jsonb_build_object('ok', true, 'block_id', v_block_id);
end;
$$;

grant execute on function spike_book_camp(uuid, date, int, int) to authenticated;

-- spike_book_single_day : verrouille UNE SEULE ligne de la même table, même squelette que
-- reserve_order_line d'origine (Tranche 3). C'est cette fonction, utilisée en concurrence contre
-- spike_book_camp sur la ressource partagée, qui exerce l'interaction jamais testée jusqu'ici
-- (camp multi-jours vs activité ordinaire un seul jour).
create or replace function spike_book_single_day(
  p_provider_id uuid,
  p_date date,
  p_qty int
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_capacity int;
  v_booked int;
begin
  select capacity, booked
    into v_capacity, v_booked
    from public.spike_provider_resource_calendar
   where provider_id = p_provider_id
     and slot_date = p_date
   for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'slot_not_found');
  end if;

  if v_booked + p_qty > v_capacity then
    return jsonb_build_object('ok', false, 'reason', 'full');
  end if;

  update public.spike_provider_resource_calendar
     set booked = booked + p_qty
   where provider_id = p_provider_id
     and slot_date = p_date;

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function spike_book_single_day(uuid, date, int) to authenticated;
