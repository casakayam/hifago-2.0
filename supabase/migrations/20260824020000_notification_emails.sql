-- Spec 23 Tranche 1 — cœur de l'infrastructure de notifications email : file Postgres + journal
-- d'envoi tracé (décision docs/00-modele-de-donnees.md, 2026-08-12) + Edge Function (branchée en
-- 20260824070000_send_notification_emails_dispatch.sql). Squelette repris de
-- claim_pms_poll_batch/invoke_pms_poll_bookings (20260819120000/20260819140000) — même discipline
-- FOR UPDATE SKIP LOCKED, mêmes secrets Vault génériques réutilisés.
--
-- Invariant central (spec 23 §8.1, corrigé après challenge adversarial du 2026-08-24) : une
-- notification email qui échoue à s'empiler ou à se construire NE DOIT JAMAIS faire échouer
-- l'opération métier qui la déclenche. enqueue_notification_email elle-même ne lève jamais
-- d'exception sur un destinataire manquant (cas attendu, no-op silencieux) ; toute AUTRE erreur
-- reste la responsabilité de l'appelant (sous-bloc `exception when others, when query_canceled`
-- posé à chaque site d'appel — `when others` seul est insuffisant, query_canceled en est exclu par
-- construction en PL/pgSQL).
create table notification_emails (
  id uuid primary key default gen_random_uuid(),
  event_type text not null check (event_type in (
    'partner_invitation',
    'admin_new_proposal',
    'admin_new_reconciliation_exception',
    'partner_proposal_decided',
    'partner_commission_earned',
    'partner_payment_confirmed',
    'client_order_confirmed',
    'partner_camp_evento_blocked'
  )),
  recipient_email text not null,
  recipient_account_id uuid references partner_accounts(id),
  subject text not null,
  body_html text not null,
  related_table text,
  related_id uuid,
  status text not null default 'pending'
    check (status in ('pending', 'sending', 'sent', 'failed', 'abandoned')),
  attempts int not null default 0,
  last_attempt_at timestamptz,
  last_error text,
  provider_message_id text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create index notification_emails_pending_idx
  on notification_emails(created_at) where status = 'pending';

-- Reprise d'une ligne bloquée à 'sending' par un crash de l'Edge Function entre l'envoi Resend
-- réussi et l'appel à mark_notification_email_sent (spec 23 §8.4) — claim_notification_email_batch
-- ci-dessous s'en sert.
create index notification_emails_stale_sending_idx
  on notification_emails(last_attempt_at) where status = 'sending';

-- coalesce nécessaire : un index unique ne déduplique jamais deux NULL entre eux en Postgres, or
-- recipient_account_id est NULL pour l'invitation et la confirmation client (pas encore de compte,
-- ou destinataire client jamais un compte partenaire).
create unique index notification_emails_dedup_idx
  on notification_emails(
    event_type, related_table, related_id,
    coalesce(recipient_account_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  where related_id is not null;

-- Pas de GRANT explicite nécessaire : couverte par ALTER DEFAULT PRIVILEGES
-- (20260813163456_identity_rls.sql). RPC-only (aucune policy d'écriture, même pour l'admin) :
-- table d'audit/journal, cf. hifago/CLAUDE.md §3.
alter table notification_emails enable row level security;
revoke insert, update, delete on notification_emails from authenticated, anon;
create policy notification_emails_select_admin on notification_emails
  for select using ((select is_admin(auth.uid())));

-- ============================================================================================
-- enqueue_notification_email — utilitaire central
-- ============================================================================================
-- Revoke explicite (pas une simple absence de grant) : jamais appelée directement par un client,
-- uniquement en nested depuis d'autres fonctions SECURITY DEFINER/triggers du même propriétaire
-- (spec 23 §8.3 — l'EXECUTE d'un nested call est vérifié pour le propriétaire de la fonction
-- appelante, qui a toujours EXECUTE sur ses propres fonctions, donc aucun grant authenticated
-- n'est nécessaire pour que le nested-call fonctionne). Defense en profondeur vis-à-vis d'un
-- provisioning cloud qui pourrait différer du comportement local (hifago/CLAUDE.md §11 point 1).
create or replace function enqueue_notification_email(
  p_event_type text,
  p_recipient_email text,
  p_recipient_account_id uuid,
  p_subject text,
  p_body_html text,
  p_related_table text default null,
  p_related_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_recipient_email is null or btrim(p_recipient_email) = '' then
    return null;
  end if;

  insert into public.notification_emails (
    event_type, recipient_email, recipient_account_id, subject, body_html, related_table, related_id
  )
  values (
    p_event_type, p_recipient_email, p_recipient_account_id, p_subject, p_body_html, p_related_table, p_related_id
  )
  on conflict (
    event_type, related_table, related_id,
    coalesce(recipient_account_id, '00000000-0000-0000-0000-000000000000'::uuid)
  ) where related_id is not null
  do nothing
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function enqueue_notification_email(text, text, uuid, text, text, text, uuid)
  from public, authenticated, anon;

-- ============================================================================================
-- notify_all_admins — fan-out vers tous les admins actifs, isolé PAR ADMIN (spec 23 §8.2)
-- ============================================================================================
-- L'isolation est posée À L'INTÉRIEUR de la boucle, jamais autour : un begin/exception entourant
-- toute la boucle attrape l'erreur à la frontière du bloc, pas de l'itération — un seul admin en
-- échec (ex. format() sur un champ null) annulerait silencieusement l'envoi à tous les admins
-- suivants dans la même boucle. Trouvé lors du challenge adversarial du 2026-08-24.
create or replace function notify_all_admins(
  p_event_type text,
  p_subject text,
  p_body_html text,
  p_related_table text default null,
  p_related_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin record;
begin
  for v_admin in
    select pc.account_id, au.email
      from public.partner_capabilities pc
      join auth.users au on au.id = pc.account_id
     where pc.role = 'admin' and pc.status = 'active'
  loop
    begin
      perform public.enqueue_notification_email(
        p_event_type, v_admin.email::text, v_admin.account_id, p_subject, p_body_html,
        p_related_table, p_related_id
      );
    exception
      when query_canceled then
        raise warning 'notify_all_admins: enqueue annulé (query_canceled) pour admin % — %', v_admin.account_id, sqlerrm;
      when others then
        raise warning 'notify_all_admins: échec enqueue pour admin % — %', v_admin.account_id, sqlerrm;
    end;
  end loop;
end;
$$;

revoke execute on function notify_all_admins(text, text, text, text, uuid) from public, authenticated, anon;

-- ============================================================================================
-- claim_notification_email_batch — réclame un lot pour l'Edge Function, SKIP LOCKED
-- ============================================================================================
-- Réclame status='pending' ET une ligne bloquée à 'sending' depuis plus de 10 min (crash de
-- l'Edge Function entre l'envoi Resend réussi et mark_notification_email_sent, spec 23 §8.4) —
-- sans cette reprise, une telle ligne resterait indéfiniment invisible à tout futur poll,
-- contredisant l'objectif de notification_emails comme vrai journal d'envoi tracé. L'envoi
-- physique en double est écarté côté Edge Function via l'en-tête Idempotency-Key de Resend, pas
-- ici — cette fonction ne fait que réclamer, jamais d'appel réseau.
create or replace function claim_notification_email_batch(p_limit int default 20)
returns setof notification_emails
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
    update public.notification_emails
       set status = 'sending', attempts = attempts + 1, last_attempt_at = now()
     where id in (
       select id from public.notification_emails
        where status = 'pending'
           or (status = 'sending' and last_attempt_at < now() - interval '10 minutes')
        order by created_at
        limit p_limit
        for update skip locked
     )
    returning *;
end;
$$;

revoke execute on function claim_notification_email_batch(int) from public, authenticated, anon;
grant execute on function claim_notification_email_batch(int) to service_role;

create or replace function mark_notification_email_sent(p_id uuid, p_provider_message_id text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.notification_emails
     set status = 'sent', sent_at = now(), provider_message_id = p_provider_message_id
   where id = p_id;
$$;

revoke execute on function mark_notification_email_sent(uuid, text) from public, authenticated, anon;
grant execute on function mark_notification_email_sent(uuid, text) to service_role;

create or replace function mark_notification_email_failed(p_id uuid, p_error text, p_max_attempts int default 5)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempts int;
begin
  select attempts into v_attempts from public.notification_emails where id = p_id;
  update public.notification_emails
     set status = case when v_attempts >= p_max_attempts then 'abandoned' else 'pending' end,
         last_error = p_error
   where id = p_id;
end;
$$;

revoke execute on function mark_notification_email_failed(uuid, text, int) from public, authenticated, anon;
grant execute on function mark_notification_email_failed(uuid, text, int) to service_role;
