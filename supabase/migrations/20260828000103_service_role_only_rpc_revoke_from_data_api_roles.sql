-- Correctif de sécurité — 2026-08-27. Deux RPC réservées à `service_role` étaient exécutables par
-- `anon` ET `authenticated`, sur une base construite à neuf comme sur le projet cloud.
--
-- CAUSE COMMUNE, à retenir pour toute RPC future : sur Supabase, les privilèges par défaut du
-- schéma `public` accordent EXECUTE **explicitement** à anon, authenticated et service_role
-- (`pg_default_acl`, objtype 'f'). Un `revoke execute ... from public` ne leur retire donc RIEN —
-- il n'enlève que le grant implicite à PUBLIC. La forme correcte, déjà employée par les migrations
-- de notification et de file PMS, nomme les rôles : `from public, authenticated, anon`.
--
-- 1. `apply_payment_webhook` (20260818220000) n'a jamais eu la bonne forme. Sa propre en-tête
--    décrit pourtant le mode d'échec exact : « un appelant anonyme pourrait alors marquer
--    n'importe quel paiement 'approved' directement depuis le navigateur. Le seul rempart est donc
--    ce grant, pas une logique interne. » La fonction est SECURITY DEFINER : la RLS ne rattrape
--    rien. Connaître l'UUID d'un paiement suffisait — or chaque client connaît le sien.
-- 2. `claim_pms_cancellation_batch` était CORRECTE dans 20260827160000 puis 20260827180000.
--    20260827260000 l'a recréée sous une nouvelle signature `(integer, integer)` — donc une
--    fonction neuve, aux privilèges par défaut — avec un revoke retombé à `from public` seul.
--
-- Trouvé par le job `db` de la CI à son tout premier run (payments.test.sql 12/13/15 et
-- rls_rpc_only_checklist.test.sql 4). Garde-fou permanent ajouté dans le même geste :
-- supabase/tests/database/service_role_only_functions.test.sql.

revoke all on function public.apply_payment_webhook(text, uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.apply_payment_webhook(text, uuid, text, jsonb)
  to service_role;

revoke all on function public.claim_pms_cancellation_batch(integer, integer)
  from public, anon, authenticated;
grant execute on function public.claim_pms_cancellation_batch(integer, integer)
  to service_role;

-- Défense en profondeur (CLAUDE.md §3.1) : partner_accounts est sous RLS SANS aucune policy
-- d'écriture, donc la RLS default-deny bloque déjà tout write client. Elle ne doit pas être le
-- SEUL filet — les grants INSERT/UPDATE/DELETE hérités des privilèges par défaut sont retirés.
-- Aucun impact sur les écritures légitimes : elles passent toutes par des fonctions SECURITY
-- DEFINER (trigger de provisioning, RPC de gestion), qui s'exécutent avec les droits du
-- propriétaire, pas ceux de l'appelant. Le SELECT reste accordé.
revoke insert, update, delete on table public.partner_accounts from anon, authenticated;
