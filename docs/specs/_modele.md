---
id: specs-modele
titre: "Gabarit de spec de feature (à copier, ne décrit aucune feature réelle)"
theme: specs
public: [ia, dev, jerome]
langue: fr
statut: modele
maj: 2026-08-14
resume: >
  Gabarit à recopier pour spécifier une nouvelle fonctionnalité jusqu'au niveau prêt à coder.
mots_cles: [gabarit, modele, spec, feature, template]
repond_a:
  - "Quelle structure doit avoir une spec de feature ?"
---

> ⚠️ **Ce document ne décrit aucune feature réelle.** Le copier vers
> `docs/specs/<NN>-<slug-kebab>.md`, remplacer les `<…>`, puis ajouter la ligne au tableau de
> [`README.md`](README.md) et lancer `npm run docs:index`.

---
id: specs-<slug>
titre: "<Titre court de la feature>"
theme: specs
public: [ia, dev, jerome]
langue: fr
statut: brouillon
maj: <AAAA-MM-JJ>
resume: >
  <Une phrase : ce que fait la feature et pour qui.>
mots_cles: [<mots clés>]
repond_a:
  - "<Question à laquelle ce document répond>"
---

# <Titre de la feature>

> **Cible stack** : <hifago | legacy | les deux>. **Feature n°<N>** si applicable (numéro de
> build hifago, distinct du numéro de fichier `NN-` ci-dessus qui est un compteur de docs).

## Sommaire et statut

| # | Section | Statut |
|---|---|---|
| 1 | Contexte et problème | brouillon |
| 2 | Portée | brouillon |
| 3 | Décisions retenues | brouillon |
| 4 | Parcours cible | brouillon |
| 5 | Écran(s) | brouillon |
| 6 | Modèle de données | brouillon |
| 7 | Contrat API/RPC | brouillon |
| 8 | Règles et invariants | brouillon |
| 9 | Cas limites | brouillon |
| 10 | Décisions tranchées / points ouverts | brouillon |
| 11 | Annexe — traçabilité code→règle | brouillon |
| 12 | Documents liés | brouillon |

---

## 1. Contexte et problème

<!-- Pourquoi cette feature : ce qui existe aujourd'hui (legacy et/ou décision déjà validée),
     le manque constaté, ce qui déclenche la spec maintenant. Toujours ancré dans du réel —
     jamais une hypothèse. -->

## 2. Portée

<!-- Ce que la feature couvre (in) et ce qu'elle renvoie explicitement à une autre spec/un autre
     lot (out). -->

## 3. Décisions retenues

<!-- Décisions déjà actées ailleurs (cahier des charges, échange avec Jérôme) qui s'appliquent
     ici et ne sont pas rouvertes. -->

## 4. Parcours cible

<!-- Le chemin utilisateur/système pas à pas, du déclenchement au résultat final. -->

## 5. Écran(s)

<!-- Regroupement fonctionnel des champs/actions par écran ou par bloc. -->

## 6. Modèle de données

<!-- Table par table : ce qui existe déjà et se réutilise tel quel, ce qui existe mais est mort
     et à activer, ce qui n'existe pas et est à créer — avec la justification de chaque ajout. -->

## 7. Contrat API/RPC

<!-- Signature(s) candidates, squelette de sécurité réutilisé (référence au squelette déjà
     validé du projet, jamais réinventé). -->

## 8. Règles et invariants

<!-- Ce qui doit rester vrai après cette feature, y compris les invariants transverses déjà en
     vigueur ailleurs dans le système. -->

## 9. Cas limites

<!-- Situations exceptionnelles et leur traitement attendu. -->

## 10. Décisions tranchées / points ouverts

<!-- Pour chaque point non couvert par le contexte ou une décision déjà validée : soit une
     décision tranchée ici avec sa justification (ancrée dans l'existant), soit un point
     explicitement laissé ouvert pour arbitrage. Ne jamais trancher en silence. -->

## 11. Annexe — traçabilité code→règle

<!-- Table Section | Fichiers sources (legacy et/ou cible). -->

## 12. Documents liés

<!-- Cahiers des charges, autres specs, docs de référence. -->
