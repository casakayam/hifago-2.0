-- Spec 23 Tranche 1 — notification admin "nouvelle proposition à modérer" (docs/03-cahier-des-
-- charges-admin.md:159-161). Trigger AFTER INSERT sur product_proposals/establishment_proposals,
-- pas un enqueue direct dans chaque RPC : les deux tables sont insérées depuis plusieurs sites
-- (submit_product_proposal, submit_photos_proposal, submit_product_creation_proposal côté produit ;
-- submit_establishment_creation_proposal, submit_establishment_edit_proposal côté établissement) —
-- un trigger est le seul point qui couvre tous les sites sans les dupliquer un par un (spec 23 §7).
--
-- Contenu volontairement minimal (décision Jérôme, spec 23 §3) : identifiant + lien vers l'écran
-- admin existant, jamais le contenu intégral de la proposition.
--
-- Isolation (spec 23 §8.1) : le corps du trigger est intégralement enveloppé — une proposition
-- doit toujours pouvoir s'insérer même si ce trigger casse. when others seul ne suffit pas
-- (query_canceled en est exclu par construction en PL/pgSQL).
create or replace function notify_admin_new_proposal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entity_name text;
  v_partner_name text;
  v_subject text;
  v_body text;
begin
  begin
    if tg_table_name = 'product_proposals' then
      select coalesce(new.payload -> 'name' ->> 'es', p.name ->> 'es')
        into v_entity_name
        from public.products p where p.id = new.product_id;
      v_subject := 'Nueva propuesta de producto pendiente de moderación';
    else
      select coalesce(new.payload -> 'name' ->> 'es', e.name ->> 'es')
        into v_entity_name
        from public.establishments e where e.id = new.establishment_id;
      v_subject := 'Nueva propuesta de establecimiento pendiente de moderación';
    end if;

    select display_name into v_partner_name from public.partners where id = new.partner_id;

    v_body := '<p>' || coalesce(v_entity_name, 'Sin nombre') || '</p>'
      || '<p>Propuesto por: ' || coalesce(v_partner_name, 'Socio desconocido') || '</p>'
      || '<p><a href="/admin/proposals/' || new.id || '">Ver propuesta</a></p>';

    perform public.notify_all_admins(
      'admin_new_proposal', v_subject, v_body, tg_table_name, new.id
    );
  exception
    when query_canceled then
      raise warning 'notify_admin_new_proposal: annulé (query_canceled) pour % % — %', tg_table_name, new.id, sqlerrm;
    when others then
      raise warning 'notify_admin_new_proposal: échec pour % % — %', tg_table_name, new.id, sqlerrm;
  end;

  return new;
end;
$$;

create trigger product_proposals_notify_admin
  after insert on product_proposals
  for each row execute function notify_admin_new_proposal();

create trigger establishment_proposals_notify_admin
  after insert on establishment_proposals
  for each row execute function notify_admin_new_proposal();
