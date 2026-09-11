-- Spec 33 Tranche 1 — l'adresse propre à une commande (cahier client §2b.9, tranché le 2026-09-07).
--
-- Deux colonnes, et l'invariant 1 de la spec tient dans leur SÉPARATION :
--   * `reference`    — le numéro AFFICHÉ. Dictable au téléphone, lisible sur un email, jamais un
--                      secret. Séquentiel (`HFG-000042`) : sa prédictibilité n'a aucune conséquence
--                      puisqu'il ne donne accès à rien.
--   * `access_token` — le SECRET. 16 octets aléatoires (128 bits) rendus en 32 caractères hex,
--                      URL-safe sans encodage. Jamais affiché comme un numéro, jamais dicté.
--
-- Écarté : l'`order_id` en guise de secret — c'est pourtant le modèle déjà assumé par
-- `create_payment_intent` (« la possession de p_order_id, uuid à haute entropie, fait foi »,
-- 20260818200000). Écarté parce qu'il FUSIONNE l'identifiant et le secret : impossible de montrer
-- le numéro d'une réservation sans donner du même geste l'accès aux données personnelles du client.
--
-- ⚠️ `create_order` n'est PAS touchée, délibérément. La tentation était de lui faire renvoyer ces
-- deux valeurs à côté d'`order_id` : rouvrir une RPC critique (CLAUDE.md §4) pour deux champs de
-- retour n'a aucune contrepartie, puisque `orders_select` (20260813194515) autorise déjà le
-- propriétaire à lire sa propre ligne — et que depuis la spec 31 `orders.account_id` est NOT NULL
-- et porte l'identité, anonyme comprise. `CheckoutForm` lit donc `access_token` en RLS directe.
--
-- Aucune policy touchée : ces colonnes sont couvertes par `orders_select` comme toutes les autres,
-- et `orders` porte un grant SELECT au niveau TABLE (vérifié le 2026-09-10 sur la base locale,
-- `information_schema.table_privileges`) — donc pas de grant par colonne à ajouter, contrairement
-- à `establishments` dont le SELECT global est révoqué (.claude/rules/supabase.md).

create sequence public.orders_reference_seq;

-- Une séquence NEUVE hérite des `alter default privileges` du projet (20260813163456), qui
-- accordent large. Ici c'est trop : seul un chemin d'écriture d'`orders` a besoin de la consommer,
-- et les deux qui existent (`create_order`, `create_manual_order_line`) sont SECURITY DEFINER,
-- donc exécutées par le propriétaire. `service_role` garde USAGE parce qu'il a INSERT sur `orders`
-- (Route Handlers). Sens du geste : un `revoke` qui manque, jamais un `grant` — c'est le piège
-- inverse table/fonction documenté dans .claude/rules/supabase.md.
revoke all on sequence public.orders_reference_seq from public, anon, authenticated;
grant usage on sequence public.orders_reference_seq to service_role;

alter table public.orders add column reference text;
alter table public.orders add column access_token text;

-- Backfill AVANT le NOT NULL. Fait en deux temps explicites plutôt qu'en posant le défaut dès
-- l'ADD COLUMN : un défaut VOLATILE (nextval/gen_random_bytes) est bien réévalué par ligne lors de
-- la réécriture de table, mais c'est une subtilité de version qu'on ne veut pas voir porter la
-- correction d'un backfill — ici on VOIT ce qui est écrit.
with numerotees as (
  select id, row_number() over (order by created_at, id) as n
    from public.orders
)
update public.orders o
   set reference = 'HFG-' || lpad(numerotees.n::text, 6, '0')
  from numerotees
 where numerotees.id = o.id;

-- `extensions.` obligatoire : pgcrypto est installé dans le schéma `extensions`
-- (20260821020000_enable_pgcrypto_extension.sql), jamais dans `public`.
update public.orders
   set access_token = encode(extensions.gen_random_bytes(16), 'hex')
 where access_token is null;

-- La séquence reprend APRÈS les lignes déjà numérotées. is_called = false : le prochain nextval()
-- rend exactement cette valeur, jamais celle d'après.
select setval(
  'public.orders_reference_seq',
  coalesce((select count(*) from public.orders), 0) + 1,
  false
);

alter table public.orders
  alter column reference set default 'HFG-' || lpad(nextval('public.orders_reference_seq')::text, 6, '0'),
  alter column reference set not null,
  alter column access_token set default encode(extensions.gen_random_bytes(16), 'hex'),
  alter column access_token set not null;

-- Unicité des deux, et l'index d'`access_token` n'est pas cosmétique : c'est le SEUL chemin de
-- lecture de l'écran de résultat (`get_order_by_token`), appelé à chaque ouverture du lien.
create unique index orders_reference_key on public.orders (reference);
create unique index orders_access_token_key on public.orders (access_token);

comment on column public.orders.reference is
  'Numéro de réservation AFFICHÉ (HFG-000042), dictable — jamais un secret : il ne donne accès à '
  'rien. Spec 33 invariant 1.';
comment on column public.orders.access_token is
  'Secret d''accès à /reserva/<jeton> : 128 bits, sans expiration (cahier client §2b.9). Qui le '
  'détient voit le nom, le téléphone et l''email du client — tradeoff assumé par écrit. Jamais '
  'affiché comme un numéro. Spec 33 invariant 1.';
