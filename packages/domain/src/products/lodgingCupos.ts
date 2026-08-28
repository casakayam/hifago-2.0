import { type LodgingKind } from "./lodgingKind.ts";

/**
 * Combien de « cupos » offre UNE unité physique d'un logement.
 *
 * POURQUOI ELLE EXISTE. LobbyPMS compte en UNITÉS : `available_rooms` de `/api/v2/available-rooms`
 * renvoie un nombre de chambres/tentes/lits-unités libres. hifago compte `qty` en CUPOS —
 * `order_lines.qty`, `min_qty`/`max_qty`, `price_tiers` et `product_availability.capacity` parlent
 * tous cette langue-là. Le calendrier public comparait directement les deux. Sur un dortoir de lits
 * à une place la confusion est invisible (1 unité = 1 cupo) ; dès que `capacity > 1` elle sous-vend.
 * Cas réel du 2026-08-28 : GLAMPING, `capacity=2`, `unit_count=3` — Lobby répond 3, l'écran refusait
 * toute demande de 4 cupos.
 *
 * D'OÙ VIENT LA RÈGLE, ET CE QU'ELLE N'EST PAS. Elle est REPRISE du garde-fou
 * `capacity_exceeds_physical` de `set_product_availability` (migration 20260827250000) : un dortoir
 * se vend au LIT (`unit_count × capacity`), une privée ou une maison entière à l'UNITÉ
 * (`unit_count`), et `lodging_kind` NULL suit le dortoir (borne haute, la plus permissive).
 *
 * ⚠️ Ce n'est PAS « le miroir » de ce garde-fou, contrairement à ce qu'affirmait la première version
 * de ce commentaire (corrigé le 2026-08-28 après revue). Les deux ne s'appliquent JAMAIS au même
 * produit : cette fonction ne sert que les produits PMS-backed, et c'est précisément pour eux que
 * `create_order` saute verrou et décrément de `product_availability` — le garde-fou SQL ne les voit
 * donc jamais. Il n'y a pas de cohérence à maintenir entre deux chemins qui ne se croisent pas ;
 * il y a un VOCABULAIRE commun à ne pas trahir, ce qui n'est pas la même exigence.
 *
 * CE QUI PROTÈGE VRAIMENT. Le `switch` ci-dessous est exhaustif sur `LodgingKind` : ajouter une
 * quatrième valeur casse la COMPILATION ici, et force à trancher explicitement. C'était le vrai
 * risque — la version précédente retombait par défaut sur `capacity` là où le SQL retombe sur
 * `unit_count`, deux défauts opposés qui auraient divergé en silence.
 */
export function cuposPerUnit(kind: LodgingKind | null, capacity: number | null): number {
  // `capacity` est nullable, et une valeur <= 0 ferait disparaître toute disponibilité par
  // multiplication — jamais un calendrier vide sur une donnée manquante.
  const perUnit = capacity !== null && capacity > 0 ? capacity : 1;

  // Type de couchage non renseigné : borne haute, exactement le choix du garde-fou SQL. Sans le
  // type on ignore si l'on vend des lits ou des unités, et ce n'est pas ici qu'on arbitre un
  // modèle de vente.
  if (kind === null) return perUnit;

  switch (kind) {
    case "dorm":
      return perUnit;
    case "private":
    case "whole_house":
      return 1;
    default: {
      // Inatteignable : `asLodgingKind` normalise à l'une des trois valeurs ou à null. Cette
      // branche existe pour que TypeScript refuse de compiler si LODGING_KINDS s'agrandit.
      const nonCouvert: never = kind;
      void nonCouvert;
      // Même repli que la branche `else` du garde-fou SQL, pour que les deux défauts coïncident.
      return 1;
    }
  }
}
