-- Spec 33 Tranche 1 — la lecture d'une commande par son jeton.
--
-- ⚠️ POURQUOI UNE RPC PLUTÔT QU'UNE LECTURE service_role DANS UN ROUTE HANDLER.
-- Les deux marchent techniquement. La RPC est retenue parce que la logique d'autorisation vit
-- alors EN BASE, là où un test pgTAP peut l'atteindre (CLAUDE.md §11.20 : une règle que rien ne
-- vérifie est un souhait). Le filet de cet écran, ce sont le jeton, ces tests et la revue —
-- JAMAIS « service_role », qui contourne RLS entièrement et n'est un filet de rien (CLAUDE.md §3.5).
--
-- ⚠️ SON GARDE EST LE JETON, PAS `auth.uid()`, et c'est délibéré : un client qui ouvre le lien
-- depuis son email sur un appareil neuf n'a AUCUNE session, pas même anonyme — la spec 31 n'en pose
-- une qu'au premier ajout au panier. Exiger une identité ici fermerait l'écran à son destinataire
-- principal.
--
-- Conséquence : elle ne contient ni `is_admin(`, ni `auth.uid(`, ni `has_capability(`, donc le
-- CAS 1 de supabase/tests/database/security_definer_exposure.test.sql la relèvera. Elle doit y
-- être NOMMÉE, avec sa raison — le précédent exact existe déjà dans ce fichier :
-- `check_partner_invitation`, « publique par conception : vérifie un jeton d'invitation AVANT toute
-- inscription, donc nécessairement appelable sans compte ». Ajouter un nom à cette liste n'est pas
-- une formalité, c'est déclarer la fonction sans danger après avoir lu son corps.
--
-- Ce qu'elle expose, et ce qui est assumé par écrit : le nom, le téléphone et l'email du client.
-- C'est la contrepartie explicite d'une adresse sans limite de temps, ouvrable sans compte —
-- cahier client §2b.9, tranché le 2026-09-07, répété ici pour qu'il ne se perde pas.
create or replace function public.get_order_by_token(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_lines jsonb;
  v_total_cop bigint;
  v_acompte_cop bigint;
begin
  -- Jeton absent/malformé : traité comme introuvable, jamais distingué. ⚠️ Cette garde ne gagne
  -- RIEN en performance — `orders_access_token_key` est un index unique, la recherche ci-dessous
  -- est une sonde d'index, pas un balayage (une première version de ce commentaire affirmait le
  -- contraire). Elle est gardée pour ce qu'elle fait vraiment : documenter le format attendu à
  -- l'endroit où il est lu, et traiter `null` explicitement plutôt que par le hasard de
  -- `= null` qui ne matche rien.
  if p_token is null or p_token !~ '^[0-9a-f]{32}$' then
    return jsonb_build_object('ok', false, 'reason', 'order_not_found');
  end if;

  select * into v_order from public.orders where access_token = p_token;

  if not found then
    -- MÊME réponse qu'un jeton valide sur une commande supprimée : jamais un refus qui
    -- distinguerait « jeton faux » de « commande absente » (même discipline que cancel_order et
    -- create_payment_intent).
    return jsonb_build_object('ok', false, 'reason', 'order_not_found');
  end if;

  -- Les libellés sortent BRUTS (jsonb {es, en, …}) : la résolution dans la locale du visiteur est
  -- faite côté TypeScript par resolveLocalizedField, exactement comme getCartLines (spec 32). Cette
  -- couche ne traduit rien, comme lib/catalog/ ne compose aucun libellé.
  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'id', ol.id,
               'product_name', p.name,
               'product_type', p.type,
               'product_slug', p.slug,
               'establishment_name', e.name,
               'date', ol.date,
               'end_date', ol.end_date,
               'slot_start_time', ol.slot_start_time,
               'qty', ol.qty,
               'price_cop', ol.price_cop,
               'total_cop', ol.total_cop,
               'acompte_cop', ol.acompte_cop,
               'status', ol.status
             )
             order by ol.created_at, ol.id
           ),
           '[]'::jsonb
         )
    into v_lines
    from public.order_lines ol
    join public.products p on p.id = ol.product_id
    left join public.establishments e on e.id = p.establishment_id
   where ol.order_id = v_order.id;

  -- Totaux sur les lignes VIVANTES seulement : une ligne annulée, expirée ou remplacée
  -- (`superseded`, modify_order_line) reste LISTÉE avec son statut — l'écran doit pouvoir la
  -- montrer barrée — mais ne gonfle aucun total. Même esprit que create_payment_intent, qui ne
  -- facture jamais une ligne qui n'est plus active ; élargi ici à 'fulfilled'/'no_show', qui sont
  -- des lignes réellement dues, contrairement à ce que voit create_payment_intent (où tout est
  -- encore 'reserved' au moment de payer).
  select coalesce(sum(ol.total_cop), 0), coalesce(sum(ol.acompte_cop), 0)
    into v_total_cop, v_acompte_cop
    from public.order_lines ol
   where ol.order_id = v_order.id
     and ol.status not in ('cancelled_by_client', 'cancelled_by_provider', 'expired', 'superseded');

  return jsonb_build_object(
    'ok', true,
    'order', jsonb_build_object(
      'id', v_order.id,
      'reference', v_order.reference,
      'status', v_order.status,
      'payment_status', v_order.payment_status,
      'created_at', v_order.created_at,
      'holder_name', v_order.holder_name,
      'holder_phone', v_order.holder_phone,
      'holder_email', v_order.holder_email,
      'total_cop', v_total_cop,
      'acompte_cop', v_acompte_cop,
      'lines', v_lines
    )
  );
end;
$$;

-- ⚠️ Le `revoke` d'abord, et il n'est pas décoratif : PostgreSQL accorde EXECUTE à PUBLIC sur toute
-- fonction NEUVE — sens INVERSE des tables, piège re-mesuré le 2026-09-10
-- (.claude/rules/supabase.md). Sans lui, les grants ci-dessous ne décriraient pas l'accès réel,
-- ils le décoreraient. Ici l'accès voulu se trouve être le même, mais il devient EXPLICITE.
revoke all on function public.get_order_by_token(text) from public;
grant execute on function public.get_order_by_token(text) to anon, authenticated;

comment on function public.get_order_by_token(text) is
  'Lit une commande entière par son access_token (spec 33). Garde = le JETON, jamais auth.uid() : '
  'son destinataire principal ouvre le lien depuis un email, sans aucune session. Expose '
  'délibérément nom/téléphone/email du client — tradeoff assumé, cahier client §2b.9. Nommée dans '
  'les exceptions du cas 1 de security_definer_exposure.test.sql, comme check_partner_invitation.';
