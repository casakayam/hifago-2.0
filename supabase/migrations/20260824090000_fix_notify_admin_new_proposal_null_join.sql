-- Spec 23 Tranche 1 — corrige notify_admin_new_proposal() (20260824050000) : bug trouvé en testant
-- (pgTAP, notification_admin_events.test.sql) — pour une proposition kind='create'
-- (product_id/establishment_id encore NULL, l'entité n'existe pas avant approbation), le
-- `select coalesce(new.payload->'name'->>'es', p.name->>'es') into v_entity_name from products p
-- where p.id = new.product_id` ne retourne AUCUNE ligne quand product_id/establishment_id est
-- NULL — la clause FROM/WHERE ne matche rien, donc v_entity_name reste NULL, le coalesce n'étant
-- jamais évalué faute de ligne source. Corrigé : lire d'abord le payload en assignation simple
-- (toujours évaluée, sans FROM), puis ne retomber sur la jointure que si nécessaire ET que l'id
-- existe. CREATE OR REPLACE seul suffit (aucune signature/trigger à recréer).
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
    v_entity_name := new.payload -> 'name' ->> 'es';

    if v_entity_name is null then
      if tg_table_name = 'product_proposals' and new.product_id is not null then
        select p.name ->> 'es' into v_entity_name from public.products p where p.id = new.product_id;
      elsif tg_table_name = 'establishment_proposals' and new.establishment_id is not null then
        select e.name ->> 'es' into v_entity_name from public.establishments e where e.id = new.establishment_id;
      end if;
    end if;

    if tg_table_name = 'product_proposals' then
      v_subject := 'Nueva propuesta de producto pendiente de moderación';
    else
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
