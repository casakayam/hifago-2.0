-- Planification du remplissage du miroir de disponibilité LobbyPMS (20260917140000).
-- Miroir exact d'invoke_pms_cancel_bookings (20260827170000), y compris son garde-fou Vault.
--
-- FRÉQUENCE : toutes les 5 minutes, lot de 6 couples (établissement, mois) par passage — donc au
-- PIRE 1,2 appel LobbyPMS par minute, contre un plafond mesuré à 60 par fenêtre glissante d'une
-- minute (2026-08-28), partagé avec les trois autres crons PMS et avec les réservations elles-mêmes.
--
-- Le calcul qui justifie ce réglage, et qui est le point de tout le dispositif : le débit est fixé
-- par le LOT, jamais par le nombre d'établissements ni par le trafic. Un établissement de plus
-- n'ajoute aucun appel par minute — il allonge seulement le délai de rafraîchissement. En régime
-- permanent, la fraîcheur différenciée de `claim_pms_sync_batch` (2 h pour les deux mois proches,
-- 24 h pour les quatre suivants) fait qu'avec 20 établissements il n'y a qu'environ 23 couples dus
-- par HEURE — très en dessous de ce que ce cron peut absorber. Le jour où ça se resserre, c'est
-- `p_limit` (corps de l'Edge Function) et cette fréquence qu'il faut relire, pas le code.
--
-- ⚠️ Leçon du 2026-08-27, à répéter ici parce qu'elle a coûté huit jours : un cron qui « existe »
-- n'aboutit pas pour autant. Les trois jobs PMS ont tourné À VIDE en silence du 19 au 27 août faute
-- du secret `pms_service_role_key` dans le Vault — `raise warning`, et `net._http_response` est
-- resté vide. Après tout déploiement : VÉRIFIER `net._http_response`, jamais se fier à l'absence
-- d'erreur. Et une Edge Function n'existe pas tant qu'elle n'est pas déployée
-- (`supabase functions deploy pms-sync-availability`).

create or replace function invoke_pms_sync_availability()
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
    raise warning 'pms_sync_availability : secrets Vault manquants — job ignoré (cf. supabase/scripts/seed_pms_vault_secrets.example.sql)';
    return;
  end if;
  perform net.http_post(
    url := v_base_url || '/functions/v1/pms-sync-availability',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
    -- Le lot est explicite ici, pas seulement dans le défaut TypeScript de l'Edge Function
    -- (`limit = 6`) : l'en-tête de ce fichier ANNONCE « lot de 6 » comme un fait du cron, or rien
    -- ici ne le fixait — un défaut modifié côté Edge Function aurait changé le débit réel sans
    -- qu'aucune migration ne le dise (20260918170000).
    body := '{"limit": 6}'::jsonb,
    timeout_milliseconds := 25000
  );
end;
$$;

-- Appelée uniquement par pg_cron (rôle propriétaire). Le `revoke` est explicite et non optionnel :
-- PostgreSQL accorde EXECUTE à PUBLIC sur toute nouvelle fonction (sens INVERSE des tables) — sans
-- lui, n'importe quel visiteur anonyme pourrait déclencher le job à volonté, et donc brûler le
-- quota LobbyPMS de tous les partenaires. Même posture que ses trois jumelles (20260828002053).
revoke all on function invoke_pms_sync_availability() from public, anon, authenticated;

select cron.schedule('pms-sync-availability', '*/5 * * * *', $$select invoke_pms_sync_availability();$$);
