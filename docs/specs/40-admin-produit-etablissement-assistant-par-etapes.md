---
id: specs-40-admin-assistant-par-etapes
titre: "Assistant par étapes — création/édition produit et établissement, écran de confirmation"
theme: specs
public: [ia, dev, jerome]
langue: fr
statut: implemente
maj: 2026-09-26
resume: >
  Convertit la création d'un produit du catalogue et d'un établissement en wizard par étapes
  (édition en sections), et ajoute un écran de confirmation en fin de parcours dont le contenu
  dépend de qui agit (admin Hifago vs partenaire/socio) — validé sur un prototype visuel HTML
  itéré avec Jérôme avant tout code réel.
mots_cles: [admin, produit, establecimiento, wizard, assistant, confirmation, ui, product-form]
repond_a:
  - "Pourquoi ProductForm a-t-il un wizard alors que spec 11 §180 le rejetait ?"
  - "Quelles étapes existent pour chaque type de produit ?"
  - "Comment l'écran de confirmation varie-t-il selon qui soumet ?"
---

# Assistant par étapes — produit, établissement, écran de confirmation

> **Cible stack** : hifago.

## Sommaire et statut

| # | Section | Statut |
|---|---|---|
| 0 | Contrat compact | implemente |
| 1 | Contexte et problème | implemente |
| 2 | Portée | implemente |
| 3 | Décisions retenues | implemente |
| 4 | Parcours cible | implemente |
| 5 | Écran(s) | implemente |
| 10 | Décisions tranchées / points ouverts | implemente |
| 11 | Annexe — traçabilité code→règle | implemente |
| 12 | Documents liés | implemente |

---

## 0. Contrat compact (pour coder — lire seul, sans le reste)

### Étapes par entité (source de vérité — ne pas laisser dériver du code)

**Produit (`product-form.tsx`), création, toujours 3 étapes pour les 5 types :**

| Type | Étape 2 « Detalles » | Étape 3 « Comercialización » |
|---|---|---|
| activity | LobbyLink · Ubicación · Tags · Fotos | Precio+tramos/cantidades · Cupo diario · Horarios · Vitrina |
| lodging | LobbyLink · Ubicación · Tags · Equipamiento · Fotos · datos alojamiento | Precio+tramos/cantidades (huéspedes) · Cupo diario · Tarifas de temporada · Vitrina |
| transport | LobbyLink · Contacto/rutas/horarios informativos · Tags · Fotos | Precio simple **+** tramos/cantidades (doublon préexistant, cf. §10) · Vitrina — pas de cupo |
| camp | Tags · Fotos · Duración+Programa | Precio simple (COP) · Cupo diario · Descuento por grupo · Vitrina |
| evento | Tags · Fotos · Ocurrencia/Fecha/Recurrencia/Horario | Modo de reserva + capacidad/precio/pago — pas de Vitrina |

Étape 1 (« Establecimiento y tipo ») : Establecimiento, Tipo, Nombre (i18n), Descripción (i18n) — gatée `!isEditing`, vit dans `product-form.tsx` lui-même, pas dans `ProductTypeFields`.

**Établissement (`NewEstablishmentForm.tsx`), création, toujours 2 étapes** (pas de 3e étape commerciale — aucun prix propre) : Étape 1 « Propietario y gestión » = Partner + case « Operado directamente » (indépendants). Étape 2 « Detalles » = Nombre (jamais localisé) + Descripción (i18n) + Dirección + Fotos + Equipamiento.

**Édition** : jamais un wizard. Produit → 2 `Card` HeroUI (« Detalles » / « Comercialización »), un seul bouton. Établissement → 9 blocs indépendants inchangés dans leur RPC/comportement, 4 à confirmation contenue (cf. §5).

### Mécanisme `section`

`ProductTypeFields` reçoit `section?: "details" | "pricing"` (absent = comportement identique aux 3 autres consommateurs). Propagé un niveau plus bas dans `camp-fields.tsx`, `lodging-fields.tsx`, `evento-fields.tsx` (ces 3 mélangeaient déjà les deux catégories dans un seul fichier).

### Invariants

