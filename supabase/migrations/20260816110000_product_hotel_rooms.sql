-- Spec 13 — active products.type='hotel' : un hôtel a plusieurs sous-produits qui sont des
-- chambres, chacune avec son propre prix (même mécanisme que l'alojamiento, spec 12) et sa propre
-- capacité. Aucun précédent V1 non-PMS (terrain vierge, cf. docs/specs/13-admin-hotel-habitaciones.md
-- §1) — le seul mécanisme V1 pour un hôtel à chambres passe entièrement par LobbyPMS.
--
-- Pas de colonne self-référentielle sur products (pattern absent de tout le schéma, vérifié) :
-- une chambre est une ligne d'une nouvelle table enfant, même patron que product_slot_rules
-- (spec 11) — product_id references products(id) on delete cascade, RLS lecture héritée du
-- produit parent, écriture admin.
alter table products
  drop constraint products_type_check,
  add constraint products_type_check
    check (type in ('lodging', 'activity', 'transport', 'tour', 'camp', 'evento', 'hotel')),
  drop constraint products_price_cop_required_unless_evento,
  add constraint products_price_cop_required_unless_evento
    check (type in ('evento', 'hotel') or price_cop is not null);
-- 'hotel' exempté comme 'evento' : le prix vit sur les chambres, pas sur le produit hôtel lui-même.

create table product_room_types (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  kind text not null check (kind in ('dorm', 'private')),
  name jsonb not null,
  description jsonb,
  capacity int not null check (capacity > 0),
  quantity int check (quantity is null or quantity > 0),
  price_cop int not null check (price_cop > 0),
  price_tiers jsonb,
  min_qty int,
  max_qty int,
  sort int not null default 0,
  -- Dormantes, non exposées à l'écran dans cette tranche — miroir exact de products.lobby_category_id/
  -- lobby_product_id : anticipe le rattachement LobbyPMS d'une chambre (category_id de GET /rooms)
  -- pour une Tranche 2, sans redesign de table. Aucun appel réseau construit par cette migration.
  lobby_category_id int,
  lobby_product_id int,
  created_at timestamptz not null default now()
);
create index product_room_types_product_id_idx on product_room_types(product_id);
alter table product_room_types enable row level security;
create policy product_room_types_select on product_room_types
  for select using (exists (select 1 from products p where p.id = product_room_types.product_id));
create policy product_room_types_write_admin on product_room_types
  for all using ((select is_admin(auth.uid())));
