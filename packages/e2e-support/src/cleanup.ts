import { withDb } from "./db";

// NETTOYAGE DE FIN DE SUITE E2E (2026-09-08, demandé par Jérôme : « les tests devraient delete à
// la fin des tests »).
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// LE PROBLÈME, MESURÉ ET PAS SUPPOSÉ
// ─────────────────────────────────────────────────────────────────────────────────────────────
// Les specs e2e créent de vrais produits, établissements, partenaires et catégories, et ne les
// suppriment pas. Constaté le 2026-09-08 sur la base locale : **78 produits résiduels contre 7 au
// seed**. Ce n'est pas seulement du désordre — ça FAIT ÉCHOUER DES TESTS, de deux façons :
//
//   • l'accueil et les listings plafonnent chaque section à 8 offres, dans l'ordre `created_at
//     desc` : les résidus, toujours plus récents que le seed, poussent les offres seedées HORS de
//     l'écran. `home.spec.ts` (« carte groupée ») et `reserve.spec.ts` échouaient exactement
//     ainsi, sur des sélecteurs pourtant justes ;
//   • et les deux suites interfèrent : lancer les e2e ADMIN casse ensuite les e2e WEB, ce qui rend
//     un échec impossible à attribuer.
//
// Six fichiers pgTAP souffrent déjà du même mal (`docs/backlog.md`), pour la même raison.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// CE QUE CE MODULE NETTOIE, ET COMMENT IL RECONNAÎT SES CIBLES
// ─────────────────────────────────────────────────────────────────────────────────────────────
// ⚠️ **Par l'HORODATAGE, jamais par une liste de noms.** Les specs fabriquent leurs identifiants
// avec `Date.now()` — `actividad-e2e-1788897738585`, `tags-filter-1788897750352`,
// `casa-guatape-es-1788897564057`. Un slug portant treize chiffres commençant par 1 est donc une
// donnée de test, et les sept slugs du seed sont fixes et n'en portent aucun. Une liste de
// préfixes, elle, serait périmée au prochain spec écrit — et personne ne s'en apercevrait.
//
// ⚠️ **Il ne touche JAMAIS aux données du seed.** C'est la propriété qui rend ce nettoyage sûr à
// lancer après chaque suite : `npm run db:setup` reste nécessaire pour repartir de zéro, ce module
// ne fait que rendre à la base l'état où la suite l'a trouvée.

/** Un identifiant fabriqué par `Date.now()` : treize chiffres commençant par 1. */
const MOTIF_HORODATAGE = "1[0-9]{12}";

/**
 * Supprime les entités créées par les specs e2e, dans l'ordre qu'imposent les clés étrangères.
 *
 * ⚠️ L'ORDRE N'EST PAS NÉGOCIABLE et vient de `pg_constraint`, pas d'une intuition : quatre tables
 * référencent `products` en `NO ACTION` et bloquent donc la suppression — `order_lines`,
 * `product_availability`, `product_calendar`, `product_proposals`. Les cinq autres
 * (`product_media`, `product_tag_assignments`, `product_date_rates`, `product_slot_rules`,
 * `product_slot_availability`) sont en CASCADE et partent d'elles-mêmes. Avant d'ajouter une table
 * liée ici, la vérifier de la même façon — c'est la règle de `.claude/rules/tests.md`.
 */
