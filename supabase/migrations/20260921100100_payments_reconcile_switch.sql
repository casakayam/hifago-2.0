-- Lot B — bascule (spec 39 D1) : le job payments-reconcile (20260921100000) est en place, l'ancien
-- cron d'expiration s'arrête et sa fonction disparaît. Migration SÉPARÉE pour que l'histoire du
-- schéma montre le geste seul, et parce qu'un `unschedule` sans `drop` laisserait une fonction
-- vivante, testée et grantée à personne — un souhait au sens de CLAUDE.md §11.20.
--
-- Pourquoi maintenant et pas après une « bascule observée » : le filet est déjà là. Si le job ne
-- tourne pas (secret absent, fonction non déployée), RIEN n'expire (échec fermé, des places restent
-- immobilisées), le watchdog prévient les admins à 15 min, et tout paiement tardif tombe dans la
-- garde du Lot A. L'ancien cron, lui, détruisait des réservations payées (HFG-000013).
--
-- Références de code à l'ancienne fonction, toutes traitées dans ce lot : payments.test.sql
-- (cas 15-19, portés dans payments_reconcile.test.sql), service_role_only_functions.test.sql
-- (ligne retirée), tests/concurrency/apply_payment_webhook_vs_expiry.concurrency.mjs (réécrit sur
-- expire_payment_order), database.types.ts (régénéré). 20260828002053 la cite mais s'exécute avant.
select cron.unschedule('expire-stale-payment-orders');
drop function public.expire_stale_payment_orders();
