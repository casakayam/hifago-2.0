-- Checkpoint B (premier écran réel) — products.slug. Décision d'architecture du 2026-08-12
-- (00-modele-de-donnees.md §1) : une fiche produit publique a besoin d'une URL stable et lisible,
-- distincte de l'id technique interne. Absente de la Tranche 2 (aucune fiche publique n'existait
-- encore) ; ajoutée maintenant, premier moment où /[locale]/products/[slug] existe vraiment.
-- RLS inchangée : products reste RLS directe (Tranche 2), aucun des critères RPC-only ne
-- s'applique à une simple colonne texte. products.id est encore vide à ce stade des migrations
-- (le seed s'exécute après), donc pas de backfill nécessaire pour poser la contrainte.
alter table products add column slug text not null unique;
