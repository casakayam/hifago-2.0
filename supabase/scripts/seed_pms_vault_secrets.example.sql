-- Spec 21 — Connecteur LobbyPMS. Template documenté (même esprit que .env.example) pour poser les
-- deux secrets Vault consommés par invoke_pms_poll_bookings()/invoke_pms_nightly_contract_check()
-- (migration 20260819140000_pms_jobs_cron.sql) — JAMAIS de vraie valeur commitée dans ce fichier.
--
-- Usage local :
--   1. Copier ce fichier (jamais l'éditer en place) : cp supabase/scripts/seed_pms_vault_secrets.example.sql /tmp/seed_pms_vault_secrets.local.sql
--   2. Remplacer les deux valeurs ci-dessous — en local, l'URL est http://127.0.0.1:54321 (ou
--      http://host.docker.internal:54321 si l'appelant est un conteneur Edge Runtime distinct, cf.
--      supabase/functions/.env) et la clé service_role est celle imprimée par `npx supabase status`.
--   3. Appliquer : PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -f /tmp/seed_pms_vault_secrets.local.sql
--   4. Supprimer le fichier local une fois appliqué (jamais persisté, cf. hifago/CLAUDE.md §8.2 —
--      aucun token/secret n'est jamais écrit sur disque au-delà d'un usage ponctuel).
--
-- En préprod/prod : mêmes deux insertions, exécutées une fois par un humain via le SQL Editor du
-- projet Supabase concerné (jamais via une migration versionnée, qui serait identique partout
-- alors que ces valeurs ne le sont pas) — hors périmètre de cette spec (Tranche 1, développement
-- local uniquement).
select vault.create_secret('http://127.0.0.1:54321', 'pms_functions_base_url', 'Base URL des Edge Functions locales (connecteur PMS).');
select vault.create_secret('<COLLER_LA_SERVICE_ROLE_KEY_LOCALE_ICI>', 'pms_service_role_key', 'Clé service_role locale, jamais une valeur réelle de prod.');
