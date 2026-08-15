-- Tranche 2 (catalogue) — products, product_calendar. Repris du schéma legacy SQLite
-- (src/services/migrations/001_init.sql, 008/011/012) porté en Postgres : nom/description
-- passent en JSONB par langue (contenu multilingue, cf. hifago/CLAUDE.md §5), le reste garde les
-- mêmes champs. Volontairement PAS de colonne de capacité ici : la disponibilité/anti-survente
-- (product_calendar.capacity ou table dédiée, RPC-only) arrive en Tranche 3, jamais en RLS
-- directe. cancel_free_days/noshow_reversal_pct ne sont PAS repris : la politique d'annulation
-- est devenue une règle fixe et universelle (cf. hifago/docs/00-modele-de-donnees.md §1, décision
-- du 2026-08-12), plus un champ par produit.

create table products (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references partners(id),
  type text not null check (type in ('lodging', 'activity', 'transport', 'tour')),
  name jsonb not null,
  description jsonb,
  price_cop bigint not null,
  unit text check (unit in ('per_person', 'per_two')),
  max_units int,
  acompte_pct numeric(5, 4) not null default 0.15,
  referral_pct numeric(5, 4) not null default 0.10,
  schedule text not null default 'date' check (schedule in ('slot', 'date', 'none')),
  qty_unit text not null default 'qty' check (qty_unit in ('qty', 'hours')),
  calendar_default_open boolean not null default true,
  category text check (
    category is null or category in ('musica', 'arte', 'bienestar', 'nautica', 'adrenalina', 'gastronomia')
  ),
  stay_rates jsonb,
  lobby_product_id int,
  lobby_category_id int,
  sellable boolean not null default true,
  sort int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index products_partner_id_idx on products(partner_id);
create index products_sellable_idx on products(sellable) where sellable = true;

create table product_calendar (
  product_id uuid not null references products(id),
  date date not null,
  open boolean not null default true,
  closed_slot text check (closed_slot in ('am', 'pm')),
  primary key (product_id, date)
);

-- RLS directe (aucun des 4 critères RPC-only, cf. hifago/CLAUDE.md §3 — pas de compteur de
-- capacité tant que la Tranche 3 ne l'a pas ajouté). Lecture publique des produits vendables
-- (« publiés » = sellable=true), écriture admin uniquement en direct.
-- Pas de GRANT explicite ici : products/product_calendar sont créées après le
-- ALTER DEFAULT PRIVILEGES de 20260813163456_identity_rls.sql, qui couvre déjà automatiquement
-- toute table future (vérifié empiriquement) — un GRANT par table ici serait redondant et
-- réintroduirait exactement l'étape manuelle que ce correctif visait à éliminer.
alter table products enable row level security;

create policy products_select_public on products
  for select
  using (sellable = true or (select is_admin(auth.uid())));

-- Pas de with check explicite : Postgres réutilise la clause using comme with check par défaut
-- pour une policy "for all" quand elles sont identiques.
create policy products_write_admin on products
  for all
  using ((select is_admin(auth.uid())));

-- product_calendar : données peu sensibles (juste ouvert/fermé), lecture publique simple ;
-- écriture admin uniquement en direct (pas de capacité ici, donc pas RPC-only à ce stade).
alter table product_calendar enable row level security;

create policy product_calendar_select_public on product_calendar
  for select
  using (true);

create policy product_calendar_write_admin on product_calendar
  for all
  using ((select is_admin(auth.uid())));
