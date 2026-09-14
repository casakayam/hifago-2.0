-- Garde-fou oublié dans 20260913100000_lodging_default_availability.sql : un logement rattaché à
-- LobbyPMS (`products.lobby_category_id` non nul) a sa disponibilité gérée PAR Lobby, jamais par
-- `product_availability` — cf. le test existant "la note dit ce que l'écran fait vraiment — Lobby
-- gère la disponibilité, pas les champs" (apps/admin/components/product-type-fields.test.tsx) et
-- `isPmsBacked` côté vitrine (LodgingReservationForm.tsx). Sans ce garde-fou,
-- open_default_lodging_availability aurait matérialisé des nuits "ouvertes" totalement
-- déconnectées de la vraie disponibilité Lobby — un risque de survente, pas juste une donnée
-- inutile. Jamais éditer une migration déjà appliquée (règle du projet) : correctif en suivi,
-- signature strictement inchangée.
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
    cross join generate_series(current_date, current_date + p_horizon, interval '1 day') as d
   where p.id = p_product_id
     and p.default_capacity is not null
     and p.lobby_category_id is null
  on conflict (product_id, date) do nothing;
end;
$$;
