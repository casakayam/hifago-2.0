---
id: specs-agenda-reservations-socio
titre: "Agenda de réservations socio (vue jour/semaine/mois)"
theme: specs
public: [ia, dev, jerome]
langue: fr
statut: brouillon
maj: 2026-08-18
resume: >
  Remplace la page d'accueil du socio (/partner) par un agenda type Google Calendar (jour/semaine/
  mois) affichant chaque réservation individuelle de ses produits, avec ajout manuel (walk-in) et
  fiche de réservation cliquable — construction neuve, distincte du calendrier de cupos existant.
mots_cles: [agenda, calendrier, reservations, socio, svar react calendar, order_lines, walk-in, fiche reservation]
repond_a:
  - "Comment un socio voit-il toutes ses réservations sur un calendrier jour/semaine/mois ?"
  - "Comment un socio ajoute-t-il une réservation manuelle (walk-in) ?"
  - "Où mène le clic sur une réservation depuis l'agenda ?"
---

# Agenda de réservations socio (vue jour/semaine/mois)

> **Cible stack** : hifago. Périmètre socio uniquement — l'admin garde son propre calendrier de
> cupos (FullCalendar, spec 17), non touché ici.

## Sommaire et statut

| # | Section | Statut |
|---|---|---|
| 0 | **Contrat compact** (API/RPC, modèle de données, invariants, cas limites — pour coder) | brouillon |
| 1 | Contexte et problème | brouillon |
| 2 | Portée | brouillon |
| 3 | Décisions retenues | brouillon |
| 4 | Parcours cible | brouillon |
| 5 | Écran(s) | brouillon |
| 6-9 | *(fusionnées dans 0)* | — |
| 10 | Décisions tranchées / points ouverts | brouillon |
| 11 | Annexe — traçabilité code→règle | brouillon |
| 12 | Documents liés | brouillon |

---

## 0. Contrat compact (pour coder — lire seul, sans le reste)

### Endpoints / RPC

| RPC | Signature | Rôle |
|---|---|---|
| `create_manual_order_line` | `(p_product_id uuid, p_date date, p_qty int, p_holder_name text, p_slot_start_time time default null, p_holder_phone text default null, p_note text default null) returns jsonb` | Nouvelle. Réservation manuelle (walk-in) saisie par l'operator depuis l'agenda. Squelette anti-survente (`docs/05-reference-technique.md` §1) : `security definer`, `set search_path=''`, verrou `for update` (branche créneau → `product_slot_availability` ; branche simple → `product_availability`, matérialisation `default_capacity` si besoin, mirroir de `create_order`). |
| `set_order_line_status` | signature inchangée `(p_order_line_id uuid, p_new_status text, p_reason text)` | Étendue : un operator peut désormais passer une ligne de son établissement vers `no_show` **ou** `cancelled_by_provider` (avant : `no_show` seul). |
| `modify_order_line` | signature inchangée `(p_order_line_id uuid, p_new_date date, p_new_qty int, p_reason text, p_new_end_date date default null)` | Étendue : autorisée à un operator sur son propre établissement (avant : admin-only strict). Exclusion créneaux (`slot_start_time is not null` → refus) inchangée, reste hors périmètre pour l'operator comme pour l'admin. **Fix requis dans le même geste** : l'appel `perform log_admin_action(...)` en fin de fonction est lui-même `is_admin`-gated en interne — un appel operator le ferait échouer et annulerait toute la transaction. Remplacer par un insert direct dans `audit_log`, même patron déjà en place dans `set_order_line_status` (migration `20260818150000`, commentaire d'entête). |

Aucune nouvelle RPC de lecture : la policy `order_lines_select_operator` (migration `20260817170000`) suffit déjà à exposer toutes les `order_lines` d'un operator sur ses établissements. L'agenda lit `order_lines` + `products` (embarqué) via une query Server Component classique, plus un fetch ciblé `product_slot_availability` pour les tuples présents dans la fenêtre visible.

