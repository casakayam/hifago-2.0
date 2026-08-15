-- Tranche 3 (disponibilité + anti-survente) — product_availability, orders, order_lines.
--
-- Table DÉDIÉE pour la capacité (pas une extension de product_calendar) : product_calendar reste
-- RLS directe/admin (Tranche 2, open/closed_slot) — mélanger un compteur RPC-only et des colonnes
-- éditables en direct sur la même table casserait la garantie RPC-only, la RLS s'applique par
-- ligne entière, pas par colonne. product_availability porte SEULEMENT la capacité/le réservé.
--
-- RPC-only (cf. hifago/CLAUDE.md §3) sur les 3 tables :
--   - product_availability : cas d'école du compteur de capacité/disponibilité.
--   - orders/order_lines : écriture à auditer nominativement — ET condition de l'invariant
--     anti-survente lui-même : si un compte pouvait insérer directement une order_line, il
--     contournerait entièrement le verrouillage FOR UPDATE de la RPC. Aucune policy d'écriture
--     directe ne doit jamais exister sur ces tables.
create table product_availability (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id),
  date date not null,
  capacity int not null,
  booked int not null default 0,
  unique (product_id, date)
);

alter table product_availability enable row level security;
revoke insert, update, delete on product_availability from authenticated, anon;

-- Lecture des cupos restants : RLS directe publique (cf. plan Tranche 3).
create policy product_availability_select_public on product_availability
  for select
  using (true);

create table orders (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references partner_accounts(id),
  holder_name text not null,
  holder_email text,
  holder_phone text,
  status text not null default 'confirmed',
  created_at timestamptz not null default now()
);

alter table orders enable row level security;
revoke insert, update, delete on orders from authenticated, anon;

create policy orders_select on orders
  for select
  using (
    (select is_admin(auth.uid()))
    or account_id = (select auth.uid())
  );

create table order_lines (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id),
  -- account_id dupliqué depuis orders (pas une jointure dans la policy) : évite qu'une lecture de
  -- order_lines déclenche en cascade l'évaluation de la policy RLS d'orders, cf. checklist §2.
  account_id uuid references partner_accounts(id),
  product_id uuid not null references products(id),
  date date not null,
  qty int not null,
  status text not null default 'confirmed',
  created_at timestamptz not null default now()
);

alter table order_lines enable row level security;
revoke insert, update, delete on order_lines from authenticated, anon;

create policy order_lines_select on order_lines
  for select
  using (
    (select is_admin(auth.uid()))
    or account_id = (select auth.uid())
  );
