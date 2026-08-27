-- Trois index que les chemins de lecture ouverts le 2026-08-27 réclament — trouvés par la revue
-- `/simplify` de la journée, et vérifiés dans `pg_indexes` avant d'être écrits : aucune des trois
-- colonnes n'était indexée, `product_media` et `establishment_media` n'avaient même que leur PK.
--
-- 1. order_lines (pms_booking_id) where status = 'reserved'
--
-- Le trigger `enqueue_pms_cancellations` (20260827180000) évalue, pour chaque booking du lot, la
-- garde qui évite le désastre décrit en spec 25 §2(b) :
--
--     not exists (select 1 from order_lines ol
--                  where ol.pms_booking_id = … and ol.status = 'reserved')
--
-- Sans index, c'est un balayage d'`order_lines` à chaque annulation, chaque expiration de commande
-- impayée et chaque modification de ligne. L'index existant `order_lines_pms_poll_idx` ne sert pas :
-- `pms_booking_id` n'y est qu'en PRÉDICAT partiel, jamais en clé de tête.
--
-- Le prédicat partiel reprend exactement celui de la garde — l'index ne couvre que les lignes
-- encore réservées, c'est-à-dire une fraction qui ne croît pas avec l'historique.
create index order_lines_pms_booking_reserved_idx
  on public.order_lines (pms_booking_id)
  where status = 'reserved';

-- 2 et 3. Les galeries, filtrées par leur parent puis triées par `sort`
--
-- Trois chemins publics les lisent, dont deux ouverts aujourd'hui : la page établissement
-- (T1, 20260827200000) lit `product_media` pour la vignette de chaque produit ET
-- `establishment_media` pour son carrousel ; le catalogue lit `product_media` ; la fiche produit
-- lit les deux. Toutes ces requêtes filtrent sur la clé étrangère puis `order by sort`.
--
-- `sort` en seconde position sert le tri en plus du filtre : l'index rend les deux d'un coup.
-- À noter que `room_media`, supprimée hier avec l'étage hôtel, avait le sien depuis sa création
-- (20260816130000) — ses deux sœurs ne l'ont jamais eu.
create index product_media_product_id_sort_idx on public.product_media (product_id, sort);
create index establishment_media_establishment_id_sort_idx on public.establishment_media (establishment_id, sort);
