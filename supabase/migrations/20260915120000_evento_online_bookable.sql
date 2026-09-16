-- Evento réservable en ligne — capacité, gratuité, paiement (plan validé avec Jérôme/Gabriel le
-- 2026-09-15, docs/journal/2026-09.md). Le type `evento` est aujourd'hui TOUJOURS en mode vitrine
-- pure (`availabilityScreenFor` renvoie 'none', exclu du dispatch de create_order) — trou identifié
-- dans la grille de suivi bêta-test (evt-1/evt-3). Le cahier des charges anticipait déjà un gate
-- binaire « réservable en ligne si l'admin l'active » (docs/01-cahier-des-charges-client.md:171,
-- 540-544) mais rien n'a jamais câblé ce chemin. Ce lot va plus loin : deux axes indépendants par
-- fiche, capacité (3 modes) et paiement (gratuit / en ligne / sur place).
--
-- Décisions produit actées (à ne pas rouvrir sans fait nouveau) :
--   - Mode "sans décompte" (RSVP) : compteur de participants affiché, JAMAIS purement silencieux —
--     default_capacity y sert de dénominateur informatif, jamais un plafond bloquant.
--   - Gratuit = statut INDÉPENDANT (is_free), jamais un price_cop à 0 — pour ne jamais entrer en
--     collision avec la convention déjà documentée côté front (tipos.ts:56, FichaProducto.tsx:126)
--     qu'un prix nul prétendrait une gratuité non confirmée.
--   - Payable hors app = réglé SUR PLACE à l'établissement, en réutilisant le modèle d'acompte
--     17/10/7 existant (acompte forcé à 0 dans create_order, migration suivante) — pas de nouveau
--     canal de paiement.
--   - evento_occupies_resource (défaut true) : un evento réservable bloque par défaut le calendrier
--     partagé du prestataire (comme un camp, cf. migration suivante), mais un interrupteur par fiche
--     permet de désactiver ce blocage pour un evento léger/récurrent qui ne monopolise pas
--     réellement le lieu (ex. un concert du soir toutes les 2 semaines) — sans lui, tout evento
--     réservable bloquerait systématiquement les camps du même établissement sur cette date.

alter table public.products
  add column online_bookable boolean not null default false,
  add column evento_capacity_mode text,
  add column is_free boolean not null default false,
  add column evento_payment_mode text,
  add column evento_occupies_resource boolean not null default true,

  add constraint products_online_bookable_evento_only
    check (not online_bookable or type = 'evento'),
  -- Interrupteur par evento : ne peut être désactivé QUE pour un evento — jamais un moyen détourné
  -- de neutraliser le verrouillage d'un camp, qui n'a pas ce champ exposé en admin.
  add constraint products_evento_occupies_resource_evento_only
    check (evento_occupies_resource or type = 'evento'),

  -- Axe 1 — mode de capacité
  add constraint products_evento_capacity_mode_check
    check (evento_capacity_mode is null or evento_capacity_mode in ('unlimited', 'metered', 'rsvp')),
  add constraint products_evento_capacity_mode_evento_only
    check (evento_capacity_mode is null or type = 'evento'),
  add constraint products_evento_capacity_mode_required_if_bookable
    check (not online_bookable or evento_capacity_mode is not null),
  -- default_capacity RÉUTILISÉE (pas de nouvelle colonne) : plafond dur en 'metered', dénominateur
  -- informatif du compteur en 'rsvp', ignorée en 'unlimited'.
  add constraint products_evento_capacity_mode_requires_capacity
    check (evento_capacity_mode not in ('metered', 'rsvp') or default_capacity is not null),

  -- Axe 2 — gratuit, statut INDÉPENDANT de price_cop (jamais 0 COP)
  add constraint products_is_free_evento_only
    check (not is_free or type = 'evento'),
  add constraint products_evento_is_free_price_null
    check (not is_free or price_cop is null),

  -- Axe 2 — payant : en ligne (flux Mercado Pago existant) ou sur place (acompte forcé à 0)
  add constraint products_evento_payment_mode_check
    check (evento_payment_mode is null or evento_payment_mode in ('online', 'on_site')),
  add constraint products_evento_payment_mode_evento_only
    check (evento_payment_mode is null or type = 'evento'),
  add constraint products_evento_payment_mode_required_if_paid
    check (is_free or not online_bookable or evento_payment_mode is not null),
  add constraint products_evento_payment_mode_null_if_free
    check (not is_free or evento_payment_mode is null);

-- Sert get_evento_rsvp_counts (agrégat par date) et le futur écran "mes réservations" d'un evento.
create index if not exists order_lines_product_id_date_idx on public.order_lines (product_id, date);

-- expand_event_occurrences — réutilise EXACTEMENT l'arithmétique de next_event_occurrence
-- (20260915110000, le trick `ceil()`) plutôt que de réinventer un second calcul de récurrence qui
-- pourrait diverger. STABLE, PAS security definer : ne lit que products, déjà public
-- (products_select_public) — même posture que next_event_occurrence lui-même.
create or replace function public.expand_event_occurrences(p_product_id uuid, p_from date, p_to date)
returns setof date
language plpgsql
stable
set search_path = ''
as $$
declare
  v_occurrence_type text;
  v_occurrence_date date;
  v_recurrence_frequency_days int;
  v_recurrence_end_date date;
  v_recurrence_end_count int;
  v_n_from int;
  v_n_to int;
