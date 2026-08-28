-- Deuxième vague du même bug, trouvée en auditant les 69 RPC SECURITY DEFINER exposées à `anon`
-- (audit déclenché par le correctif 20260828000103, qui n'avait traité que les 8 RPC portant un
-- grant service_role explicite). Sur ces 69, 17 ne référencent NI is_admin(), NI auth.uid(), NI
-- has_capability(). Tri de ces 17 :
--   * 5 sont des fonctions `returns trigger` — Postgres refuse leur appel direct, PostgREST ne les
--     expose pas : pas des trous.
--   * 6 sont des prédicats/aides appelés DANS des policies RLS (is_admin, has_capability,
--     has_admin_capability, partner_id_for_account, establishment_slug_from_name) ou publiques par
--     conception (check_partner_invitation) : leur EXECUTE est NÉCESSAIRE, une policy s'évalue avec
--     les droits du rôle appelant. Elles restent exposées, désormais listées explicitement dans
--     supabase/tests/database/security_definer_exposure.test.sql.
--   * 6 sont de vrais endpoints RPC ouverts — corrigés ici.
--
-- Le plus grave : `apply_order_line_ledger_transition(uuid[], text)` écrit dans `ledger_entries`.
-- Elle bascule des commissions référent en 'due' ou 'void' et insère des lignes
-- 'establishment_compensation', sur des order_line_ids fournis par l'appelant, sans aucun contrôle
-- — l'autorisation est faite par set_order_line_status, son unique appelant légitime. Elle portait
-- `revoke ... from public`, la forme inopérante déjà corrigée pour apply_payment_webhook.
--
-- Les 5 autres sont des fonctions de cron (`cron.schedule`) sans aucun revoke : n'importe qui
-- pouvait déclencher les jobs à volonté — envois d'e-mails, appels PMS Lobby, annulations,
-- expiration de commandes.
--
-- Aucun impact sur les appels légitimes : les jobs pg_cron et les RPC appelantes s'exécutent comme
-- `postgres`/propriétaire, dont le grant est conservé.

revoke all on function public.apply_order_line_ledger_transition(uuid[], text) from public, anon, authenticated;
revoke all on function public.expire_stale_payment_orders() from public, anon, authenticated;
revoke all on function public.invoke_pms_poll_bookings() from public, anon, authenticated;
revoke all on function public.invoke_pms_cancel_bookings() from public, anon, authenticated;
revoke all on function public.invoke_pms_nightly_contract_check() from public, anon, authenticated;
revoke all on function public.invoke_send_notification_emails() from public, anon, authenticated;