export async function purgerDonneesDeTest(): Promise<{
  produits: number;
  establecimientos: number;
  categorias: number;
}> {
  return withDb(async (client) => {
    const { rows: cibles } = await client.query<{ id: string }>(
      `select id from products where slug ~ $1`,
      [MOTIF_HORODATAGE]
    );
    const idsProduits = cibles.map((r) => r.id);

    if (idsProduits.length > 0) {
      // 1. Les commandes qui touchent ces produits. On supprime la LIGNE d'abord, puis la commande
      //    seulement si elle devient orpheline — même prudence que `purgePaymentsThenOrders` :
      //    une commande portant aussi une ligne vers un produit du seed ne doit pas disparaître.
      const { rows: lignes } = await client.query<{ id: string; order_id: string }>(
        `select id, order_id from order_lines where product_id = any($1)`,
        [idsProduits]
      );
      const idsLignes = lignes.map((r) => r.id);
      const idsCommandes = [...new Set(lignes.map((r) => r.order_id))];

      if (idsLignes.length > 0) {
        // ⚠️ CE QUI POINTE VERS LA **LIGNE** D'ABORD. Vérifié dans `pg_constraint` le 2026-09-08 —
        // après un premier essai qui a échoué exactement là : `ledger_entries.order_line_id` est en
        // NO ACTION, donc supprimer `order_lines` en premier lève
        // « violates foreign key constraint ledger_entries_order_line_id_fkey ». Les trois tables
        // ci-dessous référencent la LIGNE, pas la commande, et c'est une distinction qui ne se
        // devine pas depuis le nom.
        for (const table of ["ledger_entries", "pms_reconciliation_entries", "availability_blocks"]) {
          await client
            .query(`delete from ${table} where order_line_id = any($1)`, [idsLignes])
            .catch(() => {
              // Une table ou une colonne absente de ce schéma n'est pas une erreur : ce module doit
              // survivre à une base plus ancienne ou plus récente sans faire échouer une suite déjà
              // terminée.
            });
        }

        // ⚠️ `order_lines` s'auto-référence (NO ACTION). Un DELETE unique fonctionne quand même :
        // une contrainte NO ACTION est vérifiée en FIN d'instruction, donc les lignes qui se
        // pointent entre elles partent ensemble. Les supprimer une par une échouerait.
        await client.query(`delete from order_lines where product_id = any($1)`, [idsProduits]);
      }

      if (idsCommandes.length > 0) {
        await client
          .query(`delete from payments where order_id = any($1)`, [idsCommandes])
          .catch(() => {});

        // Seulement les commandes devenues ORPHELINES : une commande portant encore une ligne vers
        // un produit du seed n'a rien à faire ici.
        await client.query(
          `delete from orders where id = any($1)
             and id not in (select distinct order_id from order_lines)`,
          [idsCommandes]
        );
      }

      // 2. Les quatre tables en NO ACTION qui bloquent la suppression du produit.
      for (const table of ["product_availability", "product_calendar", "product_proposals"]) {
        await client.query(`delete from ${table} where product_id = any($1)`, [idsProduits]);
      }

      // 3. Les produits eux-mêmes ; le reste part en CASCADE.
      await client.query(`delete from products where id = any($1)`, [idsProduits]);
    }

    // 4. Les établissements de test, une fois leurs produits partis.
    //
    // ⚠️ NEUF TABLES les référencent, dont HUIT en NO ACTION — seule `establishment_media` est en
    // CASCADE (vérifié dans `pg_constraint` le 2026-09-08, après un échec sur
    // `partner_capabilities_establishment_id_fkey`). Celles qui bloquent réellement en pratique
    // sont listées ci-dessous ; les autres ont déjà été vidées par la purge des produits et des
    // commandes. Une table liée ajoutée plus tard devra être vérifiée de la même façon, pas
    // devinée.
    const { rows: etabs } = await client.query<{ id: string }>(
      `select id from establishments where slug ~ $1
         and id not in (select distinct establishment_id from products where establishment_id is not null)`,
      [MOTIF_HORODATAGE]
    );
    const idsEtabs = etabs.map((r) => r.id);

    let est = { rowCount: 0 } as { rowCount: number | null };
    if (idsEtabs.length > 0) {
      for (const table of [
        // Une capacité partenaire SCOPÉE à un établissement de test n'a plus d'objet une fois
        // celui-ci parti — c'est cette table qui bloquait.
        "partner_capabilities",
        "establishment_payout_accounts",
        "establishment_proposals",
        "product_proposals",
        "provider_resource_calendar",
        "pms_cancellation_queue",
      ]) {
        await client
          .query(`delete from ${table} where establishment_id = any($1)`, [idsEtabs])
          .catch(() => {
            // Table ou colonne absente de ce schéma : ce module doit survivre à une base plus
            // ancienne ou plus récente sans faire échouer une suite déjà terminée.
          });
      }
      est = await client.query(`delete from establishments where id = any($1)`, [idsEtabs]);
    }

    // 5. Les catégories de test (`tags-filter-…`, `tags-delete-…`). Les assignations sont en
    //    CASCADE des deux côtés.
    const cat = await client.query(`delete from catalog_tags where slug ~ $1`, [MOTIF_HORODATAGE]);

    return {
      produits: idsProduits.length,
      establecimientos: est.rowCount ?? 0,
      categorias: cat.rowCount ?? 0,
    };
  });
}

/**
 * `globalTeardown` Playwright — à brancher dans les deux `playwright.config.ts`.
 *
 * ⚠️ **Un teardown GLOBAL et pas un `afterAll` par spec**, et c'est un choix : un nettoyage réparti
 * dans vingt fichiers s'oublie au vingt-et-unième, et personne ne le remarque avant que la base
 * ait de nouveau dix fois plus de résidus que de seed. Ici, un spec neuf est couvert sans que son
 * auteur ait à y penser.
 *
 * ⚠️ CE QU'IL NE RÉSOUT PAS : l'interférence PENDANT une même exécution. Deux tests parallèles qui
 * remplissent la même section de 8 offres se gênent encore — `cart-multi-establishment` passe seul
 * et échoue en suite, pour cette raison. La correction de ce cas-là est de scoper les données par
 * test, pas de nettoyer à la fin ; c'est un lot à part, nommé au backlog.
 *
 * Il n'échoue JAMAIS la suite : un nettoyage raté est un problème d'hygiène, pas un résultat de
 * test. Il le dit sur la sortie standard et rend la main.
 */
export default async function globalTeardown() {
  try {
    const bilan = await purgerDonneesDeTest();
    const total = bilan.produits + bilan.establecimientos + bilan.categorias;
    if (total > 0) {
      console.log(
        `[e2e cleanup] purgé : ${bilan.produits} produit(s), ` +
          `${bilan.establecimientos} établissement(s), ${bilan.categorias} catégorie(s).`
      );
    }
  } catch (erreur) {
    console.warn(
      "[e2e cleanup] nettoyage de fin de suite impossible — la base locale garde ses résidus :",
      erreur
    );
  }
}
