---
id: specs-avant-la-spec
titre: "Avant d'écrire une spec — poser les bonnes questions"
theme: specs
public: [ia, dev, jerome]
langue: fr
statut: modele
maj: 2026-08-15
resume: >
  Checklist de clarification à suivre AVANT de copier _modele.md — comment interroger Jérôme sur
  une feature pour que l'ambiguïté soit tranchée avant l'écriture de la spec, pas découverte en
  codant. Adapté de règles qui ont émergé sur un autre projet, recoupées avec les conventions déjà
  en vigueur ici (hifago/CLAUDE.md, hifago-migration, hifago-review).
mots_cles: [clarification, questions, ambiguite, avant spec, requirements, cahier des charges]
repond_a:
  - "Comment un agent doit-il comprendre une feature et poser les bonnes questions avant d'écrire une spec ?"
  - "Que faire quand une règle métier est vague ou qu'un terme de Jérôme est ambigu ?"
---

# Avant d'écrire une spec — poser les bonnes questions

> Ce document porte sur la phase de **clarification**, avant même d'ouvrir `_modele.md`. Il ne
> remplace pas le gabarit — il évite d'arriver au gabarit avec des trous qu'on comble en devinant.
> Fil conducteur : toute ambiguïté qui affecterait un test (type, code retour, message, ordre des
> gardes, séquence d'événements) doit être tranchée **avant** l'écriture de la spec, pas après.

## 1. Les champs du domaine, un par un — jamais en vrac

Pour toute nouvelle table/colonne touchée par la feature, trancher explicitement, colonne par
colonne : type exact, nullable ou pas, format réel (JSONB multilingue `{es:…, en:…}` ou texte
simple ? uuid — FK vers quelle table exactement ?). Ne jamais deviner un type ou une structure.

Coût réel déjà observé sur ce projet quand ce n'est pas fait en amont : specs 03 et 08 ont chacune
dû revenir sur un champ nom `nameEs`/`nameEn` deviné bilingue, corrigé après coup en champ unique
(« un nom d'établissement/d'activité n'est généralement pas traduit ») — un aller-retour évitable
si la question avait été posée avant d'écrire le modèle de données.

## 2. Rendre une règle métier vague concrète et testable

Une règle métier qui ne se traduit pas en assertion de test n'est pas encore assez précise. Pour
chaque garde-fou, trancher : le code d'erreur exact (`not_authenticated`, `name_required`, pas
juste « erreur si invalide »), l'ordre exact dans lequel les gardes sont évaluées (l'ordre compte —
voir §7 des specs déjà écrites, toujours numéroté), et le nombre exact d'un plafond (« au plus
**une** proposition `pending` », pas « un plafond raisonnable »). C'est déjà la pratique dans les
specs 01-08 (section Contrat API/RPC) — l'objectif ici est de l'obtenir **pendant l'échange**, pas
de la reconstruire seul après coup à partir d'un cahier des charges resté vague sur ce point.

## 3. Reformuler l'interprétation avant de l'implémenter, surtout sur un terme flou

Un terme ambigu mal interprété se propage dans tout le code s'il n'est pas corrigé à la source.
Citer le texte exact de Jérôme (ou du cahier des charges) entre guillemets, puis proposer
l'interprétation explicitement (« je comprends que tu veux dire… ») avant d'écrire quoi que ce
soit — jamais deviner silencieusement. C'est déjà la méthode utilisée dans le §1 « Contexte » des
specs existantes (citations directes suivies de la décision qui en découle) ; l'appliquer aussi
**pendant** l'échange oral/chat, pas seulement en le documentant après.

## 4. Distinguer « je propose un défaut raisonnable » de « je dois demander »

