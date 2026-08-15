-- Checkpoint B — correctif GoTrue : `signInWithPassword` échouait pour tout compte seedé
-- ("Database error querying schema" côté client, "error finding user: sql: Scan error on column
-- index 3, name \"confirmation_token\": converting NULL to string is unsupported" dans les logs
-- du conteneur auth) dès le premier test e2e réel piloté par le formulaire de connexion.
--
-- Cause : le bloc de seed de la Tranche 1 (supabase/seed.sql, insert into auth.users) ne
-- renseigne pas confirmation_token/recovery_token/email_change_token_new/email_change, qui
-- valent alors NULL — GoTrue (Go) les scanne en `string` non-nullable côté client, et NULL n'est
-- pas une valeur valide. Certaines colonnes voisines (phone_change_token,
-- email_change_token_current, reauthentication_token) ont déjà un défaut '' posé par la
-- migration GoTrue elle-même ; ces 4-là ne l'ont pas. Jamais exercé avant ce checkpoint :
-- Tranche 1 authentifiait ses appels de test via `set_config('request.jwt.claims', ...)`
-- (simulation directe au niveau Postgres), jamais via un vrai `/token` GoTrue.
--
-- Correctif retenu — trigger, pas `alter column ... set default` : `auth.users` appartient au
-- rôle `supabase_auth_admin`, pas à `postgres` (le rôle qui exécute nos migrations), qui n'a donc
-- pas le privilège ALTER sur cette table (constaté : "must be owner of table users"). Créer un
-- trigger ne demande que le privilège TRIGGER, déjà exercé avec succès par
-- `on_auth_user_created` (0003_identity_account_provisioning) sur cette même table — même
-- posture, pas une nouvelle exception.
create or replace function auth_users_default_empty_tokens()
returns trigger
language plpgsql
as $$
begin
  new.confirmation_token := coalesce(new.confirmation_token, '');
  new.recovery_token := coalesce(new.recovery_token, '');
  new.email_change_token_new := coalesce(new.email_change_token_new, '');
  new.email_change := coalesce(new.email_change, '');
  return new;
end;
$$;

create trigger auth_users_default_empty_tokens
  before insert on auth.users
  for each row
  execute function auth_users_default_empty_tokens();

-- Corrige aussi la ligne déjà insérée par supabase/seed.sql lors d'un `db reset` antérieur à ce
-- correctif (sans effet lors d'un reset complet, qui réinsère après cette migration — utile pour
-- une application incrémentale via `migration up`).
update auth.users
   set confirmation_token = coalesce(confirmation_token, ''),
       recovery_token = coalesce(recovery_token, ''),
       email_change_token_new = coalesce(email_change_token_new, ''),
       email_change = coalesce(email_change, '');