- `ProductForm` reste l'unique composant, `handleSubmit` l'unique point de soumission — jamais deux formulaires, jamais un flux multi-pages (réouverture assumée, tracée, de `docs/specs/11-admin-activite-parcours-unifie-creneaux.md:180`, seule la présentation change).
- Les 3 prédicats de `productFormRequiredFields.ts` sont la SEULE source de validation — appelés à la fois par la navigation par étape et par la soumission finale, jamais dupliqués.
- `create_establishment`/`update_establishment` et toutes les RPC des 9 blocs établissement restent inchangées — seule la présentation bouge.
- L'écran de confirmation ne remplace jamais un `router.push` existant par une nouvelle route : il le DIFFÈRE (le clic sur l'action du composant déclenche le même `router.push`/`refresh` qu'avant).
- Confirmation **contenue** (`contained`) uniquement pour les 4 blocs établissement à bouton explicite (`EstablishmentEditBlock`, `Stay`, `Contact`, `Pms`) et pour `EditEstablishmentProposalForm` — jamais plein écran là où d'autres blocs de la même page doivent rester visibles.
- Aucune confirmation n'est ajoutée aux blocs à bascule instantanée (`EstablishmentStatusBlock`, `Photos`, `Tags`, `Amenities`) ni à la table en lecture seule — distinction déjà actée dans le prototype, pas une inventée en cours de route.

### Cas limites

- Évento sans étape « Comercialización » propre → son propre bloc de réservation/tarification (`EventoFields`) EST son étape 3, pas une absence.
- Camp avec un vrai champ prix simple (`!isEvento && !hasLocationAndTags`) → gardé tel quel, absent du résumé initial du prototype (cf. §10).
- Transport : bug préexistant du double champ « Precio (COP) » (cf. `docs/dette-technique.md`) → inchangé, non corrigé ici.
- `EditEstablishmentProposalForm` : une proposition en attente REMPLACE désormais le formulaire (au lieu d'une bannière au-dessus d'un formulaire resté éditable) — changement de comportement réel, pas un simple habillage.

### Fichiers touchés

**Nouveaux** : `apps/admin/lib/products/productFormRequiredFields.ts`, `apps/admin/components/action-confirmation.tsx`, `apps/admin/components/wizard-stepper.tsx`.
**Modifiés** : `apps/admin/components/product-form.tsx`, `apps/admin/components/product-type-fields/{index,camp-fields,lodging-fields,evento-fields}.tsx`, `apps/admin/app/admin/establishments/new/NewEstablishmentForm.tsx`, `apps/admin/app/admin/establishments/[id]/{EstablishmentEditBlock,EstablishmentStayBlock,EstablishmentContactBlock,EstablishmentPmsBlock}.tsx`, `apps/admin/app/partner/(app)/establishment/new/NewEstablishmentProposalForm.tsx`, `apps/admin/app/partner/(app)/establishment/[id]/edit/EditEstablishmentProposalForm.tsx`.

---

## 1. Contexte et problème

Le thème admin (« Argile », spec 09) était jugé trop austère et peu lisible par Jérôme — en particulier le parcours de création d'un produit : un unique `<form>` plat affichant à la suite tous les champs, quel que soit le type, sans regroupement visuel. Vérifié : aucun écran de confirmation n'existait nulle part dans l'admin ni le portail socio — les 8 parcours de création/édition réels utilisaient un `toast.success(...)` immédiatement suivi d'un `router.push`, sans jamais dire à un partenaire que sa soumission attend une révision.

## 2. Portée

**In** : wizard de création produit (5 types) et établissement, édition en sections/cartes pour les deux, écran de confirmation sur les 6 parcours de soumission réels (produit admin/socio création, produit admin édition, établissement admin création/édition, établissement partenaire création/édition).
**Out** : redesign visuel des champs propres aux formulaires partenaire (`NewEstablishmentProposalForm`/`EditEstablishmentProposalForm`) — seule la confirmation y est ajoutée, jamais prototypés visuellement par ailleurs. Correction du bug transport (double champ prix). Fusion des 9 blocs d'édition établissement en un seul submit (resterait une vraie décision d'architecture, jamais demandée).

## 3. Décisions retenues

