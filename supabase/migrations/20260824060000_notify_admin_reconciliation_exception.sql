-- Spec 23 Tranche 1 — notification admin "nouvelle exception de réconciliation" (docs/03-cahier-
-- des-charges-admin.md:159-161). Trigger AFTER INSERT sur payment_reconciliation_entries/
-- pms_reconciliation_entries : les deux tables sont insérées depuis des Route Handlers et une Edge
-- Function (jamais via une RPC dédiée — apps/web/app/api/payments/webhook/route.ts,
-- supabase/functions/pms-poll-bookings/index.ts), un trigger est le seul point qui couvre tous les
-- sites sans les dupliquer (spec 23 §7).
--
-- Contenu volontairement minimal (spec 23 §3) : identifiant + lien vers /admin/reconciliation,
-- jamais le détail complet (raw_event/failure_reason restent dans l'écran, pas l'email).
--
-- Isolation (spec 23 §8.1) : corps intégralement enveloppé, when others + when query_canceled.
create or replace function notify_admin_new_reconciliation_exception()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_label text;
  v_subject text;
  v_body text;
begin
  begin
    if tg_table_name = 'pms_reconciliation_entries' then
      select coalesce(p.name ->> 'es', 'Producto sin nombre')
        into v_label
        from public.order_lines ol
        join public.products p on p.id = ol.product_id
       where ol.id = new.order_line_id;
      v_subject := 'Nueva excepción de reconciliación PMS';
    else
      -- payment_id nullable (spec 23 §9, cas limite) : un webhook peut échouer avant même d'être
      -- corrélé à un payments connu — libellé générique plutôt qu'un crash de construction.
      select coalesce('Pedido de ' || o.holder_name, 'Pedido no identificado')
        into v_label
        from public.payments pay
        join public.orders o on o.id = pay.order_id
       where pay.id = new.payment_id;
      v_label := coalesce(v_label, 'Pedido no identificado');
      v_subject := 'Nueva excepción de reconciliación de pago';
    end if;

    v_body := '<p>' || coalesce(v_label, 'Sin identificar') || '</p>'
      || '<p><a href="/admin/reconciliation">Ver reconciliaciones pendientes</a></p>';

    perform public.notify_all_admins(
      'admin_new_reconciliation_exception', v_subject, v_body, tg_table_name, new.id
    );
  exception
    when query_canceled then
      raise warning 'notify_admin_new_reconciliation_exception: annulé (query_canceled) pour % % — %', tg_table_name, new.id, sqlerrm;
    when others then
      raise warning 'notify_admin_new_reconciliation_exception: échec pour % % — %', tg_table_name, new.id, sqlerrm;
  end;

  return new;
end;
$$;

create trigger pms_reconciliation_entries_notify_admin
  after insert on pms_reconciliation_entries
  for each row execute function notify_admin_new_reconciliation_exception();

create trigger payment_reconciliation_entries_notify_admin
  after insert on payment_reconciliation_entries
  for each row execute function notify_admin_new_reconciliation_exception();
