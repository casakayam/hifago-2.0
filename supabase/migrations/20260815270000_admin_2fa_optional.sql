-- Feature 31 (docs/specs/07-connexion-inscription-complete.md) — décision Jérôme, 2026-08-15 :
-- le 2FA obligatoire (migration 20260815250000_admin_2fa_aal2.sql) bloquait l'accès admin réel
-- suite à un bug d'enrôlement (QR non affiché, cause en cours d'investigation séparée) — is_admin()
-- revient à un simple contrôle de capacité, sans exigence d'AAL2. has_admin_capability(uid) reste
-- en place (même comportement désormais qu'is_admin, gardé distinct pour ne pas retoucher les
-- appelants existants — apps/admin/lib/mfaGuard.ts — inoffensif tant qu'il est appelé). Les écrans
-- /mfa/enroll et /mfa/verify restent fonctionnels pour qui veut s'enrôler volontairement une fois
-- le bug résolu ; seul le blocage forcé (redirection systématique depuis les layouts) est retiré,
-- pas l'infrastructure elle-même.
create or replace function is_admin(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_admin_capability(uid);
$$;
