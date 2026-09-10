-- Spec 31 (Tranche 4) — purge des identités anonymes sans commande après 30 jours.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- CE QUE CE JOB SUPPRIME, ET CE QUI LE PROTÈGE
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- Décision ⑦/⑨ (2026-09-09/10, entretien spec 31) : une identité anonyme dont le compte a plus de
-- 30 jours et qui n'a JAMAIS passé commande est purgée. Le panier NE PROTÈGE PAS (invariant 10,
-- tranché explicitement après une reformulation de la question) — seule une commande le fait,
-- quel que soit son statut ou son âge. Coût assumé et documenté dans la spec : un visiteur venu
-- par un lien référent qui revient après 30 jours perd son panier ET son attribution.
--
-- `auth.users.created_at` sert d'horloge, jamais une notion de « dernière activité » : un panier
-- touché la veille ne repousse rien, exactement ce que ⑨ tranche.
--
-- ⚠️ CE QUE CETTE MIGRATION NE FAIT PAS : elle ne définit AUCUNE table bloquante par son nom. Le
-- piège documenté dans la spec (§0, cas limites) est qu'un `delete` set-based avorte EN ENTIER dès
-- qu'UNE SEULE identité est retenue par une FK NO ACTION (audit_log, immuable par décision ;
-- comm_campaign_targets, laissé par une campagne passée ; 20 FK au total vers partner_accounts,
-- mesurées le 2026-09-09) — et cette liste peut grandir sans que ce fichier soit mis à jour.
-- Plutôt que de l'énumérer (deuxième option documentée dans la spec, mais qui se périme), ce job
-- supprime IDENTITÉ PAR IDENTITÉ et rattrape `foreign_key_violation` : la ligne bloquée est
-- ignorée, comptée, et le lot continue — jamais un job qui meurt en silence sur la première
-- anomalie.
--
-- ⚠️ ARCHITECTURE — SQL pur (decision Jérôme, 2026-09-10), risque assumé et à vérifier en premier
-- sur le premier vrai projet préprod : `insert into auth.users` est refusé sur Supabase Cloud
-- (permission denied for schema auth, constaté le 2026-08-21 — le schéma appartient à
-- supabase_auth_admin, pas postgres). Rien ne garantit que `delete` a le même droit — la doc
-- officielle Supabase présente ce DELETE en SQL nu (guide anonymous sign-ins), mais rien n'indique
-- si c'est spécifique à l'éditeur SQL du dashboard (rôle plus privilégié) ou valable depuis une
-- fonction appelée par pg_cron (exécutée comme postgres). Non vérifiable localement (superuser
-- local, aucune des deux restrictions Cloud n'y existe) — À VÉRIFIER dès qu'un projet préprod
-- existe, avant de faire confiance à ce job en production.
--
-- `partner_accounts_id_fkey ... on delete cascade` (vérifié) : supprimer auth.users suffit, la
-- ligne partner_accounts part avec, pas besoin de la supprimer séparément.
--
-- Checklist (CLAUDE.md §3/§4) : pas une opération critique au sens §4.1 (aucun décompte de
-- capacité, aucune réservation) — pas de test de concurrence requis. security definer + search_path
-- vide, comme tous les jobs pg_cron existants (expire_stale_payment_orders, pms-poll-bookings).
--
-- ⚠️ `revoke` EXPLICITE ci-dessous, pas une formalité : PostgreSQL accorde EXECUTE à PUBLIC par
-- défaut sur toute nouvelle fonction — ce projet l'a déjà découvert et corrigé une fois, le
-- 2026-08-28 (20260828002053_revoke_internal_rpc_from_data_api_roles.sql, sur 6 jobs pg_cron
-- existants dont expire_stale_payment_orders lui-même) : « n'importe qui pouvait déclencher les
-- jobs à volonté ». Sans cette ligne, cette fonction aurait reproduit exactement le même trou —
-- vérifié en réel : has_function_privilege('anon', ..., 'EXECUTE') rendait `true` avant cette
-- ligne. service_role conservé (même précédent) : rôle de confiance, jamais atteignable par un
-- appel public.

create extension if not exists pg_cron with schema extensions;

create or replace function purge_expired_anonymous_identities()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_candidate record;
  v_candidate_count int := 0;
  v_purged_count int := 0;
  v_skipped_ids uuid[] := array[]::uuid[];
begin
  -- LIMIT 500 : filet de sécurité, pas une hypothèse de volume — rien n'empêche un run suivant
  -- (le lendemain) de reprendre le reste ; jamais un run qui tourne indéfiniment si la table
  -- grossit un jour bien au-delà de ce qui est mesuré aujourd'hui (§7.3 : préprod 100% synthétique,
  -- aucune donnée réelle).
  for v_candidate in
    select u.id
      from auth.users u
     where u.is_anonymous is true
       and u.created_at < now() - interval '30 days'
       and not exists (select 1 from public.orders o where o.account_id = u.id)
     order by u.created_at
     limit 500
  loop
    v_candidate_count := v_candidate_count + 1;
    begin
      delete from auth.users where id = v_candidate.id;
      v_purged_count := v_purged_count + 1;
    exception when foreign_key_violation then
      -- Bloquée par une trace ailleurs (audit_log, campagne...) — ignorée, jamais retentée
      -- indéfiniment sans qu'on le sache : comptée et nommée dans le retour.
      v_skipped_ids := v_skipped_ids || v_candidate.id;
    end;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'candidates', v_candidate_count,
    'purged', v_purged_count,
    'skipped', v_skipped_ids
  );
end;
$$;

select cron.schedule(
  'purge-expired-anonymous-identities', '0 4 * * *',
  $$select purge_expired_anonymous_identities();$$
);

revoke all on function public.purge_expired_anonymous_identities() from public, anon, authenticated;
