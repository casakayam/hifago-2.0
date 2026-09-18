---
id: specs-programme-camp
titre: "Programme jour par jour d'un camp"
theme: specs
public: [ia, dev, jerome]
langue: fr
statut: implemente
maj: 2026-09-16
revise: ["docs/00-modele-de-donnees.md#4a"]
resume: >
  Un camp porte un déroulé jour par jour, saisi dans le formulaire produit (admin ET socio via
  proposition/modération) dès la création, et affiché sur la fiche vitrine sous « El plan, día a
  día » avec les dates réelles du départ choisi. Stocké en colonne `products.program` (jsonb), une
  liste PLATE `[{day, text:{es,en}}]` où plusieurs entrées partagent normalement le même jour. Le
  jour est RELATIF au départ, donc un seul programme vaut pour toutes les éditions du camp.
mots_cles: [camp, programme, program, día a día, itinéraire, jsonb, multilingue, proposition, parité]
repond_a:
  - "Comment un camp décrit-il le déroulé de ses journées ?"
  - "Pourquoi le programme est-il une colonne de products et non une table fille ?"
  - "Pourquoi un jour relatif (día 1..n) plutôt qu'une date calendaire ?"
  - "Qu'est-ce que le littéral JSON null, et pourquoi menace-t-il toute création de camp ?"
---

# Programme jour par jour d'un camp

> **Cible stack** : hifago, `supabase/` + `apps/admin` + `apps/web`. Demande de Jérôme le
> 2026-09-16 : « camp doit pouvoir dans l'admin ajouter un programme, une liste de choses (input
> text) reliée à une date ». Cadrée par trois tours d'`AskUserQuestion` avant tout code, plus deux
> précisions données à la revue du plan (§3).
>
> **✅ LIVRÉE le 2026-09-16** — 2 migrations, éditeur admin, parité socio, bloc vitrine, 34 tests
> (20 unitaires + 8 composant admin + 6 composant vitrine + 6 vitrine données + 4 date) et 14 pgTAP.
> Vérifiée en réel : rendu `/es` et `/en` de `retiro-de-yoga-y-silencio` servi par le serveur,
> écriture admin authentifiée via PostgREST, application de `mockData/`.

## Sommaire et statut

| # | Section | Statut |
|---|---|---|
| 0 | **Contrat compact** | ✅ livré 2026-09-16 |
| 1 | Contexte et problème | ✅ 2026-09-16 |
| 2 | Portée | ✅ 2026-09-16 |
| 3 | Décisions retenues (entretien) | ✅ 2026-09-16 |
| 4 | Parcours cible | ✅ 2026-09-16 |
| 5 | Écran(s) | ✅ 2026-09-16 |
| 6-9 | Modèle / RPC / invariants / cas limites (fusionnées dans 0) | ✅ 2026-09-16 |
| 10 | Décisions tranchées / points ouverts | ✅ 2026-09-16 |
| 11 | Annexe — traçabilité | ✅ 2026-09-16 |
| 12 | Documents liés | ✅ 2026-09-16 |

---

## 0. Contrat compact (pour coder — lire seul, sans le reste)

### Modèle de données (delta)

| Table | Colonne | Type | Note |
|---|---|---|---|
| `products` | `program` | `jsonb`, nullable | liste PLATE `[{day:int, text:{es,en?}}]`, camp uniquement |

CHECK : `products_program_camp_only` (`type <> 'camp' ⇒ program is null`, miroir exact de
`products_group_discount_camp_only`) et `products_program_is_array`
(`program is null or jsonb_typeof(program) = 'array'`).
Écriture **RLS directe** (`products_write_admin`) — aucun des 4 critères RPC-only de `CLAUDE.md`
§3.1 : ni compteur de capacité, ni audit nominatif, ni lecture cross-identité, ni verrou optimiste.
Même précédent que `price_tiers`/`group_discount_*`. Aucun `grant` à écrire.
Migration : `supabase/migrations/20260916130000_camp_program.sql`.

**Pas de CHECK croisé `day <= duration_days`** : il ferait échouer en erreur SQL brute toute
réduction ultérieure de la durée d'un camp déjà programmé. La borne vit côté application
(`validateProgram`) et dans le validateur de `mockData/`.

