-- Spec 34 Tranche 1 — LE contrat « une commande vue par son client », et les deux lecteurs.
--
-- ⚠️ POURQUOI UNE FONCTION PARTAGÉE PLUTÔT QUE DEUX jsonb_build_object.
-- Deux écrans répondent à la même question — que peut voir un client de sa commande ? — par deux
-- portes différentes : un JETON (/reserva/<jeton>, spec 33) et une IDENTITÉ (/cuenta/reservas,
-- cette spec). Deux constructions séparées auraient divergé au premier champ ajouté, et le premier
-- champ ajouté est celui de ce lot (establishment_slug). La recommandation portée à l'ouverture du
-- lot était « que le détail côté compte rende la MÊME forme que le détail côté jeton » ; elle est
-- tenue au sens fort : ce n'est pas la même forme, c'est la même fonction.
--
-- ⚠️ CE QUI NE SORT JAMAIS D'ICI. Aucune colonne de commission — commission_case, acompte_pct,
-- referrer_pct, app_pct, referrer_commission_cop, app_commission_cop, referrer_partner_id. Ce
-- n'est pas un oubli reconductible : order_lines_select autorise `account_id = auth.uid()` sur
-- TOUTES les colonnes, donc rien en base ne s'oppose à leur lecture — l'exclusion est applicative,
-- et c'est exactement la faute que le portail LEGACY commet aujourd'hui en production
-- (portalService.js renvoie commission_estimee_cop au front client). La liste blanche ci-dessous
-- est donc le SEUL rempart de ce chemin, et un test pgTAP compte les clés pour qu'il le reste
-- (CLAUDE.md §11.20 : une règle que rien ne vérifie est un souhait).
--
-- ⚠️ `orders.status` EST RETIRÉ du payload (spec 34 invariant 4, décision ⑧). La colonne vaut
-- 'confirmed' sur toute ligne, aucun update ne l'écrit nulle part, et 20260814161500 l'assume par
-- écrit (« placeholder, non calculé »). La retirer fait passer « ne pas l'afficher » d'une
-- discipline à une impossibilité. Vérifié avant : aucune assertion pgTAP ne la lisait, et
-- getOrderByToken.ts ne la portait pas jusqu'au TypeScript.

-- ---------------------------------------------------------------------------------------------
-- 1. Le contrat partagé. JAMAIS exposée : elle n'est pas une API, elle est un contrat interne.
-- ---------------------------------------------------------------------------------------------
--
-- Paramètre COMPOSITE (public.orders) plutôt qu'un uuid : list_my_orders l'appelle alors en une
-- passe (`select public.order_for_client_jsonb(o) from public.orders o where …`) sans re-sonder la
-- clé primaire une fois par commande, et une colonne ajoutée à `orders` ne casse pas la signature.
--
-- ⚠️ `(p_order).colonne` et jamais `p_order.colonne` : en language sql, `p_order.id` serait lu
-- comme la colonne `id` d'une table nommée `p_order`. Les parenthèses lèvent l'ambiguïté.
create or replace function public.order_for_client_jsonb(p_order public.orders)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with lignes as (
    select
      jsonb_build_object(
        'id', ol.id,
        -- Les libellés sortent BRUTS (jsonb {es, en, …}) : la résolution dans la locale du
        -- visiteur est faite côté TypeScript par resolveLocalizedField, exactement comme
        -- getCartLines (spec 32). Cette couche ne traduit rien.
        'product_name', p.name,
        'product_type', p.type,
        'product_slug', p.slug,
        'establishment_name', e.name,
        -- Spec 34 décision ③ : le lien vers la fiche. Rendu INCONDITIONNELLEMENT, même si
        -- l'établissement est dépublié — recopier ici le prédicat d'establishments_select_public
        -- (status='active' ET au moins un produit sellable) créerait une SECONDE définition de
        -- « publiquement visible », qui est exactement la duplication ayant produit le défaut
        -- corrigé par 20260827270000. Conséquence assumée : un 404 rare (spec 34 §9).
        'establishment_slug', e.slug,
        -- Spec 34 décision ⑥ : le contact. Rendu inconditionnellement AUSSI, et pour une raison
        -- opposée — c'est justement quand un établissement quitte la vitrine que le client a
        -- besoin de le joindre au sujet d'une réservation déjà payée. NULL = pas de bouton côté
        -- écran, jamais un bouton mort (la colonne est nullable depuis 20260908202000).
        'establishment_contact_phone', e.contact_phone,
        'date', ol.date,
        'end_date', ol.end_date,
        'slot_start_time', ol.slot_start_time,
        'qty', ol.qty,
        'price_cop', ol.price_cop,
        -- Spec 34 décision ④ : les DEUX montants par prestation — ce qui a été payé en ligne pour
        -- elle (acompte_cop) et son prix total (total_cop), tous deux FIGÉS à la commande
        -- (20260814180000). C'est ce qui rend l'annulation par prestation honnête : une ligne
        -- annulée garde son « payé, non remboursable » sans fausser aucun total global.
        'total_cop', ol.total_cop,
        'acompte_cop', ol.acompte_cop,
        'status', ol.status
      ) as ligne,
      ol.created_at as ligne_created_at,
      ol.id as ligne_id,
      ol.total_cop as ligne_total_cop,
      ol.acompte_cop as ligne_acompte_cop,
      -- Totaux sur les lignes VIVANTES seulement : une ligne annulée, expirée ou remplacée reste
      -- LISTÉE avec son statut — l'écran doit pouvoir la montrer barrée — mais ne gonfle aucun
      -- total. Prédicat repris tel quel de get_order_by_token (spec 33), pas redérivé.
      (ol.status not in ('cancelled_by_client', 'cancelled_by_provider', 'expired', 'superseded'))
        as vivante
    from public.order_lines ol
    join public.products p on p.id = ol.product_id
    left join public.establishments e on e.id = p.establishment_id
    where ol.order_id = (p_order).id
  )
  select jsonb_build_object(
    'id', (p_order).id,
    'reference', (p_order).reference,
    'payment_status', (p_order).payment_status,
    'created_at', (p_order).created_at,
    'holder_name', (p_order).holder_name,
    'holder_phone', (p_order).holder_phone,
    'holder_email', (p_order).holder_email,
    'total_cop', coalesce(sum(ligne_total_cop) filter (where vivante), 0),
    'acompte_cop', coalesce(sum(ligne_acompte_cop) filter (where vivante), 0),
    -- Ordre repris À L'IDENTIQUE de la spec 33 : les assertions pgTAP existantes indexent
    -- `lines,0`, elles cassent si cet ordre bouge.
    'lines', coalesce(jsonb_agg(ligne order by ligne_created_at, ligne_id), '[]'::jsonb)
  )
  from lignes;