### Modèle de données (delta)

| Table | Changement |
|---|---|
| `order_lines.commission_case` | `CHECK` étendu : ajouter `'operator_manual'` aux valeurs déjà admises (`external_referrer`, `self_referral`, `direct`). Utilisée uniquement par `create_manual_order_line`. |
| `orders` | Réutilisée telle quelle. `account_id` reste `null` pour un walk-in (précédent "guest checkout" déjà en place). `holder_email` étant `NOT NULL` (migration `20260817190000`), `create_manual_order_line` insère la sentinelle `'reserva-manual@hifago.local'` (distincte de la sentinelle de backfill legacy `'sin-email-migrado@hifago.local'`). |

Aucune nouvelle table.

### Invariants

- Un événement affiché dans l'agenda = une `order_line`, jamais un agrégat — plusieurs réservations simultanées restent toutes visibles individuellement.
- Titre d'un événement : `"${nom_produit} - ${holder_name} - ${qty} pers."`.
- Une ligne à `slot_start_time` non nul se positionne sur `date + slot_start_time`, durée = `product_slot_availability.slot_duration_minutes` (jointure sur `product_id, slot_date=date, slot_start_time`) — seule source de durée exploitable.
- Une ligne avec `end_date` non nul (hôtel/lodging) ou `products.type = 'camp'` se positionne en bandeau "toute la journée" sur sa plage (fin calculée pour un camp via `date + products.duration_days - 1`, pas de colonne `end_date` stockée pour ce type).
- Toute autre ligne (date simple, sans créneau ni plage) se positionne en chip "toute la journée" sur son seul jour — **jamais d'heure fabriquée par défaut**.
- Tout événement `allDay` porte un `end` en borne **exclusive** (jour suivant le dernier jour occupé) — constaté en lisant le bundle réel de `@svar-ui/calendar-store` (`MonthViewModel.mapToPrimitive` calcule `end.getTime() - 1` pour localiser la dernière cellule ; un `end` égal à `start` retombe sur la veille, largeur nulle, événement invisible). `end_date` (hôtel/lodging) est déjà exclusif tel quel dans le modèle de données ; la branche "un seul jour" et la branche camp ajoutent +1 jour explicitement.
- `create_manual_order_line` refuse `products.type in ('hotel', 'lodging', 'camp')` — hôtel/lodging : choix de chambre, tarif par nuit hors périmètre d'un ajout rapide agenda ; camp : ressource partagée multi-jours (`provider_resource_calendar`/`availability_blocks`), non répliquée dans cette RPC plus légère que `create_order` — l'autoriser silencieusement créerait un vrai trou anti-survente sur la ressource partagée.
- `create_manual_order_line` ne calcule ni attribution référent ni commission app : `referrer_partner_id = null`, `commission_case = 'operator_manual'`, `referrer_pct = app_pct = acompte_pct = 0`.
- Fiche de réservation (`holder_name` seul exposé) : jamais `holder_email`/`holder_phone` du client, jamais les colonnes de commission internes — même restriction PII que « Mis Reservas » (spec 17).
- `modify_order_line` reste refusée pour toute ligne à créneau horaire (`slot_start_time is not null`), operator compris — pas d'extension créneau dans cette spec.

### Cas limites

