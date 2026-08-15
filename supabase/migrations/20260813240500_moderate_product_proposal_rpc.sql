-- Feature 16 (Admin : modérer une proposition socio) — RPC moderate_product_proposal.
--
-- Verrou optimiste (version) ET FOR UPDATE, pas l'un ou l'autre — deux risques différents :
-- FOR UPDATE protège contre une vraie collision SQL simultanée (double-clic à la milliseconde
-- près) ; version protège contre un problème différent, bien plus probable ici — un admin qui a
-- chargé l'écran, l'a laissé ouvert, et clique après qu'un autre a déjà traité la même
-- proposition. Ce deuxième cas n'a rien d'une concurrence temps réel : une lecture périmée entre
-- deux requêtes HTTP séparées, exactement ce que le verrou optimiste détecte. Calibrage déjà
-- tranché (challenge d'une session précédente) : conflit multi-admin rare et à échelle humaine,
-- pas le même ordre de risque que la réservation → test séquentiel pgTAP, jamais le harnais à
-- barrière/≥5 runs réservé au risque n°1 (reserve_order_line).
--
-- security definer, pas security invoker : product_proposals est RPC-only (aucune write policy,
-- même pour l'admin), products est RLS-directe admin — les deux écritures doivent être une seule
-- transaction atomique, même raisonnement que create_establishment/set_product_sellable.
create or replace function moderate_product_proposal(
  p_proposal_id uuid,
  p_decision text,
  p_expected_version int,
  p_corrected_payload jsonb default null,
  p_rejection_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_proposal record;
  v_final_payload jsonb;
  v_reviewer_email text;
begin
  if not (select public.is_admin(auth.uid())) then
    raise exception 'moderate_product_proposal réservé au rôle admin' using errcode = '42501';
  end if;
  if p_decision not in ('approve', 'reject') then
    raise exception 'décision invalide : %', p_decision;
  end if;
  if p_decision = 'reject' and (p_rejection_reason is null or btrim(p_rejection_reason) = '') then
    raise exception 'motif obligatoire pour un rejet';
  end if;

  select id, product_id, payload, status, version, reviewed_by
    into v_proposal
    from public.product_proposals where id = p_proposal_id for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'proposal_not_found');
  end if;
  if v_proposal.status <> 'pending' then
    select email into v_reviewer_email from auth.users where id = v_proposal.reviewed_by;
    return jsonb_build_object('ok', false, 'reason', 'already_handled',
      'status', v_proposal.status, 'reviewed_by_email', v_reviewer_email);
  end if;
  if v_proposal.version <> p_expected_version then
    return jsonb_build_object('ok', false, 'reason', 'version_conflict');
  end if;

  if p_decision = 'approve' then
    -- « Ce qui est publié est exactement ce que montre l'écran de modération au moment
    -- d'approuver » (cahier des charges admin §3b) : le payload CORRIGÉ par l'admin prime, jamais
    -- silencieusement remplacé par ce que le socio avait initialement soumis.
    v_final_payload := jsonb_build_object(
      'name', coalesce(p_corrected_payload->'name', v_proposal.payload->'name'),
      'description', coalesce(p_corrected_payload->'description', v_proposal.payload->'description'),
      'price_cop', coalesce(p_corrected_payload->'price_cop', v_proposal.payload->'price_cop'),
      'category', coalesce(p_corrected_payload->'category', v_proposal.payload->'category')
    );

    update public.products
       set name = v_final_payload->'name',
           description = v_final_payload->'description',
           price_cop = (v_final_payload->>'price_cop')::bigint,
           category = v_final_payload->>'category',
           updated_at = now()
     where id = v_proposal.product_id;

    update public.product_proposals
       set status = 'approved', payload = v_final_payload, reviewed_by = auth.uid(),
           reviewed_at = now(), version = version + 1, updated_at = now()
     where id = p_proposal_id;

    perform public.log_admin_action('product_proposal.approve', 'products', v_proposal.product_id,
      null, v_final_payload, null);
  else
    update public.product_proposals
       set status = 'rejected', rejection_reason = p_rejection_reason, reviewed_by = auth.uid(),
           reviewed_at = now(), version = version + 1, updated_at = now()
     where id = p_proposal_id;

    perform public.log_admin_action('product_proposal.reject', 'product_proposals', p_proposal_id,
      null, null, p_rejection_reason);
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

-- La correction admin reste bornée aux 4 mêmes champs de contenu que la feature 15 (jamais un
-- détour pour changer sellable/commission via cette RPC — ces décisions restent celles des
-- features 4/3 dédiées, pas dupliquées ici).
grant execute on function moderate_product_proposal(uuid, text, int, jsonb, text) to authenticated;
