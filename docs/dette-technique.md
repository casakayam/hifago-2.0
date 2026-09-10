---
id: dette-technique
titre: "Dette technique et QA/UI connue — hifago"
theme: journal
statut: vivant
langue: fr
maj: 2026-09-08
resume: >
  Dette signalée et non corrigée du chantier hifago — technique, puis QA/UI mineure. Sortie de
  docs/backlog.md le 2026-09-08 : ce fichier-là plafonne à 60 lignes et prescrit lui-même qu'un
  groupe entier parte en ticket séparé quand il déborde.
mots_cles: [dette, technique, qa, ui, connu, non-corrige, hifago]
repond_a:
  - "Quelle dette est connue et assumée ?"
  - "Ce défaut est-il déjà signalé ou est-ce une découverte ?"
---
# Dette technique et QA/UI connue

> **Règles pour l'IA** : même discipline que `docs/backlog.md` — 1 ligne par point, le récit va au
> journal. Ce fichier porte ce qui est CONNU, ASSUMÉ et NON CORRIGÉ ; les points qui attendent une
> décision de Jérôme restent au backlog, qui est le fichier court qu'on lit en premier.
> ⚠️ Un point trouvé ici n'est pas une découverte : ne pas le re-diagnostiquer, ne pas le rouvrir
> comme s'il était neuf.

## Dette technique signalée, non corrigée
- Spec 19 Tranche 2 (remboursement Mercado Pago) non commencée ; page de retour paiement dédiée toujours absente (réutilise l'écran checkout).
- Vitrine (`apps/web`) : polices Geist non appliquées (`--font-geist-*` du layout vs `--font-sans`/`--font-mono` consommés par HeroUI).
- La garde de `(cuenta)` redirige vers `/entrar` SANS `?next=` : un layout serveur ne connaît pas le chemin courant, et la « ligne dans `proxy.ts` » annoncée par la spec 27 §5 n'en est pas une (un middleware ne peut pas poser d'en-tête de REQUÊTE sur une réponse construite par `intlMiddleware`). Sans effet tant qu'il n'existe qu'un écran de compte — vrai déclencheur : le lot qui ajoute `/cuenta` et `/cuenta/perfil`.
- Remplacer une image du catalogue laisse l'ancien objet dans le bucket `catalog-media` — vrai pour `product_media`/`establishment_media` depuis la spec 04, et vrai pour l'image de catégorie que la spec 29 ajoute. À traiter globalement ou pas du tout : le corriger pour une seule entité créerait une incohérence de plus.
- Bricoles signalées, non reprises : `createTtlCache` ne purge jamais les entrées expirées (Map non bornée) · `addDaysIso` (`bogotaDates.ts:56`) porte le débordement d'année déjà corrigé ailleurs · `partner-agenda.spec.ts` ne nettoie pas derrière lui et se sabote après plusieurs runs · sonde à un appel LobbyPMS sur `start_date == end_date` jamais vérifiée.
- Specs 17 (§ invariants) et 20 (l.73) portent encore la règle « PII minimale côté socio » (jamais `holder_phone`/`holder_email`), renversée par Jérôme le 2026-08-19 (migration `20260819180000`) — signalée dans les « Écarts connus » du cahier 02, pas encore corrigée dans le texte des deux specs.
- Les quatre cahiers (00-03) portent leurs écarts en en-tête « Écarts connus » plutôt que dans leurs sections : réécrire les sections elles-mêmes est un geste de fond à valider avec Jérôme, section par section (statut de validation à reprendre).

## Dette trouvée par `/simplify` le 2026-09-08
- **`server-only` n'est installé nulle part**, alors que la spec 27 §7, la spec 30 §7b et l'en-tête de `scripts/check-data-layer.sh` le décrivaient comme acquis (en-tête corrigé le 2026-09-08). Conséquence non couverte : un composant CLIENT qui importerait `lib/catalog/` embarquerait la clé anonyme et le graphe Supabase dans le bundle, sans erreur ni contrôle rouge. Décision d'une ligne — ajouter la dépendance ou non.
- **`SearchAction` JSON-LD : à décider, plus à écarter.** `lib/seo/jsonld/site.ts` l'excluait parce que « la recherche est un filtre en mémoire sans URL adressable » — faux depuis la spec 28, les critères vivent dans l'URL. Le nœud reste sans `potentialAction` par non-décision.
- **Sept `data-testid` posés le 2026-09-08 qu'aucun test n'exerce** (`indice-categorias`, `establishment-info`, `establishment-address`, `volver-al-catalogo`, `vitrina-contact-link`, `price-label-vitrina-input`, `establishment-contact-block`). Des ancres prêtes, pas du code mort — à ne pas supprimer, à consommer quand la couverture des deux fiches et de l'admin éditorial s'étendra.

