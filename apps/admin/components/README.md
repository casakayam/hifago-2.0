# Composants d'`apps/admin`

Convention relevée du code déjà écrit, jamais formalisée avant la revue de packaging du
2026-09-17. Quand une règle contredit un fichier existant récent, c'est le fichier qui a tort ;
quand ce document contredit `hifago/CLAUDE.md`, c'est CLAUDE.md qui fait foi.

## Nommage

**kebab-case** pour tout nouveau fichier : `product-form.tsx`, `stay-rates-editor.tsx`. Vérifié en
CI par `scripts/check-admin-components-naming.sh` (`npm run lint` ne le lance pas — c'est un job
séparé du pipeline `hifago-ci`, cf. CLAUDE.md §11.20 : une règle que rien ne vérifie n'est pas une
règle).

*Cinq fichiers PascalCase préexistent (`GoogleButton.tsx`, `ContactClientButton.tsx`,
`EmptyStateCta.tsx`, `LogoutButton.tsx`, `ModifyOrderLineDialog.tsx`) — exemption historique
nommée dans le script de vérification, **pas renommés** (coût de revue disproportionné pour un
gain cosmétique), et **pas un précédent** : un nouveau fichier est en kebab-case, sans exception.*

À la différence d'`apps/web/components/` (100 % PascalCase, atoms/molecules/organisms), cette
convention n'a jamais été à revoir : elle documente simplement ce qui existait déjà.

## Organisation — plat par défaut, sous-dossier seulement pour un groupe

Le dossier est **à plat** (aucun `atoms/`/`molecules/`/`organisms/` équivalent à `apps/web`) — ce
n'est pas un oubli, c'est le constat de la revue : contrairement à la vitrine, la plupart des
composants d'admin sont soit des éditeurs autonomes à une seule responsabilité
(`stay-rates-editor.tsx`, `tags-multiselect.tsx`), soit consommés par un seul écran et déjà
colocalisés dans `app/admin/**`/`app/partner/**` (`NewEstablishmentForm.tsx`, les blocs
`*Block.tsx` à sauvegarde immédiate) — la hiérarchie à 3 niveaux de la vitrine n'a pas d'équivalent
naturel ici.

**Un sous-dossier se justifie uniquement pour un groupe de fichiers qui appartiennent ensemble** —
typiquement un composant volumineux découpé en plusieurs fichiers avec un point d'entrée unique
(`index.tsx`). `product-type-fields/` (chantier de découpage des god components, 2026-09-17) en est
le premier exemple. On ne remonte JAMAIS un sous-dossier par anticipation, même esprit que
`packages/` (CLAUDE.md §2.1).

## Composant lié à une seule route

Reste colocalisé dans `app/admin/**`/`app/partner/**` — déjà le cas de la majorité des formulaires
d'écran (`NewEstablishmentForm.tsx`, `NewPartnerForm.tsx`, `ModerateProposalForm.tsx`, tous les
blocs `*Block.tsx`). On ne remonte dans `components/` que ce qui sert au moins deux endroits.

## Opportunité différée, pas exécutée dans cette revue

Quatre éditeurs de tarification partagent un même patron (`value`/`onChange` contrôlé, aucune
logique réseau) sans être regroupés : `stay-rates-editor.tsx`, `price-tiers-editor.tsx`,
`slot-rules-editor.tsx`, `program-editor.tsx`. Regroupement possible sous `editors/` — à faible
risque (1-2 sites d'import chacun), mais pas exécuté ici faute de justifier une revue à part pour
un gain purement organisationnel. Signalé pour la prochaine fois qu'un agent touche l'un de ces
quatre fichiers.

## `GoogleButton.tsx` — un second exemplaire existe côté vitrine

`apps/web/components/molecules/GoogleButton.tsx` n'est **pas** une extraction manquée : diff
vérifié (revue du 2026-09-17), divergence réelle et substantielle (i18n, fusion panier anonyme,
gestion d'erreur en ligne vs toast). Raison complète en tête de chacun des deux fichiers. Statu quo
confirmé — CLAUDE.md §2.1 : un module ne monte dans `packages/` que s'il est prouvé consommé à
l'identique par les deux apps.

## Ce que ce document ne couvre pas

Design system (carte besoin → bibliothèque, responsive, thèmes) : `.claude/rules/ui.md`. Frontière
Server/Client Component, formulaires : `.claude/rules/apps.md`. Les deux sont chargées dès qu'un
fichier de `components/` est ouvert — ce README ne les recopie pas.
