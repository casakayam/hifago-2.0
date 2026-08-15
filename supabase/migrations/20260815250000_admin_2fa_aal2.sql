-- Feature 31 (docs/specs/07-connexion-inscription-complete.md §6/§8) — 2FA TOTP obligatoire pour
-- le rôle admin (hifago/docs/03-cahier-des-charges-admin.md §1, décision 2026-08-11/12), déclenché
-- à la connexion elle-même. is_admin(uid) est LE chokepoint déjà utilisé par toute la checklist
-- RLS/RPC-only (grep exhaustif sur supabase/migrations/*.sql, 2026-08-15 : 100% des appels sont des
-- auto-contrôles is_admin(auth.uid()), jamais un contrôle du statut admin d'un tiers) — un seul
-- changement centralisé ici plutôt que de retoucher chaque RPC/policy admin individuellement.
--
-- has_admin_capability(uid) est un NOUVEAU helper distinct : la capacité seule, sans exigence
-- d'AAL2. Nécessaire pour que le garde applicatif (apps/admin, requireAal2IfAdmin) puisse d'abord
-- savoir « ce compte est admin » AVANT que l'AAL2 soit atteinte, afin de le rediriger vers
-- /mfa/enroll ou /mfa/verify — is_admin() lui-même ne peut pas servir à cette décision puisqu'il
-- est désormais volontairement faux tant que l'AAL2 n'est pas satisfaite (sinon la redirection
-- vers l'enrôlement ne se déclencherait jamais, cercle vicieux).
create or replace function has_admin_capability(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.partner_capabilities
    where account_id = uid
      and role = 'admin'
      and status = 'active'
  );
$$;

grant execute on function has_admin_capability(uuid) to authenticated;

-- is_admin(uid) : même signature, même comportement pour un compte non-admin ; pour un compte
-- admin, exige désormais que la session COURANTE (auth.jwt(), pas un paramètre) soit en AAL2 —
-- cohérent avec le fait que tous les appelants passent déjà auth.uid() (la session courante).
-- coalesce(..., 'aal1') : une session sans claim aal (cas théorique) est traitée comme non-admin,
-- jamais l'inverse.
create or replace function is_admin(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_admin_capability(uid)
    and coalesce((select auth.jwt()->>'aal'), 'aal1') = 'aal2';
$$;
