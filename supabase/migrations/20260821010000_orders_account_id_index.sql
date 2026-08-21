-- Feature 32 (/simplify) — index manquant constaté en revue de code, pas une feature : aucune
-- sémantique métier changée, aucune policy touchée, un index n'élargit ni ne restreint jamais un
-- accès.
--
-- orders n'a aucun index secondaire au-delà de sa clé primaire. apps/web/app/[locale]/checkout/
-- page.tsx interroge désormais "select ... from orders where account_id = $1 order by created_at
-- desc limit 1" à CHAQUE chargement de /checkout pour un client connecté (pré-remplissage) — un
-- chemin bien plus chaud que l'unique autre site filtrant déjà account_id
-- (apps/web/app/[locale]/account/orders/page.tsx, visité rarement). Composite (account_id,
-- created_at desc) plutôt qu'un index simple sur account_id seul : sert directement le filtre ET
-- le tri sans étape de sort supplémentaire.
create index if not exists orders_account_id_created_at_idx
  on orders (account_id, created_at desc);
