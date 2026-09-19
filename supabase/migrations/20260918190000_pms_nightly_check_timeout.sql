-- pms-nightly-contract-check espace désormais son chemin NOMINAL de PROBE_SPACING_MS (1500 ms)
-- entre chaque établissement connecté (supabase/functions/pms-nightly-contract-check/index.ts,
-- 20260918170000) — c'était jusqu'ici le seul poste de tout le dossier PMS dont le coût croît AVEC
-- le nombre d'établissements (2N appels en rafale, sans espacement).
--
-- Conséquence mécanique : le temps de mur du job grandit avec le nombre d'établissements connectés.
-- Ce job est nocturne (`0 7 * * *`) et non bloquant — un temps de mur plus long n'est jamais un
-- problème produit — mais `net.http_post` abandonne au-delà de son `timeout_milliseconds` et
-- consigne un timeout dans `net._http_response`, seul canal de supervision de ce cron
-- (cf. 20260917160000, même piège déjà rencontré et corrigé pour pms-sync-availability). À
-- 25 000 ms, l'espacement SEUL atteint ce plafond dès ~17 établissements
-- (17 × 1500 ms ≈ 25 500 ms), avant même de compter la latence réelle des appels Lobby.
--
-- Porté à 60 s : couvre confortablement l'espacement jusqu'à ~35-40 établissements. Au-delà, c'est
-- ce chiffre qu'il faut relire — pas une supposition à faire aujourd'hui, un établissement PMS-
-- backed existant en tout et pour tout (Casa Kayam).
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
    raise warning 'pms_nightly_contract_check : secrets Vault manquants — job ignoré (cf. supabase/scripts/seed_pms_vault_secrets.example.sql)';
    return;
  end if;
  perform net.http_post(
    url := v_base_url || '/functions/v1/pms-nightly-contract-check',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
end;
$$;

revoke all on function invoke_pms_nightly_contract_check() from public, anon, authenticated;
