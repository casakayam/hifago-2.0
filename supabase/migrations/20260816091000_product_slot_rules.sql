-- Spec 11 (Admin : parcours unifié création/édition d'une activité) — module de créneaux horaires
-- récurrents (ex. jetski : créneaux de 1h, 10h-21h, lundi-samedi). Renvoyé explicitement par la
-- spec 08 §2/§10 ("future spec dédiée, nouvelle dimension de capacité") — comparé à l'app legacy
-- (règle "refaire pas réinventer") : ZÉRO précédent, même partiel (le seul niveau de granularité
-- horaire jamais implémenté côté V1 est un choix binaire matin/après-midi, products.schedule='slot',
-- src/services/migrations/008_internal_catalog_booking.sql côté racine) — terrain vierge, pas une
-- reprise.
--
-- Tranche 1 SEULEMENT : définition des règles côté admin. Aucune génération de créneaux réels,
-- aucun décrément de capacité live — ça reste une Tranche 2 future (RPC anti-survente dédiée,
-- verrouillage SELECT...FOR UPDATE par (product_id, slot_date, slot_start_time), suite de tests de
-- concurrence, hifago/CLAUDE.md §4) explicitement hors périmètre ici.
--
-- Volontairement PAS de réutilisation de products.schedule='slot' comme marqueur : ce champ porte
-- déjà une sémantique différente et documentée (créneau binaire matin/après-midi,
-- docs/01-cahier-des-charges-client.md lignes 265/489, product_calendar.closed_slot) — le
-- réutiliser aurait collisionné silencieusement deux mécanismes distincts sous la même valeur
-- d'enum. La seule présence de lignes ici suffit comme signal "cette activité utilise des
-- créneaux" (coexistence ou remplacement du champ 'slot' legacy : point ouvert, spec 11 §10).
--
-- UNE ligne = UNE règle couvrant potentiellement plusieurs jours identiques (l'exemple jetski
-- "lundi à samedi, 10h-21h" = 1 ligne, pas 6) — weekdays en smallint[], numérotation ISO 8601
-- (1=lundi..7=dimanche, compatible extract(isodow from date) pour une future génération réelle en
-- Tranche 2). Plusieurs règles par produit permises (ex. horaires différents le dimanche).
--
-- RLS directe (hifago/CLAUDE.md §3) : aucun des 4 critères RPC-only ne s'applique — capacity est un
-- paramètre de définition, pas un booked/capacity décrémenté (ça, c'est la future table Tranche 2,
-- distincte de celle-ci) ; pas de verrou optimiste multi-admin ; pas plus "audité" que
-- product_calendar aujourd'hui. Noms de colonnes choisis pour se projeter directement sur une
-- future table de capacité vivante sans renommage (start_time/slot_duration_minutes/capacity →
-- slot_start_time/capacity d'une future ligne datée).
create table product_slot_rules (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  weekdays smallint[] not null,
  start_time time not null,
  end_time time not null,
  slot_duration_minutes int not null,
  capacity int not null,
  created_at timestamptz not null default now(),
  constraint product_slot_rules_weekdays_not_empty check (array_length(weekdays, 1) > 0),
  constraint product_slot_rules_weekdays_valid check (weekdays <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[]),
  constraint product_slot_rules_time_order check (end_time > start_time),
  constraint product_slot_rules_duration_positive check (slot_duration_minutes > 0),
  constraint product_slot_rules_capacity_positive check (capacity > 0)
  -- Pas de CHECK sur la divisibilité (end_time - start_time) / slot_duration_minutes : un admin
  -- peut vouloir une plage non multiple de la durée (le reliquat est simplement ignoré côté
  -- génération/prévisualisation) — même choix que le non-chevauchement de price_tiers (spec 08) :
  -- validation app-side (apps/admin/lib/products/slotRules.ts), jamais un CHECK SQL sur une règle
  -- métier plus subtile qu'une comparaison à 2 colonnes. end_time > start_time, en revanche, EST un
  -- CHECK (comparaison simple), même calibrage que products_qty_bounds_order.
);

create index product_slot_rules_product_id_idx on product_slot_rules(product_id);

alter table product_slot_rules enable row level security;

-- Visibilité héritée du produit parent — même idiome que product_tag_assignments_select (spec 08),
-- jamais dupliquée, jamais "using(true)" (un brouillon non publié ne doit pas fuiter ses horaires).
create policy product_slot_rules_select on product_slot_rules
  for select using (exists (
    select 1 from products p where p.id = product_slot_rules.product_id
  ));

create policy product_slot_rules_write_admin on product_slot_rules
  for all using ((select is_admin(auth.uid())));

-- delete_product (20260815220000_delete_product_rpc.sql) n'a besoin d'aucune modification :
-- on delete cascade suffit, même raisonnement déjà documenté pour product_media/
-- product_tag_assignments dans cette même RPC.
