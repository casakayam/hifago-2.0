-- C2 (spec 25) — planification du drainage de pms_cancellation_queue. Miroir exact de
-- invoke_pms_poll_bookings (20260819140000), y compris son garde-fou « secrets Vault manquants ».
--
-- FRÉQUENCE : toutes les 10 minutes, un peu plus serré que le poll (15 min). La raison est
-- asymétrique : un poll en retard fait découvrir tardivement une annulation faite par le
-- partenaire, sans conséquence pour personne ; une annulation hifago en retard laisse une chambre
-- BLOQUÉE chez le partenaire, qui ne peut pas la revendre. Le coût côté Lobby est nul en régime
-- normal — la file est vide, le job ne fait qu'un SELECT.
--
-- ⚠️ Leçon du 2026-08-27 : ces jobs n'avaient JAMAIS abouti depuis leur création, faute du secret
-- `pms_service_role_key` dans le Vault — ils sortaient en `raise warning`, en silence, et
-- `net._http_response` est resté vide pendant huit jours. Le garde-fou ci-dessous est nécessaire
-- mais il ne suffit pas : après tout déploiement, vérifier `net._http_response` plutôt que de se
-- fier à l'absence d'erreur.

create or replace function invoke_pms_cancel_bookings()
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
    raise warning 'pms_cancel_bookings : secrets Vault manquants — job ignoré (cf. supabase/scripts/seed_pms_vault_secrets.example.sql)';
    return;
  end if;
  perform net.http_post(
    url := v_base_url || '/functions/v1/pms-cancel-bookings',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
    body := '{}'::jsonb,
    timeout_milliseconds := 25000
  );
end;
$$;

-- Aucun grant à anon/authenticated/service_role : appelée uniquement par pg_cron (rôle
-- propriétaire), même posture que ses deux jumelles.
select cron.schedule('pms-cancel-bookings', '*/10 * * * *', $$select invoke_pms_cancel_bookings();$$);
