-- Fermeture de la fuite des colonnes de commission (docs/backlog.md, mesurée le 2026-09-11) —
-- étape D, la partie irréversible. Les 10 sites qui dépendaient de `order_lines_select` (branche
-- is_admin()), `order_lines_select_referrer` et `order_lines_select_operator` ont tous été
-- convertis en RPC security definer (20260922120000 à 20260922200000, vérifiés en conditions
-- réelles) — plus aucun chemin applicatif ne dépend du SELECT direct sur cette table.
--
-- Le SELECT sur order_lines pour authenticated/anon venait du défaut posé par
-- `alter default privileges ... grant select ... to anon, authenticated` (20260813163456), jamais
-- révoqué explicitement depuis. C'est ce défaut, combiné à des policies qui matchent la LIGNE
-- entière et jamais une colonne, qui permettait à un client de lire app_commission_cop via
-- PostgREST avec son propre jeton, peu importe ce que le code de l'app sélectionne.
revoke select on order_lines from authenticated, anon;

-- Les 3 policies SELECT deviennent structurellement inatteignables dès la ligne ci-dessus :
-- Postgres vérifie le GRANT sur la table avant d'évaluer RLS, donc aucune d'elles ne peut plus
-- jamais s'exécuter. Les garder serait une arme chargée oubliée sur la table : si `grant select`
-- était un jour réaccordé ponctuellement (debug, script one-off), elles redeviendraient
-- instantanément actives avec leur sémantique ligne-entière d'origine, commission comprise, sans
-- que personne n'ait eu à les réécrire. Un futur besoin de lecture directe scopée référent/
-- operator devra passer par une RPC ou une vue étroite (colonnes non-commission), jamais par la
-- résurrection d'une de ces policies — l'historique git suffit comme documentation.
drop policy order_lines_select on order_lines;
drop policy order_lines_select_referrer on order_lines;
drop policy order_lines_select_operator on order_lines;