| Situation | Traitement |
|---|---|
| Produit sans aucune règle `product_slot_rules` mais `p_slot_start_time` fourni à `create_manual_order_line` | Refus `slot_not_found` (aucun créneau dérivé ne correspond). |
| Produit avec `product_slot_rules` mais `p_slot_start_time` omis | Refus `slot_required`, même garde que `create_order` Phase 1. |
| `products.type in ('hotel','lodging','camp')` visé par un ajout manuel | Refus `unsupported_product_type`. |
| Capacité pleine au moment du verrou | Refus `full` (comme `create_order`). |
| Operator hors de son établissement (produit d'un autre partenaire) | Refus `product_not_found` (jamais une fuite d'existence), même patron que `set_product_slot_capacity`. |
| Clic "Modificar fecha" sur une ligne à créneau horaire | Bouton absent côté fiche (pas un appel RPC qui échoue) — message "La modificación de horarios reservados aún no está disponible aquí." |
| Ligne déjà `no_show`/`cancelled_*`/`expired`/`superseded` | Aucune action proposée sur la fiche (actions conditionnées à `status === 'reserved'`). |
| Vue mobile (< 768px) | Vue par défaut "día" au lieu de "mes", détectée côté client (`matchMedia`, jamais une détection serveur). |
| `products.price_tiers` contient le littéral JSON `null` (pas SQL `NULL` — constaté sur 11 produits réels de la base locale) | Normalisé en SQL `NULL` juste après lecture (`jsonb_typeof(v_price_tiers) is distinct from 'array'`) — sinon `v_price_tiers is not null` reste vrai et `jsonb_to_recordset` lève une exception. **Même correctif désormais appliqué à `resolve_tier_price`/`create_order`/`modify_order_line` (migration `20260818240000`) — cf. §10 point 13.** |

### Fichiers touchés

Voir §11 (traçabilité) pour le détail complet.

---

## 1. Contexte et problème

Le socio n'a aujourd'hui aucune vue calendrier "principale". Sa page d'accueil (`apps/admin/app/partner/(app)/page.tsx`) est un simple statut d'onboarding (rôles/capacités). Ses réservations vivent dans `/partner/reservations` (spec 17 Tranche 1, `ReservationsTable.tsx`) — un tableau plat, sans navigation par ligne, sans vue calendaire. Le calendrier existant (`availability-calendar.tsx`, FullCalendar) est un outil de gestion de **cupos/disponibilité** (agrégat `booked/capacity` par jour, un seul produit à la fois) — il n'affiche jamais qui a réservé et ne couvre qu'un produit en drill-down, jamais une vue globale toutes activités confondues.

Jérôme veut un agenda façon Google Calendar (jour/semaine/mois) montrant chaque réservation individuelle de tous ses produits, avec ajout manuel d'une réservation (walk-in) directement sur le calendrier, et un clic vers une fiche de réservation dédiée (qui n'existe nulle part aujourd'hui au niveau d'une `order_line` individuelle côté socio — seul `/admin/orders/[id]` existe, au niveau `orders`, admin-only).

## 2. Portée

**In** : agenda socio (jour/semaine/mois) sur `/partner`, lecture de toutes les `order_lines` des établissements où le socio est `operator` actif ; ajout manuel d'une réservation (nouvelle RPC) ; fiche de réservation par ligne avec actions annuler/no-show/modifier date (hors créneaux).

**Out, renvoyé ailleurs** :
- Toute vue admin équivalente (multi-partenaires) — hors périmètre, portée nettement plus large.
- Le calendrier de cupos/disponibilité existant — inchangé, outil différent.
- Modification de date d'une ligne à créneau horaire via `modify_order_line` — reste hors périmètre (comme pour l'admin, spec 18 §2).
- Notification prestataire post-réservation, ressource partagée généralisée — Tranche 4 de la spec 17, toujours non numérotée, non traitée ici.

## 3. Décisions retenues