$$;

-- ⚠️ Le revoke n'est pas décoratif et il vient EN PREMIER : PostgreSQL accorde EXECUTE à PUBLIC
-- sur toute fonction NEUVE — sens INVERSE des tables, piège re-mesuré le 2026-09-10
-- (.claude/rules/supabase.md). Ici, contrairement à ses deux appelants, l'accès voulu est ZÉRO :
-- cette fonction n'est pas une API. Le revoke la sort aussi du filtre du CAS 1 de
-- security_definer_exposure.test.sql, qui ne relève que les definer exécutables par anon/authenticated.
revoke all on function public.order_for_client_jsonb(public.orders) from public, anon, authenticated;

comment on function public.order_for_client_jsonb(public.orders) is
  'LE contrat « une commande vue par son client » (spec 34). Appelée par get_order_by_token '
  '(garde = le jeton) et list_my_orders (garde = l''identité) : une seule définition de ce qu''un '
  'client peut voir, pour que les deux écrans ne divergent jamais. Exclut TOUTE colonne de '
  'commission — rien en base ne s''y oppose (order_lines_select couvre toutes les colonnes), donc '
  'cette liste blanche est le seul rempart, et get_order_by_token.test.sql compte les clés. '
  'Jamais exposée : revoke all, appelable seulement par ses deux appelants security definer.';