### RPC modifiées (parité proposition socio)

`supabase/migrations/20260916140000_camp_program_proposal_parity.sql`, 4 RPC en `create or replace`,
signatures **inchangées**, corps extraits par `pg_get_functiondef` :

| RPC | Changement |
|---|---|
| `submit_product_creation_proposal` | `'program', p_payload -> 'program'` dans la whitelist camp + `program_cap_exceeded` (> 200 lignes) |
| `submit_product_proposal` | idem dans le bloc camp du chemin d'édition |
| `create_product_from_proposal` | colonne ajoutée à l'`insert`, valeur **normalisée** |
| `moderate_product_proposal` | écriture **gardée** (`? 'program'`) **et normalisée** |

Normalisation = `case when jsonb_typeof(p_payload -> 'program') = 'array' then … else null end`.

### Invariants

- Le `day` est **relatif au départ** (`day: 1` = jour du départ) : un seul programme par camp, valable
  pour tous ses `product_availability`. La date réelle est calculée à l'affichage.
- **Plusieurs entrées portent normalement le même `day`** — c'est ainsi qu'une journée porte
  plusieurs lignes. L'ordre du tableau fait foi à l'intérieur d'un jour.
- `text.es` obligatoire sur chaque ligne (c'est le repli), `text.en` facultatif.
- Le programme est saisissable **dès la création** du camp, et l'éditeur fonctionne **sans que la
  durée soit connue**.
- `program` structurellement `null` pour tout type ≠ `camp` (CHECK en base, pas seulement côté UI).
- La vitrine n'affiche une date que si une salida est connue ; sinon « Día N » seul — jamais une
  date inventée.
- Pour un camp, **tout champ whitelisté côté SQL doit être émis par `buildProductEditPayload`**,
  sinon chaque édition socio approuvée l'efface (cf. §10, défaut trouvé et corrigé ici).

### Cas limites

- Camp sans programme → `program is null`, aucun bloc sur la fiche.
- Journée sans ligne → non stockée (un « día libre » se saisit comme une ligne de texte).
- Ligne avec `en` mais sans `es` → refusée à la validation (sinon le repli l'afficherait en ES).
- `day` au-delà de `duration_days` → refusé **quand la durée est connue**, accepté sinon.
- Colonne corrompue → brouillon vide côté admin, `null` côté vitrine ; jamais une exception.
- Proposition d'édition déposée avant la migration (payload sans la clé) → programme préservé.
- Camp servi en vitrine (`external_booking_url`) → garde son programme (rendu hors de la branche
  `modoReserva`).

### Fichiers touchés

Créés : `supabase/migrations/2026091613/140000_*.sql`, `supabase/tests/database/camp_program.test.sql`,
`apps/admin/lib/products/program.ts(+test)`, `apps/admin/components/program-editor.tsx(+test)`,
`apps/web/lib/catalog/programa.ts(+test)`,
`apps/web/app/[locale]/(vitrine)/productos/[slug]/ProgramaCamp.tsx(+test)`,
`mockData/camps/campamento-yoga.json`.
Modifiés : les 5 points de parité admin (§11), `producto.ts`/`tipos.ts`/`calendario.ts`,
`FichaProducto.tsx`, `ReservationForm.tsx`, les messages `ProductPage.json` (es+en),
`seed-mock-data.mjs`, `mockData/README.md`.

## 1. Contexte et problème

Un camp a une durée (`duration_days`) et des départs fixes, mais aucun moyen de décrire ce qui s'y
passe : le déroulé était noyé dans la description en texte libre.

**Vérification V1 (« refaire pas réinventer »)** — ce n'est pas une invention : l'app legacy en
production porte `experiences.program` (`src/services/migrations/006_experiences_media.sql`), saisi
dans un textarea « Programa (una línea por punto) » (`public/index.html:733`) et rendu sur
`/reservar` en liste à puces sous « El plan, día a día » (`public/reservar.js:199`, `:493` pour
l'anglais). La journée y était une **convention d'écriture** dans le texte (« Día 1 · Recogida en
Medellín, La Piedra del Peñol al atardecer… ») ; cette spec en fait une donnée.
`docs/00-modele-de-donnees.md` §4a listait déjà « programme » comme champ d'un camp, marqué
🌐 multilingue et « base existante à généraliser ».

## 2. Portée

**In** : colonne + contraintes, parité des 4 RPC de proposition, éditeur dans le formulaire produit
(création et édition, admin et socio), modération, bloc vitrine sur la fiche produit, mock data.

**Out** : l'evento (qui portait pourtant un programme en V1 et que §4b du modèle prévoit) —
explicitement scopé au camp par Jérôme ; l'affichage du programme dans le panier ou sur la
réservation payée (confirmé : la fiche seulement) ; l'édition de `duration_days` (§10).

## 3. Décisions retenues (entretien du 2026-09-16)

| Question posée | Réponse de Jérôme |
|---|---|
| Rattachement : jour relatif ou date calendaire ? | **Jour relatif (J1…Jn)** — un seul programme pour toutes les éditions |
| Qui édite ? | **Admin + socio propriétaire**, le socio via proposition/modération |
| Langues ? | **ES + EN** par ligne, repli espagnol |
| Heure par ligne ? | **Non**, texte libre ; l'ordre de saisie fait foi |
| Camp seulement ou evento aussi ? | **Camp seulement** |
| Titre par journée ? | **Non**, juste les lignes |
| *(revue du plan)* | **Plusieurs entrées peuvent porter le même numéro de jour** |
| *(revue du plan)* | **Le programme se saisit dès la création du camp** |
| *(revue du plan)* | Sur le site client : **la fiche du camp seulement** |

## 4. Parcours cible

1. Admin (ou socio) ouvre le formulaire d'un camp — en création comme en édition.
2. Sous « Duración (días) », le bloc « Programa del camp » ouvre une carte par journée (1..durée si
   la durée est connue, sinon la seule journée 1 plus « + Agregar día »).
3. Il saisit ses lignes en espagnol, bascule en EN, traduit ce qu'il veut. Une langue oubliée
   retombera sur l'espagnol côté vitrine.
4. Admin → écriture directe. Socio → proposition, que l'admin approuve depuis `/admin/proposals/<id>`
   en voyant le programme actuel dans « Valor actual ».
5. Sur la fiche publique, le bloc « El plan, día a día » liste les journées ; choisir une édition
   date chaque journée (« Día 2 · vie, 4 dic »).

## 5. Écran(s)

**Admin** — `ProgramEditor` dans `ProductTypeFields`, sous le champ de durée, visible si
`hasProgram` (= `isCamp`). Un **seul** sélecteur ES/EN pour tout le bloc (§10), une carte par
journée, `+ Agregar línea` / `×` / `Vaciar` / `+ Agregar día`.

**Vitrine** — `ProgramaCamp`, entre le formulaire de réservation et la politique d'annulation ;
titre `<h2>` via l'atome `Title`, `<ol>` de journées, `<ul>` de lignes. Rendu **toujours en
entier** : ni accordéon, ni masquage selon la largeur.

## 10. Décisions tranchées / points ouverts

**Colonne plutôt que table fille.** Le motif n'est pas que les propositions ignoreraient une table
fille — `product_slot_rules` en est une et traverse très bien la **création**
(`create_product_from_proposal` boucle sur `p_payload -> 'slot_rules'`). C'est le chemin
d'**édition** qui les exclut, et `submit_product_proposal` le dit : « jamais tags/photos/slot_rules
[…] délégués à des blocs séparés à sauvegarde immédiate côté admin ». Or l'édition par le socio est
la moitié de la demande. Une table fille aurait imposé d'inventer un diff de lignes filles dans
`moderate_product_proposal`, sans précédent.

**Liste plate plutôt que journées à `items[]`.** Jérôme ayant précisé que plusieurs entrées peuvent
porter le même jour, la forme plate supprime la question « jour dupliqué : fusionner ou refuser ? ».
Le brouillon reste groupé par journée à l'écran ; `toProgramColumn` aplatit, `programFromColumn`
regroupe.

**Un seul sélecteur de langue.** Un `LocalizedTextField` par ligne aurait produit 28 sélecteurs ES/EN
indépendants pour un camp de 7 jours × 4 lignes, dans une colonne `max-w-md` — illisible à 390 px,
alors que le responsive admin est obligatoire. Le stockage reste `{es, en}` ; seule la saisie est
mutualisée.

**⚠️ Le littéral JSON `null`.** Les RPC lisent `p_payload -> 'program'` (flèche simple), donc un
payload `{"program": null}` produit `'null'::jsonb`, pas un NULL SQL — et
`jsonb_typeof('null'::jsonb)` vaut `'null'`. Posé seul, `products_program_is_array` aurait **rejeté
toute création de camp sans programme**, `/hifago-mock-data` compris. Le dépôt avait déjà payé ce
bug sur `price_tiers` (`20260818240000`, « 11 produits » pollués), où il se manifestait à
l'exécution plutôt qu'au rejet. D'où la normalisation à chaque site d'écriture SQL — qui rend le
CHECK tenable et donne à cette colonne la garantie que `price_tiers` n'a jamais eue.

**Défaut trouvé et corrigé en chemin : `group_discount_*` s'effaçait.** La whitelist de
`submit_product_proposal` construit `jsonb_build_object('group_discount_pct', p_payload -> …)`, donc
pour un camp la clé est **toujours** présente dans le payload stocké — à `null` quand
`buildProductEditPayload` ne l'émet pas, ce qui était le cas depuis le 2026-09-14. La garde
`? 'group_discount_pct'` la voyait alors présente et écrivait `null` : **approuver une édition socio
effaçait la remise de groupe du camp**. Reproduit en réel (seuil 16 / 20 % → NULL), corrigé ici en
ajoutant le bloc `isCamp` manquant. Règle qui en découle : pour un camp, tout champ whitelisté côté
SQL doit être émis par `buildProductEditPayload`.

**`duration_days` reste non éditable.** Il est désormais *lu* par les trois écrans (pour ouvrir le
bon nombre de journées) mais jamais réécrit ni réinjecté dans son input. Ce n'est pas un gap laissé
par paresse : `apps/web/lib/orders/formatLineSchedule.ts` et `getOrderByToken.ts` le relisent pour
reconstituer la date de fin de **commandes déjà payées** — le rendre éditable réécrirait
rétroactivement les dates de réservations existantes.

**Point ouvert** : aucun e2e Playwright (suite en pause depuis le 2026-09-09).

## 11. Annexe — traçabilité code→règle

| Sujet | Fichiers |
|---|---|
| Ancrage V1 | `src/services/migrations/006_experiences_media.sql`, `public/index.html:733`, `public/reservar.js:199` |
| Colonne + CHECK | `supabase/migrations/20260916130000_camp_program.sql` |
| Parité 4 RPC | `supabase/migrations/20260916140000_camp_program_proposal_parity.sql` |
| Les 5 points de parité admin | `productCreationPayload.ts`, `productEditPayload.ts`, `product-form.tsx` (select+update), les 3 `select` (`admin/products/[id]/edit`, `partner/(app)/products/[id]/edit`, `admin/proposals/[id]`), whitelists SQL |
| Anti-effacement à la modération | `admin/proposals/[id]/ModerateProposalForm.tsx` (`"program" in proposedPayload`) |
| Logique pure | `apps/admin/lib/products/program.ts`, `apps/web/lib/catalog/programa.ts` |
| Date d'une journée | `apps/web/lib/reservas/calendario.ts#fechaDelDiaDePrograma` |
| Rendu | `productos/[slug]/ProgramaCamp.tsx`, monté par `FichaProducto.tsx` hors branche `modoReserva` |

## 12. Documents liés

`docs/00-modele-de-donnees.md` §4a · `docs/specs/36-remise-remplissage-camp.md` (patron de parité) ·
`docs/specs/11-admin-activite-parcours-unifie-creneaux.md` (`LocalizedTextField`) ·
`docs/specs/30-vitrine-fiches-produit-et-etablissement.md` (fiche produit) ·
`supabase/migrations/20260818240000_fix_price_tiers_json_null.sql` (le piège du littéral `null`).
