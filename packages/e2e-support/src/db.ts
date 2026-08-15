import pg from "pg";

const { Client } = pg;

// Port Postgres direct (54322) de la même stack Supabase Docker locale que SUPABASE_URL
// (auth.ts, port 54321 — passerelle API, pas la même chose) — jamais un projet cloud partagé
// (hifago/CLAUDE.md §6.4). Exporté pour tests/concurrency/*.concurrency.mjs, qui ont besoin de la
// même connexion directe hors du wrapper withDb (barrière de synchronisation multi-clients).
export const LOCAL_DB_CONNECTION_STRING = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const CONNECTION_STRING = LOCAL_DB_CONNECTION_STRING;

export async function withDb<T>(fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: CONNECTION_STRING });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/**
 * Remet une ressource (product_id, date) à un état de disponibilité connu et purge toute
 * commande existante qui la référence — extension réutilisable de resetLastSpot() (Checkpoint B,
 * apps/web/e2e/reserve-concurrency.spec.ts) pour les 3 specs Feature 6. Une commande qui porterait encore
 * une AUTRE ligne (vers une ressource différente, non gérée par cet appel) n'est jamais supprimée
 * en entier — seule la ligne concernée l'est, la commande elle-même seulement si elle devient
 * orpheline (plus aucune ligne du tout).
 */
export async function resetAvailability(
  productId: string,
  date: string,
  { capacity, booked = 0 }: { capacity: number; booked?: number }
) {
  await withDb(async (client) => {
    const { rows } = await client.query(
      "select distinct order_id from order_lines where product_id = $1 and date = $2",
      [productId, date]
    );
    await client.query("delete from order_lines where product_id = $1 and date = $2", [
      productId,
      date,
    ]);
    const orderIds = rows.map((row) => row.order_id as string);
    if (orderIds.length > 0) {
      await client.query(
        "delete from orders where id = any($1) and id not in (select distinct order_id from order_lines)",
        [orderIds]
      );
    }
    await client.query(
      "update product_availability set capacity = $3, booked = $4 where product_id = $1 and date = $2",
      [productId, date, capacity, booked]
    );
  });
}

// Simule directement en base un événement concurrent (une autre commande qui consomme des
// places) survenu entre l'ajout au panier (purement local, cf. lib/cart/CartContext.tsx) et la
// validation du panier — la seule vraie barrière anti-survente reste create_order, jamais un
// contrôle au moment de l'ajout.
export async function setBooked(productId: string, date: string, booked: number) {
  await withDb((client) =>
    client.query(
      "update product_availability set booked = $3 where product_id = $1 and date = $2",
      [productId, date, booked]
    )
  );
}

export async function getAvailability(productId: string, date: string) {
  return withDb(async (client) => {
    const { rows } = await client.query(
      "select capacity, booked from product_availability where product_id = $1 and date = $2",
      [productId, date]
    );
    return rows[0] as { capacity: number; booked: number } | undefined;
  });
}

export async function getPrice(productId: string) {
  return withDb(async (client) => {
    const { rows } = await client.query("select price_cop from products where id = $1", [
      productId,
    ]);
    return Number(rows[0]?.price_cop);
  });
}

// Remet un code d'attribution seedé à un état actif connu avant chaque test qui en dépend —
// nécessaire car apps/admin/e2e/admin-partner-registry.spec.ts fait BASCULER volontairement l'état de
// SEED-REFACTIVE (jamais remis à zéro entre deux runs, cf. commentaire dédié dans ce spec) : sans
// ce reset, un spec qui a besoin que ce code soit actif deviendrait dépendant de l'ordre
// d'exécution des autres specs. Même raisonnement que resetAvailability ci-dessus.
export async function setPartnerCodeActive(code: string, active: boolean) {
  await withDb((client) =>
    client.query("update partner_codes set active = $2 where code = $1", [code, active])
  );
}

export async function getEstablishmentName(productId: string) {
  return withDb(async (client) => {
    const { rows } = await client.query(
      `select e.name->>'es' as name
         from public.products p
         join public.establishments e on e.id = p.establishment_id
        where p.id = $1`,
      [productId]
    );
    return rows[0]?.name as string | undefined;
  });
}

export async function countOrderLines(productId: string, date: string) {
  return withDb(async (client) => {
    const { rows } = await client.query(
      "select coalesce(sum(qty), 0)::int as qty, count(*)::int as lines from order_lines where product_id = $1 and date = $2",
      [productId, date]
    );
    return rows[0] as { qty: number; lines: number };
  });
}

export async function countOrdersByPhone(phone: string) {
  return withDb(async (client) => {
    const { rows } = await client.query(
      "select count(*)::int as count from orders where holder_phone = $1",
      [phone]
    );
    return Number(rows[0].count);
  });
}

// Feature 8 (annuler sa réservation) : confirmation en base, en plus du rechargement de page côté
// UI — preuve que la transition de statut a bien été persistée par cancel_order, pas seulement
// reflétée dans l'état client.
export async function getOrderLineStatuses(orderId: string) {
  return withDb(async (client) => {
    const { rows } = await client.query("select status from order_lines where order_id = $1", [
      orderId,
    ]);
    return rows.map((row) => row.status as string);
  });
}

export async function getOrderLinesForPhone(phone: string) {
  return withDb(async (client) => {
    const { rows } = await client.query(
      `select ol.order_id, ol.product_id, to_char(ol.date, 'YYYY-MM-DD') as date, ol.qty
         from public.order_lines ol
         join public.orders o on o.id = ol.order_id
        where o.holder_phone = $1`,
      [phone]
    );
    return rows as { order_id: string; product_id: string; date: string; qty: number }[];
  });
}
