-- Spec 23 Tranche 1 — dispatch planifié de la file notification_emails. Miroir exact de
-- invoke_pms_poll_bookings() (supabase/migrations/20260819140000_pms_jobs_cron.sql) : réutilise
-- TELS QUELS les secrets Vault pms_functions_base_url/pms_service_role_key (valeur déjà générique
-- — URL de base des Edge Functions + clé service_role du projet, rien de spécifique PMS malgré le
-- nom) — aucun fichier PMS existant modifié.
--
-- Fréquence proposée (spec 23 §10 point 11, à valider par Jérôme) : 5 min / lot de 20 — plus
-- fréquent que le poll PMS (15 min) car une invitation/notification admin bénéficie d'une latence
-- plus courte qu'une reconciliation PMS de fond.
create or replace function invoke_send_notification_emails()
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
    raise warning 'send_notification_emails : secrets Vault manquants (pms_functions_base_url/pms_service_role_key) — job ignoré';
    return;
  end if;
  perform net.http_post(
    url := v_base_url || '/functions/v1/send-notification-emails',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
    body := '{}'::jsonb,
    timeout_milliseconds := 25000
  );
end;
$$;

-- Aucun grant à anon/authenticated/service_role : appelée uniquement par pg_cron (rôle
-- propriétaire), même posture que invoke_pms_poll_bookings/expire_stale_payment_orders.
select cron.schedule('send-notification-emails', '*/5 * * * *', $$select invoke_send_notification_emails();$$);