begin
  select occurrence_type, occurrence_date, recurrence_frequency_days,
         recurrence_end_date, recurrence_end_count
    into v_occurrence_type, v_occurrence_date, v_recurrence_frequency_days,
         v_recurrence_end_date, v_recurrence_end_count
    from public.products
   where id = p_product_id;

  if not found or v_occurrence_date is null or p_to < p_from then
    return;
  end if;

  if v_occurrence_type = 'once' then
    if v_occurrence_date between p_from and p_to then
      return next v_occurrence_date;
    end if;
    return;
  end if;

  if v_occurrence_type = 'recurring'
     and v_recurrence_frequency_days is not null
     and v_recurrence_frequency_days > 0
  then
    -- Même trick que next_event_occurrence : index (0-based) de la première occurrence >= p_from,
    -- jamais besoin de boucler la série depuis son origine.
    v_n_from := greatest(
      0,
      ceil((p_from - v_occurrence_date)::numeric / v_recurrence_frequency_days)
    )::int;
    v_n_to := floor((p_to - v_occurrence_date)::numeric / v_recurrence_frequency_days)::int;
    if v_n_to < v_n_from then
      return;
    end if;
    if v_recurrence_end_count is not null then
      v_n_to := least(v_n_to, v_recurrence_end_count - 1);
    end if;
    -- Plafond défensif à 1000 occurrences par appel (une série sans fin sur un p_to lointain).
    v_n_to := least(v_n_to, v_n_from + 999);

    return query
      select v_occurrence_date + (n * v_recurrence_frequency_days)
        from generate_series(v_n_from, v_n_to) as n
       where v_recurrence_end_date is null
          or v_occurrence_date + (n * v_recurrence_frequency_days) <= v_recurrence_end_date;
  end if;

  return;
end;
$$;

comment on function public.expand_event_occurrences is
  'Toutes les dates d''occurrence d''un evento once/recurring dans [p_from, p_to] — réutilise le '
  'calcul d''index de next_event_occurrence (20260915110000), jamais un second calcul indépendant. '
  'Utilisée par get_event_occurrence_availability (fiche publique), provision_evento_availability '
  '(admin) et create_order (garde invalid_occurrence_date).';

-- get_event_occurrence_availability — occurrences + capacité (mode 'metered' seulement, null/null
-- sinon : l'appelant lit déjà evento_capacity_mode pour savoir quoi afficher). Même patron que
-- get_product_slots. STABLE, pas security definer : product_availability a déjà une lecture
-- publique (RPC-only en écriture, pas en lecture).
create or replace function public.get_event_occurrence_availability(p_product_id uuid, p_from date, p_to date)
returns table(occurrence_date date, capacity int, booked int)
language sql
stable
set search_path = ''
as $$
  select e.occurrence_date, pa.capacity, pa.booked
    from public.expand_event_occurrences(p_product_id, p_from, p_to) as e(occurrence_date)
    left join public.product_availability pa
      on pa.product_id = p_product_id and pa.date = e.occurrence_date
   order by e.occurrence_date;
$$;

-- get_evento_rsvp_counts — compteur affiché du mode 'rsvp' (décision actée : jamais silencieux).
-- security definer REQUIS ici (contrairement aux deux fonctions ci-dessus) : order_lines est sous
-- RLS propriétaire, un visiteur anonyme ne doit jamais lire les lignes elles-mêmes — seulement
-- l'agrégat, même raisonnement que order_for_client_jsonb. Grant explicite (pas le défaut PUBLIC
-- implicite) par discipline — supabase.md, piège des grants inversés sur une fonction security
-- definer.
create or replace function public.get_evento_rsvp_counts(p_product_id uuid, p_from date, p_to date)
returns table(occurrence_date date, registered_qty int)
language sql
stable
security definer
set search_path = ''
as $$
  select ol.date, sum(ol.qty)::int
    from public.order_lines ol
   where ol.product_id = p_product_id
     and ol.date between p_from and p_to
     and ol.status not in ('cancelled_by_client', 'cancelled_by_provider', 'expired', 'superseded')
   group by ol.date;
$$;

revoke all on function public.get_evento_rsvp_counts(uuid, date, date) from public, anon, authenticated;
grant execute on function public.get_evento_rsvp_counts(uuid, date, date) to authenticated, anon;

-- provision_evento_availability — matérialise product_availability pour un evento 'metered'.
-- Appelée par l'admin après création/édition (jamais un cron : l'ensemble d'occurrences d'un evento
-- est FINI et connu à l'avance, contrairement au calendrier glissant de lodging). Idempotent
-- (on conflict do nothing, même patron que open_default_lodging_availability).
create or replace function public.provision_evento_availability(p_product_id uuid, p_horizon interval default '12 months')
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (select public.is_admin(auth.uid())) then
    raise exception 'provision_evento_availability réservé au rôle admin' using errcode = '42501';
  end if;

  insert into public.product_availability (product_id, date, capacity, booked)
  select p.id, e.occurrence_date, p.default_capacity, 0
    from public.products p
    cross join lateral public.expand_event_occurrences(
      p.id, public.today_in_bogota(), (public.today_in_bogota() + p_horizon)::date
    ) as e(occurrence_date)
   where p.id = p_product_id
     and p.type = 'evento'
     and p.evento_capacity_mode = 'metered'
     and p.default_capacity is not null
  on conflict (product_id, date) do nothing;
end;
$$;

revoke all on function public.provision_evento_availability(uuid, interval) from public, anon, authenticated;
grant execute on function public.provision_evento_availability(uuid, interval) to authenticated;
