-- Spec 08 (Admin : suppression réelle d'une activité) — RPC delete_product. Cahier admin §3c :
-- CRUD complet sur toute fiche, "une fiche déjà commandée ne se supprime jamais (dépubliée à la
-- place, pour ne jamais casser l'historique d'une commande existante)".
--
-- security definer, set search_path = '' (checklist hifago/CLAUDE.md §3.3) — PAS security invoker
-- malgré le calibrage plus léger de set_product_sellable (20260813240000, qui ne touche que
-- products, RLS-directe) : product_availability ET product_proposals révoquent explicitement
-- INSERT/UPDATE/DELETE pour authenticated (RPC-only par GRANT, cf. 20260813194515/20260813234500)
-- — un DELETE en security invoker échouerait par "permission denied" avant même que la RLS ne
-- s'applique. is_admin() vérifié explicitement en tête : security definer contourne
-- products_write_admin entièrement, rien d'autre ne protège cet accès.
create or replace function delete_product(
  p_product_id uuid,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before jsonb;
  v_order_lines_count int;
begin
  if not (select public.is_admin(auth.uid())) then
    raise exception 'delete_product réservé au rôle admin' using errcode = '42501';
  end if;

  -- Snapshot COMPLET de la ligne (pas seulement les champs modifiés comme set_product_sellable) :
  -- seul moyen de reconstruire un "annuler" plus tard (pas construit ici) — après le DELETE plus
  -- bas, la ligne products n'existe plus nulle part ailleurs pour la retrouver.
  select to_jsonb(p) into v_before from public.products p where p.id = p_product_id;

  if v_before is null then
    raise exception 'produit introuvable';
  end if;

  -- order_lines est LE signal fiable de "déjà commandée" (RPC-only, aucune cascade) — n'importe
  -- quel statut de ligne compte, y compris une ligne annulée : elle prouve qu'une commande a
  -- existé, ce qui suffit à l'invariant "jamais supprimée", indépendamment de son issue.
  select count(*) into v_order_lines_count
    from public.order_lines where product_id = p_product_id;

  if v_order_lines_count > 0 then
    -- errcode dédié (23503, réutilisé pour sa justesse sémantique comme 23505 l'est déjà ailleurs
    -- pour "code déjà attribué", 20260814233000) : le client distingue ce cas sans dépendre du
    -- texte du message.
    raise exception 'esta actividad ya fue reservada : despublícala en lugar de eliminarla'
      using errcode = '23503';
  end if;

  -- Nettoyage des tables sans cascade — jamais de commande dessus (vérifié ci-dessus), donc rien
  -- d'irréversible ici. product_media (spec 04) et product_tag_assignments (spec 08) cascadent
  -- déjà (on delete cascade), rien à faire pour elles.
  delete from public.product_calendar where product_id = p_product_id;
  delete from public.product_availability where product_id = p_product_id;
  delete from public.product_proposals where product_id = p_product_id;

  delete from public.products where id = p_product_id;

  perform public.log_admin_action('product.delete', 'products', p_product_id, v_before, null, p_note);
end;
$$;

-- Le privilège par défaut sur une fonction créée par le rôle postgres n'inclut pas EXECUTE pour
-- anon/authenticated (cf. hifago/CLAUDE.md §11.1) — accordé explicitement.
grant execute on function delete_product(uuid, text) to authenticated;
