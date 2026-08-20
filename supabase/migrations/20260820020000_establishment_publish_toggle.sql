-- Retour Jérôme (2026-08-20) — establishments.status ('active'/'archived') est déjà posé à
-- 'active' à la création (create_establishment n'en précise jamais, hérite du défaut colonne) :
-- "l'établissement devient actif" à l'approbation d'une proposition existe donc déjà. Ce qui
-- manquait : le geste symétrique "Jérôme peut dépublier depuis l'admin" — aucune RPC ne touchait
-- jamais cette colonne. Même squelette que set_product_sellable
-- (20260813240000_set_product_sellable_rpc.sql), même raisonnement security invoker (RLS admin déjà
-- en place sur establishments, cf. establishments_write_admin ou équivalent — cette fonction n'a
-- besoin d'aucun bypass, juste d'un aller-retour atomique avec l'audit log).
create or replace function public.set_establishment_status(
  p_establishment_id uuid,
  p_status text,
  p_note text default null
)
returns jsonb
language plpgsql
security invoker
as $$
declare
  v_before text;
begin
  if p_status not in ('active', 'archived') then
    raise exception 'statut invalide : %', p_status;
  end if;

  select status into v_before from establishments where id = p_establishment_id;

  update establishments set status = p_status, updated_at = now()
   where id = p_establishment_id;

  if not found then
    -- Même discipline que set_product_sellable : un établissement refusé par la RLS (non-admin) et
    -- un établissement inexistant produisent le même message.
    raise exception 'establecimiento introuvable ou non autorisé';
  end if;

  perform log_admin_action(
    case when p_status = 'active' then 'establishment.publish' else 'establishment.unpublish' end,
    'establishments', p_establishment_id,
    jsonb_build_object('status', v_before),
    jsonb_build_object('status', p_status),
    p_note
  );
  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.set_establishment_status(uuid, text, text) to authenticated;
