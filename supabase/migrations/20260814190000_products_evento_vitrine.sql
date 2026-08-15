-- Feature 21 — Admin : créer une fiche evento (vitrine, non réservable).
--
-- Portée tranchée par Jérôme (2026-08-13) : le cahier des charges décrit deux modes pour un
-- evento — vitrine (éditorial, prix en texte libre, aucun cupo, lien de réservation externe) et
-- réservable (prix/cupos réels, consomme la ressource partagée de la feature 20 comme un camp).
-- Cette migration construit LA VITRINE SEULE — aucune RPC, aucune écriture RPC-only : un evento
-- vitrine n'entre jamais dans create_order (rien à réserver), reste RLS-directe admin comme
-- n'importe quel autre produit — products_write_admin (Tranche 2) couvre déjà l'écriture,
-- set_product_sellable (feature 4) couvre déjà publier/dépublier, réutilisés tels quels.
--
-- Granularité de récurrence tranchée par Jérôme : structurée (occurrence_type + fréquence +
-- condition de fin), jamais du texte libre — même pour la vitrine, en anticipation du futur mode
-- réservable qui en aura besoin pour de vrai.
alter table products
  alter column price_cop drop not null,   -- un evento vitrine n'a pas de prix réel à charger
  add constraint products_price_cop_required_unless_evento
    check (type = 'evento' or price_cop is not null),
  drop constraint products_type_check,
  add constraint products_type_check
    check (type in ('lodging', 'activity', 'transport', 'tour', 'camp', 'evento')),
  add column occurrence_type text check (occurrence_type is null or occurrence_type in ('once', 'recurring')),
  add column occurrence_date date,               -- occurrence_type = 'once'
  add column recurrence_frequency_days int,       -- occurrence_type = 'recurring'
  add column recurrence_end_date date,            -- une des 3 conditions de fin...
  add column recurrence_end_count int,            -- ...ou celle-ci...
  -- (aucune des deux = indéfini, la 3e condition de fin du cahier des charges admin §3c)
  add constraint products_recurrence_end_shape
    check (recurrence_end_date is null or recurrence_end_count is null),
  add column start_time time,                     -- « une heure de début et une longueur »
  add column duration_minutes int,
  add column price_label text,                    -- prix textuel libre (admin §3c)
  add column external_booking_url text;           -- générique, plus jamais figé WhatsApp seul

-- establishment_id not null s'applique déjà (point ouvert tranché en feature 1 : tout produit,
-- quel que soit son type, est rattaché à un établissement) — rien de plus à décider ici.
