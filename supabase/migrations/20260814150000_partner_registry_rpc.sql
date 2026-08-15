-- Feature 23 (Admin : registre d'identité partenaire) — 4 RPC, chacune touchant une table déjà
-- classée, chacune avec le bon mode de sécurité pour sa table cible (leçon de l'audit adversarial
-- : ne jamais présumer, toujours vérifier la classification RLS/RPC-only réelle avant de choisir
-- invoker vs definer, cf. hifago/CLAUDE.md §3).

-- Gap constaté en implémentant (le plan assumait entity_id nullable sans le revérifier contre la
-- migration réelle du correctif audit_log, qui l'avait posée not null — aucun appelant précédent
-- n'avait de raison de passer null) : set_partner_code_active a besoin de passer entity_id = null
-- (la clé de partner_codes est du texte, pas un uuid — le code voyage dans before/after à la
-- place). Changement sûr : relâche une contrainte, ne resserre rien, audit_log repart vide à
-- chaque db reset donc aucune ligne existante à migrer.
alter table audit_log alter column entity_id drop not null;

-- 1. grant_capability — security definer : partner_capabilities est RPC-only depuis la Tranche 1,
-- aucun raccourci invoker possible. Garantit l'invariant operator ⇒ referrer (Tranche 1) en
-- insérant la ligne referrer d'abord si absente — même ordre que consume_partner_invitation.
create or replace function grant_capability(
  p_partner_id uuid, p_role text, p_establishment_id uuid default null, p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_capability_id uuid;
begin
  if not (select public.is_admin(auth.uid())) then
    raise exception 'grant_capability réservé au rôle admin' using errcode = '42501';
  end if;
  if p_role not in ('referrer', 'operator') then
    raise exception 'rôle invalide : %', p_role;
  end if;
  if exists (
    select 1 from public.partner_capabilities
     where partner_id = p_partner_id and role = p_role
       and establishment_id is not distinct from p_establishment_id
  ) then
    raise exception 'cette capacité existe déjà pour ce partenaire/établissement';
  end if;

  if p_role = 'operator' and not exists (
    select 1 from public.partner_capabilities where partner_id = p_partner_id and role = 'referrer'
  ) then
    insert into public.partner_capabilities (partner_id, role, source, status)
    values (p_partner_id, 'referrer', 'admin', 'onboarding');
  end if;

  insert into public.partner_capabilities (partner_id, establishment_id, role, source, status)
  values (p_partner_id, p_establishment_id, p_role, 'admin', 'onboarding')
  returning id into v_capability_id;

  perform public.log_admin_action(
    'partner_capability.grant', 'partner_capabilities', v_capability_id, null,
    jsonb_build_object('partner_id', p_partner_id, 'role', p_role, 'establishment_id', p_establishment_id),
    p_note
  );
  return jsonb_build_object('ok', true, 'capability_id', v_capability_id);
end;
$$;

grant execute on function grant_capability(uuid, text, uuid, text) to authenticated;

-- 2. set_capability_status — même security definer que grant_capability (partner_capabilities
-- RPC-only). Verrou FOR UPDATE avant transition (calibrage bas-risque, pas de compteur de
-- capacité touché). S'applique symétriquement aux deux rôles referrer et operator (admin §3a : la
-- suspension existe aussi pour referrer, pas seulement operator) — une seule fonction, pas une par
-- rôle.
create or replace function set_capability_status(
  p_capability_id uuid, p_new_status text, p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before_status text;
begin
  if not (select public.is_admin(auth.uid())) then
    raise exception 'set_capability_status réservé au rôle admin' using errcode = '42501';
  end if;
  if p_new_status not in ('onboarding', 'pending_review', 'active', 'suspended') then
    raise exception 'statut invalide : %', p_new_status;
  end if;

  select status into v_before_status from public.partner_capabilities
   where id = p_capability_id for update;
  if not found then
    raise exception 'capacité introuvable';
  end if;

  update public.partner_capabilities set status = p_new_status, updated_at = now()
   where id = p_capability_id;

  perform public.log_admin_action(
    'partner_capability.set_status', 'partner_capabilities', p_capability_id,
    jsonb_build_object('status', v_before_status), jsonb_build_object('status', p_new_status), p_note
  );
  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function set_capability_status(uuid, text, text) to authenticated;

-- 3. transfer_establishment — security invoker cette fois : establishments est RLS-directe admin
-- (contrairement à partner_capabilities), un admin y a déjà un accès direct — même raisonnement
-- que create_establishment (corrigé) et set_product_sellable. `if not found` évalué APRÈS
-- l'update, pas avant : sous RLS, une écriture refusée affecte silencieusement 0 ligne, jamais une
-- exception automatique. Un seul chemin, qu'il s'agisse d'un premier rattachement ou d'un
-- transfert depuis un autre partenaire — jamais un rattachement en double.
create or replace function transfer_establishment(
  p_establishment_id uuid, p_new_partner_id uuid, p_note text default null
)
returns jsonb
language plpgsql
security invoker
as $$
declare
  v_before_partner_id uuid;
begin
  select partner_id into v_before_partner_id from establishments where id = p_establishment_id;

  update establishments set partner_id = p_new_partner_id, updated_at = now()
   where id = p_establishment_id;

  if not found then
    raise exception 'établissement introuvable ou non autorisé';
  end if;

  perform log_admin_action(
    'establishment.transfer', 'establishments', p_establishment_id,
    jsonb_build_object('partner_id', v_before_partner_id),
    jsonb_build_object('partner_id', p_new_partner_id), p_note
  );
  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function transfer_establishment(uuid, uuid, text) to authenticated;

-- 4. set_partner_code_active — security definer (partner_codes RPC-only depuis la Tranche 1).
-- Note de convention : entity_id de log_admin_action est uuid, mais la clé de partner_codes est
-- son code (text) — passé null en entity_id, le code voyage dans before/after à la place, même
-- écart déjà assumé pour set_product_availability (correctif Tranche 2/3, la date plutôt que
-- l'id de ligne).
create or replace function set_partner_code_active(p_code text, p_active boolean, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before_active boolean;
begin
  if not (select public.is_admin(auth.uid())) then
    raise exception 'set_partner_code_active réservé au rôle admin' using errcode = '42501';
  end if;

  select active into v_before_active from public.partner_codes where code = p_code for update;
  if not found then
    raise exception 'code introuvable';
  end if;

  update public.partner_codes set active = p_active, updated_at = now() where code = p_code;

  perform public.log_admin_action(
    'partner_code.set_active', 'partner_codes', null,
    jsonb_build_object('code', p_code, 'active', v_before_active),
    jsonb_build_object('code', p_code, 'active', p_active), p_note
  );
  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function set_partner_code_active(text, boolean, text) to authenticated;
