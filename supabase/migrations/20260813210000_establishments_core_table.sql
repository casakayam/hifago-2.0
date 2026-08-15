-- Prérequis du correctif Tranche 1 (granularité par établissement de la capacité operator) —
-- posé maintenant uniquement pour que partner_capabilities.establishment_id puisse référencer
-- cette table (dépendance d'ordre explicite du plan). Ne contient QUE la fiche minimale + RLS
-- décrites par la feature 1 (Admin : créer un établissement) — ni la RPC create_establishment
-- (qui rattache une capacité operator en attente), ni l'écran admin, ni de seed de démonstration :
-- ce correctif ne construit pas la feature 1 par anticipation, seulement sa table.
create table establishments (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references partners(id),
  name jsonb not null,  -- multilingue, même pattern que products.name
  status text not null default 'active' check (status in ('active', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- RLS directe (aucun des 4 critères RPC-only — pas de capacité, pas d'audit nominatif, pas de
-- verrou). Lecture : admin ou compte du partenaire propriétaire — pas de lecture publique ici,
-- aucun écran public ne consomme establishments pour l'instant.
-- Pas de GRANT explicite : établie après le ALTER DEFAULT PRIVILEGES de
-- 20260813163456_identity_rls.sql, qui couvre déjà automatiquement toute table future.
alter table establishments enable row level security;

create policy establishments_select on establishments
  for select
  using ((select is_admin(auth.uid())) or partner_id = (select partner_id_for_account(auth.uid())));

create policy establishments_write_admin on establishments
  for all
  using ((select is_admin(auth.uid())));
