-- `open_default_lodging_availability` (20260913100000, corrigée en suivi par 20260913100100 pour
-- le garde PMS) utilisait `current_date` nu — la date du fuseau de la SESSION (UTC sur Supabase),
-- pas celle de Guatapé (`public.today_in_bogota()`, migration 20260828150000). Rouge dans
-- `scripts/check-timezone.sh` depuis le 2026-09-13, jamais corrigé jusqu'ici (dette assumée,
-- `docs/dette-technique.md`). Le défaut concret : entre minuit et 5h UTC (19h-00h à Guatapé),
-- la fenêtre glissante matérialisée à la création d'un logement — ou à chaque passage du cron
-- `roll-lodging-availability` — démarre un jour trop tôt, ouvrant une nuit déjà passée à Guatapé.
--
-- Jamais éditer une migration déjà appliquée (règle du projet) : correctif en suivi, comme
-- 20260913100100 l'a déjà fait une fois pour la même fonction. Signature strictement inchangée,
-- seul `current_date` → `public.today_in_bogota()` change ; le garde PMS (`lobby_category_id is
-- null`) posé par 20260913100100 est conservé à l'identique.
create or replace function public.open_default_lodging_availability(
  p_product_id uuid,
  p_horizon interval default '6 months'
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.product_availability (product_id, date, capacity, booked)
  select p.id, d::date, p.default_capacity, 0
    from public.products p
    cross join generate_series(
      public.today_in_bogota(), public.today_in_bogota() + p_horizon, interval '1 day'
    ) as d
   where p.id = p_product_id
     and p.default_capacity is not null
     and p.lobby_category_id is null
  on conflict (product_id, date) do nothing;
end;
$$;

revoke all on function public.open_default_lodging_availability(uuid, interval) from public, anon, authenticated;
