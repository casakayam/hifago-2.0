-- Feature 31 (docs/specs/07-connexion-inscription-complete.md §7) — pré-contrôle en lecture seule
-- du jeton d'invitation, appelé par POST /api/auth/invitation-signup AVANT de créer le compte
-- (service_role, admin.createUser). Corrige un choix initial erroné : interroger
-- partner_invitations directement via un client service_role échoue avec "permission denied for
-- table partner_invitations" — cette table est RPC-only (revoke insert/update/delete ET aucun
-- grant select à service_role, 20260813163456_identity_rls.sql), service_role contourne la RLS
-- mais pas l'absence de GRANT. Même remède déjà en place partout ailleurs dans le projet pour ce
-- même problème : une fonction SECURITY DEFINER (tourne avec les privilèges du rôle propriétaire,
-- jamais ceux de l'appelant), pas un accès table direct. Callable sans authentification (comme
-- consume_partner_invitation) : connaître le jeton brut à 64 caractères hex EST la preuve
-- d'autorisation, aucun contrôle is_admin() supplémentaire n'a de sens ici.
create or replace function check_partner_invitation(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token_hash text := encode(extensions.digest(p_token, 'sha256'), 'hex');
  v_invitation record;
begin
  select status, expires_at into v_invitation
    from public.partner_invitations
   where token_hash = v_token_hash;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'invitation_not_found');
  end if;

  if v_invitation.status <> 'pending' then
    return jsonb_build_object('ok', false, 'reason', 'already_' || v_invitation.status);
  end if;

  if v_invitation.expires_at < now() then
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function check_partner_invitation(text) to anon, authenticated;