Réouverture assumée et tracée (même discipline que spec 11 §3 pour la décision i18n du nom) de `docs/specs/11-admin-activite-parcours-unifie-creneaux.md:180` : ce qui rouvre est la présentation (étapes visibles), jamais le nombre de composants (1) ni de soumissions (1) — garde-fou confirmé explicitement par Jérôme. Le wizard établissement est un terrain neuf (specs 03/06 décrivent champs/RPC, jamais la mise en page).

## 4. Parcours cible

1. Admin ouvre `/admin/products/new`, avance Établissement+Type+Nombre+Descripción (étape 1, validée) → Detalles propres au type + Fotos (étape 2) → Comercialización (étape 3, dernier clic = soumission réelle).
2. Une erreur de validation à n'importe quelle étape affiche le toast et ramène sur l'étape fautive (`setStepIndex`), jamais une étape masquée sans indice.
3. Succès → écran de confirmation (badge + titre + corps + action), jamais un toast qui s'efface tout seul. Admin : « ya publicado ». Partenaire (socio-proposal ou établissement) : « será revisado por un admin Hifago ».
4. Édition établissement : chaque bloc à bouton explicite affiche sa PROPRE confirmation contenue dans sa carte au clic sur « Guardar » — les 8 autres blocs de l'écran restent visibles et inchangés.

## 5. Écran(s)

Cf. tableau §0 pour la composition exacte par type/étape. Stepper (`wizard-stepper.tsx`) : une seule grille CSS (pastilles + trait + libellés), jamais deux — piège vérifié en réel sur le prototype (deux grilles séparées auto-dimensionnent leurs colonnes indépendamment, donc désalignent tout même avec le même gabarit de colonnes déclaré deux fois). Formulaires centrés (`self-center`, pas `mx-auto` — le parent est un `flex flex-col`, où le centrage bloc classique ne s'applique pas de la même façon) et élargis (`max-w-3xl` établissement/`max-w-2xl`→`max-w-3xl` produit) pour mieux occuper l'espace desktop, retour Jérôme après premier rendu réel.

## 10. Décisions tranchées / points ouverts

- **Tranché** : les 4 blocs établissement à bouton explicite (Stay/Contact/Pms en plus d'EditBlock) reçoivent tous la confirmation contenue — déjà traités de façon identique dans le prototype validé (même action `save`), pas une extension silencieuse.
- **Tranché** : le champ prix simple de camp est gardé (régression fonctionnelle sinon, jamais demandée).
- **Ouvert, non bloquant** : le bug transport (double champ Precio) devient plus visible maintenant que les deux rendent dans la même étape — non corrigé ici, cf. `docs/dette-technique.md`.
- **Ouvert, non bloquant** : le wizard s'applique-t-il un jour à l'écran de proposition socio produit (`variant="socio-proposal"`, déjà dans le même composant) au-delà de sa confirmation déjà branchée ? Pas demandé, pas fait.

## 11. Annexe — traçabilité code→règle

| Section | Fichiers |
|---|---|
| Étapes produit, mécanisme `section` | `apps/admin/components/product-form.tsx`, `apps/admin/components/product-type-fields/*.tsx` |
| Validation par étape | `apps/admin/lib/products/productFormRequiredFields.ts` |
| Étapes établissement | `apps/admin/app/admin/establishments/new/NewEstablishmentForm.tsx` |
| Confirmation contenue établissement | `apps/admin/app/admin/establishments/[id]/{EstablishmentEditBlock,EstablishmentStayBlock,EstablishmentContactBlock,EstablishmentPmsBlock}.tsx` |
| Confirmation partenaire | `apps/admin/app/partner/(app)/establishment/{new/NewEstablishmentProposalForm,[id]/edit/EditEstablishmentProposalForm}.tsx` |
| Composants partagés | `apps/admin/components/{action-confirmation,wizard-stepper}.tsx` |

## 12. Documents liés

`docs/specs/11-admin-activite-parcours-unifie-creneaux.md` (décision réouverte), `docs/specs/03-admin-creation-etablissement.md` et `06-gestion-etablissement.md` (champs/RPC établissement, inchangés), `docs/dette-technique.md` (bug transport), `.claude/rules/ui.md` (design system).
