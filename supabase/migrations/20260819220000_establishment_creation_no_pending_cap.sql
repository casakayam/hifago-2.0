-- Retour Jérôme (2026-08-19, usage réel) : le plafond "1 proposition de création d'établissement
-- pending PAR PARTENAIRE" bloquait un socio qui voulait en proposer un 2e (ou plus) pendant qu'un
-- premier attendait encore la revue admin — même gêne, même retrait déjà fait côté produit le
-- 2026-08-18 (20260818110000_product_creation_review_ux.sql : "Aucun autre invariant ne s'appuie
-- sur cette limite — product_proposals_scope n'impose aucune borne de nombre, PendingProductCreat
-- ionsList.tsx rend déjà une LISTE, pas un singleton"). Même raisonnement ici : establishment_
-- proposals_scope (20260815170000) n'impose aucune borne de nombre non plus (juste une contrainte
-- de nullabilité establishment_id/status), et EstablishmentStack.tsx affiche déjà chaque
-- établissement — approuvé ou en attente — comme sa propre section pleine largeur, jamais un
-- singleton supposé. Seul le plafond générique 10 pending/partenaire (toutes propositions
-- établissement confondues — create/edit/photos, inchangé ici) reste une vraie barrière anti-abus.
--
-- Signature INCHANGÉE, corps repris VERBATIM depuis sa dernière définition
-- (20260819200000_establishment_creation_proposal_photos.sql), seul le bloc plafond "1 pending"
-- retiré.
create or replace function submit_establishment_creation_proposal(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account_id uuid := auth.uid();
  v_partner_id uuid;
  v_proposal_id uuid;
  v_safe_payload jsonb;
  v_safe_photos jsonb;
begin
  if v_account_id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;

  v_partner_id := (select public.partner_id_for_account(v_account_id));
  if v_partner_id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_a_partner');
  end if;

  if coalesce(btrim(p_payload -> 'name' ->> 'es'), '') = '' then
    return jsonb_build_object('ok', false, 'reason', 'name_required');
  end if;

  -- Plafond générique 10 pending/partenaire (même valeur littérale que submit_establishment_edit_
  -- proposal/submit_product_creation_proposal), compté toutes propositions établissement
  -- confondues (create/edit/photos) — seule barrière anti-abus restante après le retrait du
  -- plafond dédié "1 création" ci-dessus.
  if (
    select count(*) from public.establishment_proposals
     where partner_id = v_partner_id and status = 'pending'
  ) >= 10 then
    return jsonb_build_object('ok', false, 'reason', 'pending_cap_exceeded');
  end if;

  -- Photos : plafond 6, même invariant que submit_product_creation_proposal — le lieu n'existe pas
  -- encore, aucune galerie existante à cumuler.
  if jsonb_typeof(p_payload -> 'photos') = 'array' and jsonb_array_length(p_payload -> 'photos') > 6 then
    return jsonb_build_object('ok', false, 'reason', 'gallery_cap_exceeded');
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('storage_path', photo ->> 'storage_path')), '[]'::jsonb)
    into v_safe_photos
    from jsonb_array_elements(coalesce(p_payload -> 'photos', '[]'::jsonb)) photo
   where coalesce(btrim(photo ->> 'storage_path'), '') <> '';

  -- Whitelist explicite : jamais operated_directly (classification métier/plateforme, cf.
  -- commentaire de tête de 20260815170000_gestion_etablissement.sql), jamais un champ hors
  -- présentation.
  v_safe_payload := jsonb_build_object(
    'name', p_payload -> 'name', 'description', p_payload -> 'description',
    'address', p_payload -> 'address', 'lat', p_payload -> 'lat', 'lon', p_payload -> 'lon',
    'photos', v_safe_photos
  );

  insert into public.establishment_proposals (establishment_id, partner_id, submitted_by, kind, payload)
  values (null, v_partner_id, v_account_id, 'create', v_safe_payload)
  returning id into v_proposal_id;

  return jsonb_build_object('ok', true, 'proposal_id', v_proposal_id);
end;
$$;