-- ---------------------------------------------------------------------------------------------
-- 2. get_order_by_token — MÊME garde, même non-divulgation, corps rebranché sur le contrat.
-- ---------------------------------------------------------------------------------------------
--
-- Extraite par pg_get_functiondef avant réécriture (.claude/rules/supabase.md §7), et comparée au
-- fichier 20260910170100 : les deux ne différaient que par un commentaire (la base locale portait
-- encore la version d'avant le /simplify du 2026-09-10). C'est le FICHIER qui a fait foi.
--
-- Ce qui ne change PAS : la regex du jeton, la réponse `order_not_found` indistincte entre un
-- jeton faux et une commande absente, `stable security definer set search_path = ''`, et les
-- grants à anon + authenticated — son destinataire principal ouvre le lien depuis un email, sans
-- aucune session. Ce qui change : le payload vient du contrat partagé.
create or replace function public.get_order_by_token(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
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

  return jsonb_build_object('ok', true, 'order', public.order_for_client_jsonb(v_order));
end;
$$;

revoke all on function public.get_order_by_token(text) from public;
grant execute on function public.get_order_by_token(text) to anon, authenticated;

comment on function public.get_order_by_token(text) is
  'Lit une commande entière par son access_token (spec 33). Garde = le JETON, jamais auth.uid() : '
  'son destinataire principal ouvre le lien depuis un email, sans aucune session. Expose '
  'délibérément nom/téléphone/email du client — tradeoff assumé, cahier client §2b.9. Nommée dans '
  'les exceptions du cas 1 de security_definer_exposure.test.sql, comme check_partner_invitation. '
  'Depuis la spec 34, son payload vient de order_for_client_jsonb, partagé avec list_my_orders.';

-- ---------------------------------------------------------------------------------------------
-- 3. list_my_orders — la liste du compte. Garde = l'IDENTITÉ, et elle refuse un invité.
-- ---------------------------------------------------------------------------------------------
--
-- ⚠️ POURQUOI UNE RPC ET PAS UNE LECTURE RLS DIRECTE (orders_select autorise pourtant le
-- propriétaire à lire ses commandes, et getCartLines est un précédent légitime de lecture directe).
-- Parce qu'ici TROIS des quatre règles à écrire existent DÉJÀ en SQL, et que les réécrire côté
-- TypeScript en produirait une seconde définition que rien ne compare :
--   (a) le regroupement « à venir / passée » est celui de list_clients (20260828150000), au mot
--       près — `upcoming` ci-dessous est la fusion exacte de ses cas 'proxima' et 'en_casa' ;
--   (b) today_in_bogota() est REVOKE'd pour anon ET authenticated : une lecture TypeScript ne peut
--       littéralement pas appeler la définition du jour de référence, elle devrait la re-dériver ;
--   (c) PostgREST ne sait pas trier un parent par un agrégat d'enfants ;
--   (d) et la liste blanche de colonnes n'est vérifiable que si elle vit en base.
--
-- ⚠️ LE REFUS D'UNE SESSION ANONYME (spec 34 décision ⑦) EST ICI, PAS SEULEMENT À L'ÉCRAN. La
-- garde de zone vit dans (cuenta)/layout.tsx, qu'un autre agent construit en parallèle : je ne
-- peux pas l'y poser. En base, elle est vraie quoi qu'il arrive à l'écran — et elle satisfait le
-- CAS 2 de security_definer_exposure.test.sql sans ajouter d'entrée en liste blanche.
create or replace function public.list_my_orders()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_account_id uuid := auth.uid();
  -- Résolu UNE fois pour toute la requête, même geste que list_clients : les deux bornes
  -- ci-dessous doivent répondre à la même question au même instant.
  v_today constant date := public.today_in_bogota();
  v_orders jsonb;
begin
  if v_account_id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;

  if (select public.is_anonymous_session()) then
    return jsonb_build_object('ok', false, 'reason', 'anonymous_session');
  end if;

  with agg as (
    select
      o.id as order_id,
      -- « À venir » : au moins une prestation RÉSERVÉE dont la date de fin n'est pas passée.
      -- ⚠️ `coalesce(end_date, date)` et non `date` seule : un séjour commencé hier et fini demain
      -- est à venir, pas passé (c'est le cas 'en_casa' de list_clients). L'oublier est le défaut
      -- que le test pgTAP existe pour attraper.
      min(ol.date) filter (
        where ol.status = 'reserved' and coalesce(ol.end_date, ol.date) >= v_today
      ) as prochaine_date,
      -- « Passées » : la dernière date réellement portée par la commande. `superseded` exclue
      -- comme dans list_clients — une ligne remplacée porte une date qui n'existe plus.
      max(coalesce(ol.end_date, ol.date)) filter (
        where ol.status <> 'superseded'
      ) as derniere_date
    from public.orders o
    -- left join : une commande sans aucune ligne (défensif) reste rendue, en 'past'.
    left join public.order_lines ol on ol.order_id = o.id
    where o.account_id = v_account_id
    group by o.id
  )
  select coalesce(
           jsonb_agg(
             public.order_for_client_jsonb(o)
             || jsonb_build_object(
                  -- Le lien vers le DÉTAIL (spec 34 décision ③ : /reserva/<jeton>, jamais un
                  -- second écran de détail). Déjà lisible par le propriétaire en RLS directe —
                  -- CheckoutForm le lit ainsi depuis la spec 33 — donc aucune exposition nouvelle.
                  'access_token', o.access_token,
                  -- Le GROUPE est décidé ICI, jamais côté TypeScript, qui ne fait qu'un filter :
                  -- deux calculs de « à venir » divergeraient (spec 34 invariant 5).
                  'group', case when a.prochaine_date is not null then 'upcoming' else 'past' end
                )
             order by
               (a.prochaine_date is null),          -- false (0) d'abord : « à venir » en tête
               a.prochaine_date asc,                -- la plus proche en haut
               a.derniere_date desc nulls last,     -- passées : la plus récente en haut
               o.created_at desc, o.id asc          -- tiebreak déterministe, comme list_clients
           ),
           '[]'::jsonb
         )
    into v_orders
    from agg a
    join public.orders o on o.id = a.order_id;

  return jsonb_build_object('ok', true, 'orders', v_orders);
end;
$$;

revoke all on function public.list_my_orders() from public, anon, authenticated;
grant execute on function public.list_my_orders() to authenticated;

comment on function public.list_my_orders() is
  'La liste « Mis reservas » du compte client (spec 34). Garde = auth.uid(), et REFUS EXPLICITE '
  'd''une session anonyme (décision ⑦ du 2026-09-11) : un invité n''a pas d''espace compte. Rend '
  'le groupe (upcoming/past) et l''ordre DEPUIS LA BASE — le prédicat « à venir » est la fusion '
  'des cas proxima/en_casa de list_clients, pas une seconde définition. Payload = '
  'order_for_client_jsonb, plus access_token et group.';
