-- Feature 4 (Admin : publier / dépublier une activité) — RPC set_product_sellable.
-- Aucune nouvelle colonne : products.sellable existe depuis la Tranche 2, et products_write_admin
-- (Tranche 2) couvre déjà l'UPDATE en RLS directe — ce n'est pas ce basculement, à lui seul, qui
-- déclencherait le critère RPC-only (cf. hifago/CLAUDE.md §3). C'est le nouvel invariant d'audit
-- (correctif audit_log) qui impose de passer par une fonction plutôt qu'un update client direct :
-- la mise à jour de products et la ligne audit_log doivent être un seul aller-retour atomique,
-- jamais deux écritures séparées où l'une pourrait réussir sans l'autre.
create or replace function set_product_sellable(
  p_product_id uuid,
  p_sellable boolean,
  p_note text default null
)
returns void
language plpgsql
security invoker  -- pas definer : products_write_admin gate déjà l'UPDATE, cette fonction n'écrit
                   -- jamais directement dans une table RPC-only (audit_log) — seul
                   -- log_admin_action a besoin de son propre bypass, déjà géré en interne
as $$
declare
  v_before boolean;
begin
  select sellable into v_before from products where id = p_product_id;

  update products set sellable = p_sellable, updated_at = now()
   where id = p_product_id;

  if not found then
    -- Un produit refusé par la RLS (non-admin) et un produit qui n'existe pas produisent le même
    -- message, jamais un révélateur explicite de ce qui a échoué.
    raise exception 'produit introuvable ou non autorisé';
  end if;

  perform log_admin_action(
    case when p_sellable then 'product.publish' else 'product.unpublish' end,
    'products', p_product_id,
    jsonb_build_object('sellable', v_before),
    jsonb_build_object('sellable', p_sellable),
    p_note
  );
end;
$$;

-- Le privilège par défaut sur une fonction créée par le rôle postgres n'inclut pas EXECUTE pour
-- anon/authenticated (cf. hifago/CLAUDE.md §11) — accordé explicitement à authenticated (le
-- contrôle d'accès réel est RLS via products_write_admin, pas ce grant).
grant execute on function set_product_sellable(uuid, boolean, text) to authenticated;
