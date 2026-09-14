// Correctif — bug PRÉ-EXISTANT trouvé en vérifiant la spec 21 (connecteur LobbyPMS), SANS LIEN
// avec elle : confirmé présent dans le dernier commit (bb254e9, avant toute modification de cette
// session) via `git show HEAD:apps/admin/app/admin/products/[id]/edit/page.tsx`. Jamais corrigé en
// silence (hifago/CLAUDE.md, avant-la-spec.md §7) — signalé explicitement dans le rapport de fin de
// session.
//
// Root cause : productTypeGating/ProductType vivaient dans useProductTypeFieldsState.ts, qui porte
// "use client" (nécessaire pour son hook React). app/admin/products/[id]/edit/page.tsx (Server
// Component) importait productTypeGating depuis ce fichier — Next.js App Router traite TOUT export
// d'un module "use client" comme une référence client sérialisée, même une fonction pure sans
// aucun hook : « Attempted to call productTypeGating() from the server but productTypeGating is on
// the client » (erreur 500 constatée en faisant tourner admin-product-lodging.spec.ts et
// admin-product-create.spec.ts). Correctif : extraire la logique de gating, purement synchrone et
// sans state, dans CE fichier SANS "use client" — utilisable aussi bien depuis un Server Component
// que depuis un Client Component. useProductTypeFieldsState.ts réexporte ce module pour ne casser
// aucun import existant côté client.
// T3 (spec 24 §4) — `hotel` retiré le 2026-08-27. Cet étage dupliquait l'établissement au niveau
// produit : il n'existe ni chez LobbyPMS (propriété → catégories, sans intermédiaire) ni dans la
// v1, et il rendait un hôtel structurellement inconnectable à un PMS (isPmsBacked = lodging +
// lobby_category_id). Une chambre est désormais un `lodging` portant son `lodging_kind`, et
// c'est l'établissement qui porte le lieu. La création était fermée depuis le 2026-08-26 ; la
// préprod ne comptait aucun hôtel, aucun type de chambre, aucune commande — code mort, pas une
// migration de données.
export type ProductType = "activity" | "evento" | "camp" | "lodging" | "transport";

// Gating par type — miroir exact de ProductForm (spec 11/12/13/14), la SEULE définition de ces 3
// booléens dans tout le projet : ProductForm, ProductTypeFields et
// ModerateProductCreationProposalForm l'importent tous d'ici plutôt que de la recalculer chacun de
// leur côté (risque de divergence déjà rencontré à chaque évolution de gating, specs 11→14).
export function productTypeGating(type: ProductType) {
  const isEvento = type === "evento";
  const isCamp = type === "camp";
  const isActivity = type === "activity";
  const isLodging = type === "lodging";
  const isTransport = type === "transport";
  return {
    isEvento,
    isCamp,
    isActivity,
    isLodging,
    isTransport,
    hasLocationAndTags: isActivity || isLodging || isTransport,
    // Retour Jérôme (2026-08-18) : un camp a aussi des "servicios incluidos" (desayuno, transporte,
    // guía…) qui doivent être des tags comme pour les autres types, pour pouvoir un jour trier/
    // filtrer dessus — camp n'a en revanche pas besoin d'adresse propre (déjà celle de son
    // établissement), d'où un booléen SÉPARÉ de hasLocationAndTags plutôt qu'un ajout à ce dernier
    // (qui aurait aussi fait apparaître les champs adresse/lat/lon, jamais demandés pour camp).
    // `evento` rejoint hasTags le 2026-09-14 (chantier "catégories partout" — Jérôme : "tout doit
    // pouvoir en avoir") — même raisonnement que camp, pas d'adresse propre non plus, donc toujours
    // absent de hasLocationAndTags.
    hasTags: isActivity || isLodging || isTransport || isCamp || isEvento,
    hasPriceQtyFields: isActivity || isLodging || isTransport,
    hasCheckInOut: isLodging,
    // Types qui matérialisent product_availability — seuls ceux-là peuvent porter un cupo par
    // défaut. evento : pas encore réellement réservable côté client, toujours hors périmètre.
    // lodging : INCLUS depuis le 2026-09-13 (migration 20260913100000_lodging_default_
    // availability.sql, décision Jérôme) — le calendrier d'une chambre est désormais ouvert par
    // défaut (fenêtre glissante de 6 mois matérialisée à la création + cron quotidien), le
    // partenaire ferme seulement les jours déjà pris. Si ce champ reste vide, la RPC calcule
    // elle-même la valeur (resolve_lodging_default_capacity) — le champ n'est PAS pré-rempli côté
    // formulaire (pas fait, resterait à ajouter si on veut que le partenaire voie/ajuste la valeur
    // avant de valider plutôt que de la découvrir après coup).
    hasDefaultCapacity: isActivity || isCamp || isTransport || isLodging,
    // Remise par seuil de remplissage cumulé (migration 20260914130000, demande Jérôme du
    // 2026-09-14) — camp UNIQUEMENT, imposé aussi côté base (products_group_discount_camp_only) :
    // seul ce type a aujourd'hui un remplissage cumulé fiable par départ (product_availability).
    // Étendre à activité/transport/evento serait un chantier distinct, pas une omission ici.
    hasGroupDiscount: isCamp,
  };
}

// Quel(s) écran(s) de cupos/disponibilité afficher pour un produit, à partir de son type et de la
// présence d'au moins une règle de créneaux (product_slot_rules) — SEULE définition de ce gating
// dans tout le projet (avant cette extraction, dupliqué ad hoc entre
// apps/admin/app/admin/products/[id]/edit/page.tsx — showAvailabilityLink/isHotel/isActivity &&
// slotRulesRaw.length > 0 — et apps/admin/app/partner/(app)/products/ProductsGrid.tsx, qui se
// contentait de commenter "même gating de type que .../edit/page.tsx" sans jamais rien importer).
// 'slot' N'EXCLUT PAS 'generic' : une activité qui porte des règles de créneaux garde son lien
// générique product_availability (cupo/estado par jour) EN PLUS du lien horaires×dates dédié — les
// deux calendriers sont indépendants, jamais l'un à la place de l'autre. Les appelants traitent
// donc 'slot' comme "afficher le lien générique ET le lien créneaux", pas comme un remplacement
// (cf. leur propre commentaire au point d'appel).
export function availabilityScreenFor(
  type: ProductType,
  hasSlotRules: boolean,
  isPmsBacked: boolean,
): "generic" | "slot" | "none" | "pms" {
  // Ajouté le 2026-08-26. Un logement PMS-backed (lodging + lobby_category_id) ne décrémente
  // JAMAIS product_availability : create_order saute explicitement verrou et décrément pour lui,
  // Lobby étant seule source de vérité de la capacité (20260819130000_create_order_pms_backed.sql).
  // Sa table de cupos est donc structurellement vide, et le lien « Calendario & cupos » ouvrait un
  // calendrier inerte — un écran qui laisse croire qu'on peut y ouvrir ou fermer des dates alors
  // que rien de ce qu'on y ferait ne serait lu. 'pms' n'est pas 'none' : l'appelant doit dire
  // POURQUOI il n'y a pas de calendrier, pas se contenter de ne rien afficher.
  //
  // Le paramètre est volontairement REQUIS, pas optionnel avec un défaut : cette fonction est la
  // seule définition de ce gating et elle a deux appelants (admin et socio). Un défaut aurait
  // laissé le portail socio compiler en gardant l'ancien comportement, sans que rien ne le signale.
  if (isPmsBacked) return "pms";
  if (type === "evento") return "none";
  if (type === "activity" && hasSlotRules) return "slot";
  return "generic";
}
