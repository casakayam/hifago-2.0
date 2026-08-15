-- Feature 1 (Admin : créer un établissement) — RPC create_establishment.
-- Migration ADDITIVE : establishments (20260813210000) et partner_capabilities.establishment_id
-- (20260813211500) existent déjà, appliquées par le correctif Tranche 1 — on ne les retouche pas.
--
-- SECURITY DEFINER avec contrôle is_admin() explicite, PAS security invoker : establishments est
-- RLS-directe admin (l'admin pourrait y écrire en invoker), mais partner_capabilities est
-- RPC-only depuis la Tranche 1 (aucune policy d'écriture, admin compris) — en security invoker,
-- l'update/insert sur partner_capabilities échouerait systématiquement en permission denied pour
-- tout appelant. Dès qu'une des tables touchées est RPC-only, la fonction entière doit être
-- security definer avec son propre contrôle d'accès (même raisonnement que set_product_sellable/
-- log_admin_action).
create or replace function create_establishment(p_partner_id uuid, p_name jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_establishment_id uuid;
begin
  if not (select public.is_admin(auth.uid())) then
    raise exception 'create_establishment réservé au rôle admin' using errcode = '42501';
  end if;

  insert into public.establishments (partner_id, name) values (p_partner_id, p_name)
  returning id into v_establishment_id;

  -- Une capacité operator "en attente" (establishment_id null, cf. correctif Tranche 1) est
  -- rattachée au nouvel établissement plutôt que dupliquée. S'il n'y en a pas (le partenaire a
  -- déjà au moins un établissement rattaché), une nouvelle ligne operator est créée pour celui-ci
  -- — statut onboarding, à activer séparément (pas de RPC d'approbation admin à ce stade du
  -- chantier).
  update public.partner_capabilities
     set establishment_id = v_establishment_id
   where partner_id = p_partner_id
     and role = 'operator'
     and establishment_id is null;

  if not found then
    insert into public.partner_capabilities (partner_id, establishment_id, role, source, status)
    values (p_partner_id, v_establishment_id, 'operator', 'admin', 'onboarding');
  end if;

  return v_establishment_id;
end;
$$;

-- Le privilège par défaut sur une fonction créée par le rôle postgres n'inclut pas EXECUTE pour
-- anon/authenticated (cf. hifago/CLAUDE.md §11) — accordé explicitement à authenticated (le
-- contrôle d'accès réel est le is_admin() interne ci-dessus, pas ce grant).
grant execute on function create_establishment(uuid, jsonb) to authenticated;
