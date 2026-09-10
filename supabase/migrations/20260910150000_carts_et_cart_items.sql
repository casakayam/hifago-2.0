-- Spec 32 (panier en base), Tranche 1 — schéma : carts (attribution) et cart_items (lignes).
--
-- RLS directe (CLAUDE.md §3.2) : une identité gère ses propres données non capacitaires, rien
-- n'est verrouillé/décrémenté avant create_order (spec 32 §0 invariant 1). `account_id` référence
-- `partner_accounts(id)`, pas `auth.users(id)` directement — même convention qu'`orders`/
-- `order_lines` (`20260813194515_availability_orders_core_tables.sql`), `partner_accounts.id`
-- étant peuplée avec le même id que `auth.users` par le trigger de provisioning.

-- carts : une ligne par identité, porte l'attribution — jamais l'identité elle-même (spec 31
-- invariant 3, son §0 : « carts (spec suivante) portera attribution_code »). account_id est sa
-- propre clé primaire : une seule ligne carts par compte.
create table public.carts (
  account_id uuid primary key references public.partner_accounts(id),
  attribution_code text,
  attribution_source text,
  created_at timestamptz not null default now()
);

grant select, insert, update, delete on public.carts to authenticated;
alter table public.carts enable row level security;

create policy carts_select on public.carts
  for select
  using (account_id = (select auth.uid()));

create policy carts_insert on public.carts
  for insert
  with check (account_id = (select auth.uid()));

create policy carts_update on public.carts
  for update
  using (account_id = (select auth.uid()));

create policy carts_delete on public.carts
  for delete
  using (account_id = (select auth.uid()));

-- cart_items : les lignes. Ni price_cop (toujours products.price_cop jusqu'au checkout, décision
-- 2026-09-10) ni status (un panier n'est jamais un stock réservé, cahier §3e). Pas de contrainte
-- unique(account_id, product_id, date) : deux lignes visant le même produit et la même date
-- restent deux entrées distinctes, retirables indépendamment (CartContext.tsx:17-19, cahier A14).
create table public.cart_items (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.partner_accounts(id),
  product_id uuid not null references public.products(id),
  date date not null,
  end_date date,
  slot_start_time time,
  qty int not null,
  created_at timestamptz not null default now()
);

-- Toute lecture de cart_items filtre par account_id (policy ci-dessous, et create_order plus
-- tard) : jamais une jointure vers carts dans la policy elle-même (même raison que order_lines
-- porte son propre account_id plutôt que de passer par orders, cf. migration citée en tête).
create index cart_items_account_id_idx on public.cart_items(account_id);

grant select, insert, update, delete on public.cart_items to authenticated;
alter table public.cart_items enable row level security;

create policy cart_items_select on public.cart_items
  for select
  using (account_id = (select auth.uid()));

create policy cart_items_insert on public.cart_items
  for insert
  with check (account_id = (select auth.uid()));

create policy cart_items_update on public.cart_items
  for update
  using (account_id = (select auth.uid()));

create policy cart_items_delete on public.cart_items
  for delete
  using (account_id = (select auth.uid()));