- **Bibliothèque : SVAR React Calendar** (`@svar-ui/react-calendar`), pas FullCalendar. Historique de décision en 3 temps le 2026-08-18 (détail §10 point 1) : (1) Jérôme choisit MUI X Scheduler malgré le signal donné sur le conflit avec "HeroUI = seul socle" et le statut beta+responsive expérimentale ; (2) en construisant l'écran, vérification directe des `.d.ts` du package installé révèle qu'`EventCalendar` (MUI) n'expose **aucun** callback de clic public — blocage réel, pas juste un risque, sur les deux interactions centrales de la demande (clic résa→fiche, clic case vide→ajout) ; (3) Jérôme propose SVAR React Calendar, vérifié stable (v2.6.2, pas beta), MIT gratuit, avec une vraie API d'événements (`onSelectEvent`/`onAddEvent`, dérivés du bus d'actions `select-event`/`add-event`) qui résout le blocage. Ne réintroduit pas de second design system de composants (pas de boutons/inputs SVAR — seulement le rendu du calendrier, CSS propre scopé comme FullCalendar déjà accepté dans ce projet). Le calendrier de cupos existant garde FullCalendar, inchangé.
- **RLS `order_lines_select_operator`** (migration `20260817170000`) fait foi pour la lecture — aucune nouvelle policy, aucune nouvelle RPC de lecture.
- **Commission sur un walk-in : zéro** (décision Jérôme, 2026-08-18) — `commission_case = 'operator_manual'`, présumé payé directement au partenaire, hors flux de paiement plateforme.
- **Emplacement : remplace `/partner`** (page d'accueil), en conservant un repère de statut onboarding condensé pour un partenaire non encore actif.

## 4. Parcours cible

1. Le socio se connecte, atterrit sur `/partner` : bandeau de statut (condensé si actif, carte complète sinon) + agenda en dessous.
2. Vue par défaut : "month" sur desktop (une vue "week" trop étroite masquerait toute réservation hors de la semaine courante à l'ouverture), "day" sur mobile (< 768px). Le socio bascule jour/semaine/mois via la toolbar intégrée de SVAR Calendar (`view`/`views` props).
3. Chaque réservation existante apparaît comme un événement individuel, titré `activité - client - N pers.`, positionné sur son créneau/durée réelle ou en bandeau "toute la journée" selon sa forme (cf. §0 invariants). Plusieurs réservations simultanées apparaissent côte à côte, aucune n'est masquée.
4. **Clic sur un événement** (`onSelectEvent`, dérivé de l'action `select-event`) → navigation directe vers `/partner/reservations/[id]` (fiche). Aucun éditeur SVAR monté (le composant `Editor` de `@svar-ui/react-calendar` est optionnel et volontairement jamais rendu) : rien ne concurrence notre propre fiche.
5. **Clic sur une case vide pour créer** (`onAddEvent`, dérivé de l'action `add-event`) → ouverture d'`AddReservationDialog`, préremplie avec la date/heure du clic (`ev.event.start`/`end`) : sélection du produit (scopé aux établissements operator), si créneaux, sélection d'un horaire réel via `get_product_slots` ; saisie nom client + nombre de personnes ; soumission → `create_manual_order_line` → `router.refresh()` (source de vérité = le serveur, jamais l'état interne optimiste de SVAR — cf. §10 point 11).
6. Glisser-déposer/redimensionnement (drag `move-event`, resize `update-event`) et suppression (`delete-event`) — actions internes de SVAR — **bloquées explicitement** via `api.intercept(...)` : toute mutation d'une réservation existante passe uniquement par la fiche (§7), jamais par une manipulation directe sur le calendrier qui contournerait nos RPC anti-survente.
7. Sur la fiche (`/partner/reservations/[id]`) : détail de la réservation + actions conditionnées à `status = 'reserved'` (Cliente no vino, Cancelar reserva, Modificar fecha si pas de créneau).

## 5. Écran(s)

**Agenda (`/partner`)** : bandeau de statut onboarding (conditionnel) + `PartnerAgenda` (`@svar-ui/react-calendar`, vues jour/semaine/mois, `onSelectEvent`/`onAddEvent` câblés, `move-event`/`update-event`/`delete-event` interceptés/bloqués) + état vide si aucun produit vendable.

**Fiche de réservation (`/partner/reservations/[id]`)** : produit/type, établissement, titulaire (`holder_name` seul), date/horaire/check-out, quantité, statut (chip, `statusLabels.ts` réutilisé), montant total, date de création. Actions : Cliente no vino / Cancelar reserva (composant généralisé `SetOrderLineStatusDialog`, remplace `NoShowDialog.tsx`) ; Modificar fecha (réutilise `ModifyOrderLineDialog.tsx` tel quel, visible seulement si `slot_start_time is null`).

---

## 10. Décisions tranchées / points ouverts

| # | Point | Statut |
|---|---|---|
| 1 | Bibliothèque calendrier agenda socio (au lieu de FullCalendar) | **Tranché par Jérôme, en 3 temps le 2026-08-18** — consigné dans `docs/04-architecture-cible.md`. (a) Choix initial MUI X Scheduler malgré le risque signalé (second design system Material/Emotion, beta, responsive marquée "expérimentale" par l'éditeur). (b) En construisant l'écran, inspection directe des `.d.ts` du package installé (pas la doc — le code) : `EventCalendar` n'expose aucun callback de clic public, aucune prop de personnalisation du popup, l'API impérative se limite à `setVisibleDate` — blocage réel sur les deux interactions centrales de la demande, pas juste un risque théorique. (c) Jérôme propose **SVAR React Calendar** (`@svar-ui/react-calendar`) ; vérifié en direct (npm + `.d.ts` réels) : version stable `2.6.2` (pas de tag beta), licence MIT, aucune dépendance à un design system de composants (juste le rendu du calendrier, CSS propre — même statut que FullCalendar déjà accepté), et surtout une vraie API d'événements (`select-event`/`add-event` du bus d'actions, exposée en props React `onSelectEvent`/`onAddEvent`) qui résout le blocage (b). Retenu. |
| 2 | Convention de positionnement horaire pour une ligne sans créneau (date seule / nuit(s)) | **Tranché ici** (§0 invariants) — bandeau/chip "toute la journée", jamais d'heure fabriquée : fabriquer une heure mentirait à l'opérateur sur un produit qui n'a structurellement aucune heure. |
| 3 | Lecture agenda : RLS directe, pas de nouvelle RPC | **Tranché** — aucune des trois raisons RPC-only (`hifago/CLAUDE.md` §3 : compteur de capacité, audit nominatif, vue miroir d'une autre identité) ne s'applique à une lecture d'un operator sur ses propres données déjà couvertes par RLS. |
| 4 | Extension `modify_order_line` à l'operator | **Nécessaire, tranché** — élargissement d'un chokepoint partagé avec l'admin (AGENTS-PARALLELES.md §6), signalé explicitement avant implémentation. Inclut le fix `log_admin_action` → insert direct `audit_log` (sinon la transaction operator échoue systématiquement). |
| 5 | Commission sur une réservation manuelle (walk-in) | **Tranché par Jérôme (2026-08-18) : zéro** (`commission_case = 'operator_manual'`). |
| 6 | `create_manual_order_line` exclut hôtel/lodging en V1 | **Tranché** — complexité chambre/tarif hors périmètre d'un ajout rapide depuis l'agenda ; même logique de scoping incrémental déjà pratiquée dans ce repo (`modify_order_line` exclut aussi les créneaux en V1). |
| 7 | Pas d'override de prix/bornes qty pour un walk-in en V1 | **Tranché** — toujours dérivé du produit (`price_tiers`/`price_cop`), comme `create_order`. |
| 8 | Étendre `modify_order_line` aux créneaux dans cette même tâche | **Renvoyé, pas dans cette spec** — ajouter une 4ᵉ branche à une RPC déjà lourde en même temps qu'un élargissement d'autorisation double le risque de régression sur un chokepoint partagé admin. Bouton "Modificar fecha" simplement absent côté fiche pour une ligne à créneau. |
| 9 | Statuts affichés dans l'agenda (pleins/atténués/masqués selon le statut) | **Recommandation, non bloquante** — `reserved`/`fulfilled` pleins, `no_show`/`cancelled_*` atténués, `superseded`/`expired` masqués. Ajustable sans impact structurel. |
| 10 | Sélecteur d'établissement si un socio en opère plusieurs | **Recommandation : pas en V1** — un seul agenda agrégeant tous les établissements operator, aligné sur `ReservationsTable`/`page.tsx` existants qui ne filtrent pas non plus par établissement dans l'UI. |
| 11 | Modèle d'interaction SVAR React Calendar (clic événement, clic case vide, drag/resize) | **Tranché ici, sur la base des `.d.ts` réels de `@svar-ui/react-calendar`/`@svar-ui/calendar-store`** — le composant `Calendar` expose les actions de son bus interne comme props React directes (`select-event`→`onSelectEvent`, `add-event`→`onAddEvent`, etc.), et un composant `Editor` séparé et **optionnel** (jamais monté ici) porte l'UI d'édition intégrée. Décision : (a) `onSelectEvent` navigue directement vers la fiche — aucun popup/éditeur SVAR ne concurrence notre UI, puisque `<Editor>` n'est jamais rendu ; (b) `onAddEvent` ouvre `AddReservationDialog` ; comme `events` reste un prop **contrôlé** re-dérivé du serveur après `router.refresh()`, un éventuel ajout optimiste interne à SVAR (si l'action `add-event` n'est pas bloquée) s'auto-corrige au prochain rendu — pas de risque d'incohérence persistée puisque rien n'est écrit en base par SVAR lui-même ; (c) `move-event`/`update-event`/`delete-event` sont explicitement **bloquées** via `api.intercept(nom, () => false)` (contrat `EventBus.intercept`, `@svar-ui/lib-state`) — sans ce blocage, un glisser-déposer accidentel modifierait visuellement une réservation sans jamais passer par `modify_order_line`/`set_order_line_status`, laissant le calendrier afficher un état qui ne correspond à rien en base. SVAR confirmé non utilisé ailleurs dans le projet (grep) — pas de risque de second design system (juste le rendu du calendrier, pas de composants boutons/inputs SVAR utilisés hors de cet écran). |
| 12 | Import CSS SVAR incomplet (`style.css` au lieu de `all.css`) | **Bug, corrigé le jour même** — retour direct de Jérôme après test réel (« immonde et illisible »). `dist/index.css` (export `style.css`) ne porte que 119 sélecteurs `.wx-*`, sans `.wx-button`/`.wx-navigation` (toolbar/boutons/icônes). `dist-full/index.css` (export `all.css`) porte les 309 sélecteurs complets — c'est l'export à utiliser pour tout thème SVAR (Willow/WillowDark) complet, pas un point de départ à compléter soi-même. Vérifié par capture d'écran réelle avant/après. |
| 13 | `products.price_tiers` = littéral JSON `null` fait planter `jsonb_to_recordset` | **Bug, corrigé le jour même dans `create_manual_order_line`** — retour direct de Jérôme après test réel (« cannot call jsonb_to_recordset on a non-array »). Cf. §0 Cas limites pour le détail technique. **Le même motif, signalé comme non gardé dans `create_order`/`modify_order_line`, s'est reproduit en vrai** en créant des données de test réelles (résa logement `gmiro46`, produit `Alojamiento 1`) — Jérôme a tranché en direct pour un correctif code plutôt qu'un patch de données. Corrigé (migration `20260818240000`) dans `resolve_tier_price` (fonction partagée), `create_order` (4 sites) et `modify_order_line` (3 sites), signatures inchangées ; pgTAP des 4 RPC concernées rejoué, 0 échec ; recherche exhaustive (`grep jsonb_to_recordset` + filtrage aux définitions vivantes via `pg_get_functiondef`) confirmant qu'aucune autre fonction ne partage encore ce motif. |
| 14 | Un alojamiento (2026-08-19) était facturé `prix_nuit × nuits × qty(personnes)` au lieu de `prix_nuit × nuits` | **Bug préexistant (Tranche 2, avant cette session), trouvé par Jérôme sur la résa de démo `gmiro46`** (4 nuits × 2 pers. facturait 1 600 000 au lieu de 800 000). Root cause : `qty` sur une ligne `lodging` = nombre de personnes (spec 12 §0), et `price_tiers`/`resolve_tier_price` choisissent déjà le tarif nocturne TOTAL pour la tranche d'occupants (même convention que `stayService.js` V1) — `create_order`/`modify_order_line` multipliaient ENCORE par `qty` en fin de calcul, comptant les personnes deux fois. **Pas le même bug que la branche chambre d'hôtel** (`qty` y désigne des lits/chambres réellement distincts, la multiplication y reste correcte, branche non touchée). Corrigé après confirmation explicite de Jérôme — migration `20260818250000`, signatures inchangées, un seul site par fonction (`v_total_cop := v_sum_nightly` au lieu de `* v_line_qty`). pgTAP : 1 assertion `modify_order_line.test.sql` (cas L1) qui datait de l'ancien calcul buggé, corrigée ; suite rejouée, 0 échec. |
| 15 | Job `expire_stale_payment_orders` (spec 19, ajouté 2026-08-18 par une session concurrente) expire toute réservation manuelle 30 min après création | **Ouvert, pas encore tranché** — ni `create_manual_order_line` (walk-in payé cash) ni un `create_order` de test jamais poussé jusqu'au paiement Mercado Pago ne passent `orders.payment_status` à `paid` ; le job les traite comme des paniers abandonnés et les expire après la fenêtre de grâce de 30 min. Constaté sur les données réelles : 88/102 `order_lines` créées sur 2 jours déjà `expired` pour cette raison. Décision à prendre avec Jérôme (ex. : `create_manual_order_line` marque `payment_status = 'paid'` immédiatement, ou le job exempte `commission_case = 'operator_manual'`) — signalé, pas corrigé en silence. |

---

## 11. Annexe — traçabilité code→règle

| Section | Fichiers |
|---|---|
| §0 RPC `create_manual_order_line` | `supabase/migrations/<ts>_create_manual_order_line_rpc.sql`, `supabase/tests/database/create_manual_order_line.test.sql`, `tests/concurrency/create_manual_order_line_{default_capacity,slot}.concurrency.mjs` |
| §0 Extension `set_order_line_status`/`modify_order_line` | `supabase/migrations/<ts>_order_line_operator_actions.sql`, `supabase/tests/database/set_order_line_status.test.sql`, `supabase/tests/database/modify_order_line.test.sql` |
| §0 Positionnement des événements | `apps/admin/lib/agenda/positionOrderLines.ts` + `.test.ts` |
| §5 Agenda | `apps/admin/app/partner/(app)/page.tsx`, `PartnerAgenda.tsx`, `AddReservationDialog.tsx` |
| §5 Fiche de réservation | `apps/admin/app/partner/(app)/reservations/[id]/page.tsx`, `ReservationActions.tsx`, `SetOrderLineStatusDialog.tsx` |
| Dépendance | `apps/admin/package.json` (`@svar-ui/react-calendar`) |
| E2E | `apps/admin/e2e/partner-agenda.spec.ts` |

## 12. Documents liés

- `docs/specs/17-calendrier-disponibilite-refonte.md` — calendrier de cupos/disponibilité (FullCalendar, inchangé), RLS `order_lines_select_operator`, restriction PII `holder_name`.
- `docs/specs/18-creneaux-horaires-reservables.md` — `product_slot_availability`, `get_product_slots`, `expand_product_slots`, réutilisés tels quels par `AddReservationDialog`.
- `docs/specs/19-paiement-mercadopago-acompte-ledger.md` — `ledger_entries`, régime des transitions `set_order_line_status` (référence pour ne pas casser l'écriture ledger existante lors de l'extension d'autorisation).
- `docs/04-architecture-cible.md` — décision FullCalendar historique + révision SVAR React Calendar (à ajouter dans le même commit que cette spec).
- `docs/05-reference-technique.md` — squelette RPC anti-survente et test de concurrence, réutilisés tels quels.