Pour un point mineur, proposer directement avec justification, à valider en passant. Pour un point
qui change l'architecture, le modèle de données ou une invariant de sécurité, **demander avant
d'écrire du code**. Cette distinction est déjà une règle explicite du projet, à deux endroits :
`hifago/CLAUDE.md` §10 (« Hors périmètre — à ne jamais trancher sans Jérôme ») et
`.claude/skills/hifago-migration/SKILL.md` (« Si le cas n'est pas limpide : ne pas trancher seul »).
Rien à ajouter ici — juste l'appliquer aussi tôt que la phase de clarification, pas seulement au
moment d'écrire la migration.

## 5. Vérifier qu'une réponse courte couvre bien toute la question posée

Quand une question a plusieurs volets et que la réponse est un simple « oui », reposer la partie
non couverte plutôt que de supposer que tout est validé. **Ne pas confondre avec** la règle
« la parole de Jérôme fait foi » (`.agents/rules/global-instructions.md` règle 10, côté legacy) :
cette dernière dit de ne pas *re-vérifier* un fait déjà constaté (« ça marche », « c'est fait ») —
elle ne dit pas qu'une réponse ambiguë à une question à plusieurs volets doit être prise pour un
« oui » à tout. Les deux coexistent : un fait affirmé se prend pour acquis ; une question mal
couverte se repose.

## 6. Provoquer le challenge avant la première validation, pas seulement après le code

Générer proactivement les questions pas encore posées : cas limites (montant/quantité ≤ 0, double
soumission, retrait pendant modération), concurrence (deux écritures simultanées sur la même
ressource), cohérence RLS/RPC-only (cette table doit-elle vraiment être en écriture directe ?),
i18n (cette chaîne doit-elle vraiment être bilingue, ou est-ce un nom propre ?), collision entre
sessions parallèles (`hifago/AGENTS-PARALLELES.md`) — plutôt que d'attendre que ça casse en test ou
au gate `/hifago-review`. Ce projet a déjà l'outillage pour la version *a posteriori* de ce
principe (`/hifago-review`, 5 domaines, audit adversarial ; `/hifago-rpc-critique`, test de
concurrence obligatoire pour toute opération critique) — l'apport de cette règle est de déplacer
une partie de ce challenge **avant** la première validation de la spec, pas seulement en vérification
finale. Moins cher à corriger dans une phrase de clarification que dans une migration déjà écrite.

## 7. Un changement de comportement identifié ne se corrige jamais en silence

Un bug ou un écart trouvé en creusant une feature (même si la correction semble évidente) se
signale et attend le feu vert avant d'être touché — jamais corrigé au passage sans le dire. Déjà
une règle explicite du projet : `.agents/rules/global-instructions.md` règle 12 (« Périmètre
strict par défaut »), et `.claude/skills/hifago-review/SKILL.md` (« Tu rapportes, tu ne corriges
pas de ta propre initiative »). Les specs déjà écrites appliquent déjà ce principe correctement
(section « Écarts connus, sans lien avec cette feature » de la spec 06, par exemple) — le
maintenir dès la phase de clarification : un écart repéré en lisant le code existant se note et se
signale, il ne se corrige pas discrètement dans la même spec sans que Jérôme l'ait demandé.

---

## Ce qui est spécifique à ce projet, pas seulement repris d'ailleurs

- Les règles 4 et 7 étaient déjà quasi mot pour mot dans les règles existantes du projet — preuve
  que cette culture (signaler plutôt que trancher/corriger en silence) est déjà bien ancrée ici,
  pas une nouveauté à imposer.
- Les règles 5 et 6-avant-code sont le véritable ajout de valeur : rien dans les règles existantes
  ne couvrait explicitement « vérifier qu'un oui couvre toute la question » ni « challenger la
  spec avant la première validation plutôt qu'après le code ».
- Les règles 1, 2 et 3 étaient déjà pratiquées dans le contenu final des specs 01-08, mais nulle
  part écrites comme une checklist à suivre *pendant* l'échange qui précède leur rédaction — c'est
  ce que ce document ajoute.
