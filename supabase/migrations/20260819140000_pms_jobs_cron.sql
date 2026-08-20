-- Spec 21 — Connecteur LobbyPMS, Phase 6 : jobs planifiés (poll + contrôle de dérive nocturne).
-- Pattern retenu (hifago/docs/04-architecture-cible.md § Jobs planifiés et connecteur PMS) :
-- pg_cron déclenche, via pg_net, un appel HTTP vers une Edge Function — contrairement à
-- expire_stale_payment_orders (20260818230000, fonction SQL directe, AUCUN appel réseau), le
-- connecteur PMS a besoin d'un vrai appel sortant, d'où pg_net ici.
--
-- Secrets via Supabase Vault (pattern officiel — jamais un secret en clair dans une migration
-- versionnée, identique partout). Deux secrets nommés, seedés SÉPARÉMENT par environnement
-- (jamais dans cette migration) : voir supabase/scripts/seed_pms_vault_secrets.example.sql.
--   pms_functions_base_url : URL de base des Edge Functions (ex. http://127.0.0.1:54321 en local,
--     l'URL du projet en préprod/prod).
--   pms_service_role_key   : clé service_role, envoyée en Authorization: Bearer (satisfait le
--     verify_jwt par défaut des Edge Functions — un service_role key est un JWT valide signé du
--     même secret).
--
-- Fréquence/lot tranchés par Jérôme (spec 21 §10 point 6) : poll toutes les 15 min (lot de 20,
-- porté par claim_pms_poll_batch, migration 20260819120000) ; contrôle de dérive 1×/jour, en
-- lecture seule sur le compte réel Casa Kayam (aucun sandbox LobbyPMS n'existe, spec 21 §10 point 1
-- — jamais en écriture, jamais bloquant CI).
create extension if not exists pg_net with schema extensions;

create or replace function invoke_pms_poll_bookings()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_base_url text;
  v_key text;
begin
  select decrypted_secret into v_base_url from vault.decrypted_secrets where name = 'pms_functions_base_url';
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'pms_service_role_key';
  if v_base_url is null or v_key is null then
    raise warning 'pms_poll_bookings : secrets Vault manquants — job ignoré (cf. supabase/scripts/seed_pms_vault_secrets.example.sql)';
    return;
  end if;
  perform net.http_post(
    url := v_base_url || '/functions/v1/pms-poll-bookings',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
    body := '{}'::jsonb,
    timeout_milliseconds := 25000
  );
end;
$$;

create or replace function invoke_pms_nightly_contract_check()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_base_url text;
  v_key text;
begin
  select decrypted_secret into v_base_url from vault.decrypted_secrets where name = 'pms_functions_base_url';
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'pms_service_role_key';
  if v_base_url is null or v_key is null then
    raise warning 'pms_nightly_contract_check : secrets Vault manquants — job ignoré';
    return;
  end if;
  perform net.http_post(
    url := v_base_url || '/functions/v1/pms-nightly-contract-check',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
    body := '{}'::jsonb,
    timeout_milliseconds := 25000
  );
end;
$$;

-- Aucun grant à anon/authenticated/service_role : appelées uniquement par pg_cron (rôle
-- propriétaire), même posture que expire_stale_payment_orders.
select cron.schedule('pms-poll-bookings', '*/15 * * * *', $$select invoke_pms_poll_bookings();$$);
select cron.schedule('pms-nightly-contract-check', '0 7 * * *', $$select invoke_pms_nightly_contract_check();$$);