## Dette QA/UI mineure connue
les tests e2e parallèles se disputent encore les 8 places d'une section pendant une MÊME exécution (`cart-multi-establishment` passe seul, échoue en suite) — le `globalTeardown` ajouté le 2026-09-08 empêche l'accumulation ENTRE exécutions, pas la concurrence intra-suite ; il faudrait des données scopées par test · le fil d'Ariane HeroUI rend la page courante en `<span role="link" aria-disabled>` : un lecteur d'écran annonce « lien désactivé », anti-motif WAI-ARIA — `aria-current` est correct, le reste vient du socle · Palette SVAR non harmonisée avec HeroUI · pas de refetch agenda au changement de vue · e2e spec 18 (créneaux horaires) absents · tri/filtre catalogue par tag manquant · Tranche 4 spec 17, Tranche 2 specs 11/12/13 · `waitForLoadState` sur `admin-camp-booking.spec.ts` · `LocalizedTextField` lot 2 établissement · `admin-evento-vitrine.spec.ts` (`#name-es`) · sidebar admin non repliée sous `md` · activer les créneaux jetski réels via `set_product_slot_capacity` · 6 fichiers pgTAP sensibles au volume de données locales accumulées (`audit_log` non scopé) · `admin-reconciliation.spec.ts`/`admin-home-navigation.spec.ts` fragiles en exécution parallèle · échec Vitest non identifié, DEUX fois le 2026-09-07 (1 puis 2 tests), toujours dans un `npm run test` monorepo enchaîné après typecheck+lint, jamais reproduit ensuite en ~15 exécutions — nom jamais capturé, sortie non conservée.

Historique complet de chaque point (comment on y est arrivé) : `docs/journal/<mois>.md`.

## Dette produit/admin déplacée du backlog le 2026-09-10

> Sortie de `docs/backlog.md` parce qu'il dépassait son plafond de 60 lignes — sa propre règle prescrit qu'un groupe entier parte plutôt que d'élaguer au hasard. **Rien n'a été supprimé.** Un point qui se trouve ici est CONNU : ne pas le re-diagnostiquer.

- **Le bucket `catalog-media` grossit sans garde-fou** (mesuré le 2026-09-08 : 37 objets `.webp` orphelins, `product_media`/`establishment_media` à 0 ligne) — `cleanup.ts` purge les lignes SQL par CASCADE, jamais les binaires. Distinct de la dette « image orpheline au remplacement » : ici c'est l'accumulation par les e2e admin, et elle ne figurait nulle part.
- **`products.check_in_time`/`check_out_time` : la RÈGLE est tranchée** (l'établissement fait seul foi, spec 30 §3.4), le NETTOYAGE non — la colonne reste éditable dans 6 fichiers d'`apps/admin` et dans le payload JSONB des propositions socio (3 chemins de modération). Un admin peut saisir un horaire qu'aucune page publique n'affichera. Lot admin à part.
- **Rien n'empêche de publier un evento sans `external_booking_url`** — sa fiche affiche alors son occurrence et AUCUN moyen de réserver : un cul-de-sac silencieux, comportement actuel préservé et nommé par la spec 30 §10.5. La garde manque côté admin.
- **L'UPDATE de `moderate_product_proposal` écrit ses colonnes INCONDITIONNELLEMENT** (constaté le 2026-09-09 en écrivant son test) — une proposition dont le payload ne porte pas une clé EFFACE la colonne correspondante à l'approbation, jusqu'à violer une contrainte (`products_price_cop_required_unless_vitrine` déclenchée en réel). Seules `external_booking_url`/`price_label` en sont exemptées (forme `case when payload ? 'clé'`, migration 20260909180000) ; les ~15 autres colonnes gardent le défaut.
- **Un evento reste le seul type dont l'URL de vitrine n'est pas modifiable** — ni côté admin (bloc `isEvento ? {} : …` de product-form.tsx et productEditPayload.ts), ni donc côté socio. Le cas NON-evento a été refermé le 2026-09-09 (whitelist SQL élargie, migration 20260909180000) ; la whitelist accepte désormais ces clés pour TOUS les types, il ne reste que le geste d'écran.
- **Rien ne teste la création admin d'un produit** — ni `buildProductCreationPayload` ni `product-form.tsx` n'ont de test unitaire, et la seule couverture réelle (`admin-product-create.spec.ts`) est dans la suite e2e en pause. Le correctif vitrine du 2026-09-09 n'est donc protégé par rien (§11.20).
- ⚠️ **La suite pgTAP est INEXPLOITABLE après une exécution e2e** (constaté deux fois le 2026-09-08) : six fichiers comptent `audit_log` en absolu, et tout e2e admin y écrit. `npm run db:setup` la referme. Ce n'est pas une régression — c'est la même dette que la ligne « 6 fichiers pgTAP sensibles au volume » ci-dessous, mais sa CONSÉQUENCE méritait d'être nommée : un chiffre pgTAP mesuré après des e2e ne veut rien dire.
- ⚠️ **`Migas` rend des `<a href>` NATIFS, donc le fil d'Ariane provoque une navigation COMPLÈTE** — il viole l'invariant 9 de la spec 27 depuis sa création (`Breadcrumbs.Item` étend le `Link` de react-aria, pas celui de `@/i18n/navigation`). Invisible sur un listing, sérieux sur une fiche : **cliquer le fil vide le panier**, tenu en mémoire. Deux corrections possibles, aucune triviale : un `RouterProvider` react-aria (ABSENT de la version installée, vérifié le 2026-09-08) ou le panier persistant (cahier §2b.6, déjà décidé, spec à écrire). En attendant, la fiche produit garde son lien « ← Volver al catálogo », qui est le seul lien client-side vers l'accueil — ne pas le supprimer en le prenant pour un doublon.
