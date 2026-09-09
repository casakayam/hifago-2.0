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
