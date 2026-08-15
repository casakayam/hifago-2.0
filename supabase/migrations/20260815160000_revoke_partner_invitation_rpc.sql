-- Feature 29 (docs/specs/05-invitations-onboarding-dashboard-partenaire.md §7) : aucune RPC ne
-- permettait jusqu'ici de révoquer une invitation `pending` — seule create_partner_invitation
-- existait côté écriture. partner_invitations est RPC-only (revoke insert/update/delete,
-- 20260813163456_identity_rls.sql), donc même l'admin ne peut pas poser un update en direct.
--
-- Squelette identique à create_partner_invitation/create_establishment : security definer +
-- contrôle is_admin() interne, pas le squelette anti-survente complet (aucune ressource à
-- capacité limitée n'est touchée par une révocation) mais un verrouillage `for update` tout de
-- même posé, cohérent avec consume_partner_invitation qui verrouille la même ligne — évite qu'une
-- révocation et une consommation concurrentes de la même invitation ne se chevauchent.
create or replace function revoke_partner_invitation(p_invitation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invitation record;
begin
  if not (select public.is_admin(auth.uid())) then
    raise exception 'revoke_partner_invitation réservé au rôle admin' using errcode = '42501';
  end if;

  select id, status into v_invitation
    from public.partner_invitations
   where id = p_invitation_id
   for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'invitation_not_found');
  end if;

  -- Seule la transition pending → revoked est permise (même vocabulaire de raison que
  -- consume_partner_invitation : already_<statut>) — une invitation déjà consommée/expirée/révoquée
  -- ne se révoque pas une deuxième fois.
  if v_invitation.status <> 'pending' then
    return jsonb_build_object('ok', false, 'reason', 'already_' || v_invitation.status);
  end if;

  update public.partner_invitations
     set status = 'revoked'
   where id = v_invitation.id;

  perform public.log_admin_action(
    'partner_invitation.revoke', 'partner_invitations', p_invitation_id,
    jsonb_build_object('status', v_invitation.status), jsonb_build_object('status', 'revoked'), null
  );

  return jsonb_build_object('ok', true);
end;
$$;

-- Le privilège par défaut sur une fonction créée par le rôle postgres n'inclut pas EXECUTE pour
-- anon/authenticated (cf. hifago/CLAUDE.md §11) — accordé explicitement à authenticated (le
-- contrôle d'accès réel est le is_admin() interne ci-dessus, même posture que les RPC voisines).
grant execute on function revoke_partner_invitation(uuid) to authenticated;
