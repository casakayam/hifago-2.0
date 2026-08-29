-- Garde-fou permanent : la liste des RPC dont la protection EST le grant, et rien d'autre.
--
-- Ces fonctions n'ont aucun moyen de vérifier en SQL qui les appelle (pas de is_admin(auth.uid()),
-- pas de RLS — elles sont SECURITY DEFINER). Leur seule barrière est l'absence d'EXECUTE pour les
-- rôles de la Data API. Le 2026-08-27, deux d'entre elles l'avaient perdue sans que rien ne le
-- dise : `apply_payment_webhook` ne l'avait jamais eue (revoke `from public` seul, inopérant face
-- aux privilèges par défaut de Supabase qui grantent anon/authenticated explicitement) et
-- `claim_pms_cancellation_batch` l'a reperdue le jour même, recréée sous une nouvelle signature.
--
-- Liste explicite et non déduite : « quelle RPC doit être service_role-seul » est un jugement
-- métier, c'est le point (5) laissé non automatisé dans rls_rpc_only_checklist.test.sql faute de
-- convention machine-lisible. Une liste que l'on tient à la main est la version étroite qui
-- n'oblige pas à en inventer une. AJOUTER ICI toute nouvelle RPC appelée uniquement par une Edge
-- Function, un cron ou un Route Handler serveur.

begin;
select plan(1);

select is(
  (
    select coalesce(string_agg(p.oid::regprocedure::text, ', ' order by p.proname), '')
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'apply_payment_webhook',
        'claim_notification_email_batch',
        'claim_pms_cancellation_batch',
        'claim_pms_poll_batch',
        'mark_notification_email_failed',
        'mark_notification_email_sent',
        'requeue_pms_cancellation',
        'resolve_pms_cancellation',
        -- Deuxième vague (20260828010000) : appelée uniquement par set_order_line_status, écrit
        -- dans ledger_entries sans aucun contrôle propre.
        'apply_order_line_ledger_transition',
        -- Réordonnancement PMS (20260829100000) : appelée uniquement par /api/pms/reserve-nights,
        -- qui seul sait que LobbyPMS a refusé. Elle REND DES PLACES et annule des lignes — donc
        -- directement monnayable si un client pouvait l'appeler avec l'UUID d'une commande.
        'release_order_after_pms_refusal',
        -- Fonctions de cron (`cron.schedule`) : aucun appelant humain légitime.
        'expire_stale_payment_orders',
        'invoke_pms_poll_bookings',
        'invoke_pms_cancel_bookings',
        'invoke_pms_nightly_contract_check',
        'invoke_send_notification_emails'
      )
      and (
        has_function_privilege('anon', p.oid, 'EXECUTE')
        or has_function_privilege('authenticated', p.oid, 'EXECUTE')
      )
  ),
  '',
  'aucune RPC service_role-seul n''est exécutable par anon ou authenticated (le grant EST la protection)'
);

select * from finish();
rollback;
