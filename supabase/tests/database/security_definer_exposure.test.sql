-- L'invariant que les deux failles du 2026-08-27 ont rendu nécessaire, et qui les aurait toutes
-- attrapées : TOUTE fonction SECURITY DEFINER de `public` exposée à `anon` ou `authenticated` doit
-- porter un garde interne — sinon la RLS ne la rattrape pas (elle s'exécute avec les droits du
-- propriétaire) et le seul rempart devient un grant, qui se perd en silence.
--
-- Ce test remplace le point (5) laissé non automatisé dans rls_rpc_only_checklist.test.sql : il ne
-- demande plus de convention de marquage, il déduit le garde de la source (is_admin, auth.uid,
-- has_capability) et exige que toute exception soit NOMMÉE ici, avec sa raison.
--
-- Exclues à juste titre : les fonctions `returns trigger`, que Postgres refuse d'appeler
-- directement et que PostgREST n'expose pas.
--
-- ⚠️ Ajouter un nom à la liste ci-dessous n'est PAS une formalité : c'est déclarer qu'une fonction
-- exécutable par n'importe quel visiteur, avec les droits du propriétaire, est sans danger. Le
-- faire seulement après avoir lu son corps.
--
-- Cas 2 (spec 31, ajouté 2026-09-10) : le cas 1 ci-dessus reconnaît `auth.uid(` comme un garde
-- SUFFISANT — mais depuis les sessions anonymes Supabase, `auth.uid() is not null` ne signifie
-- plus « personne réelle » : il vaut aussi pour un visiteur de passage. Une RPC dont le SEUL garde
-- est ce test-là laisserait donc n'importe quel visiteur l'appeler, exactement le trou trouvé sur
-- consume_partner_invitation (20260909200000) puis sur set_my_payout_account/
-- update_my_account_profile (20260910120000). Le cas 2 durcit : parmi les fonctions qui passent le
-- cas 1 via `auth.uid(` SEUL (ni is_admin/has_capability, qui excluent déjà structurellement un
-- anonyme — aucune identité anonyme n'a jamais de capacité), exige AUSSI l'un des deux :
--   - `is_anonymous_session(` — la fonction refuse explicitement un visiteur anonyme (invariant 4) ;
--   - `partner_id_for_account(` — un anonyme n'a structurellement jamais de partner_id (décision ④ :
--     sa ligne partner_accounts existe, mais sans partenaire), donc ce garde l'exclut tout autant,
--     à condition d'appeler le helper NOMMÉ — jamais une requête équivalente recopiée en ligne, que
--     ce test ne peut pas reconnaître de façon fiable (cf. le refactor de set_my_payout_account).
-- Sinon, la fonction doit figurer NOMMÉMENT dans la liste blanche ci-dessous (invariant 5, spec 31)
-- — jamais par commodité pour faire passer ce test, seulement après avoir vérifié qu'accepter un
-- visiteur anonyme est le comportement VOULU.

begin;
select plan(2);

select is(
  (
    select coalesce(string_agg(p.oid::regprocedure::text, ', ' order by p.proname), '')
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and pg_get_function_result(p.oid) <> 'trigger'
      and (
        has_function_privilege('anon', p.oid, 'EXECUTE')
        or has_function_privilege('authenticated', p.oid, 'EXECUTE')
      )
      and p.prosrc !~* 'is_admin\s*\('
      and p.prosrc !~* 'auth\.uid\s*\('
      and p.prosrc !~* 'has_capability\s*\('
      and p.proname not in (
        -- Prédicats appelés DANS des policies RLS : une policy s'évalue avec les droits du rôle
        -- appelant, donc leur EXECUTE par anon/authenticated est nécessaire au fonctionnement de
        -- la RLS elle-même. Toutes en lecture seule.
        'is_admin',
        'has_admin_capability',
        'has_capability',
        'partner_id_for_account',
        'establishment_slug_from_name',
        -- Publique par conception : vérifie un jeton d'invitation AVANT toute inscription, donc
        -- nécessairement appelable sans compte (spec 05).
        'check_partner_invitation',
        -- Même famille que ci-dessus, et pour la même raison exactement (spec 33) : son garde est
        -- un JETON à haute entropie porté par l'URL (orders.access_token, 128 bits), jamais
        -- auth.uid(). Son destinataire principal est un client qui ouvre le lien depuis son email
        -- de confirmation, sur un appareil où il n'a AUCUNE session — pas même anonyme, la spec 31
        -- n'en posant une qu'au premier ajout au panier. Exiger une identité fermerait l'écran à
        -- celui pour qui il est fait. Ce qu'elle expose (nom, téléphone, email du client) est
        -- assumé PAR ÉCRIT au cahier client §2b.9 comme la contrepartie d'une adresse sans limite
        -- de temps ; get_order_by_token.test.sql le vérifie explicitement plutôt que de le laisser
        -- à la discipline d'un SELECT applicatif.
        'get_order_by_token'
      )
  ),
  '',
  'toute RPC SECURITY DEFINER exposée à anon/authenticated a un garde interne, ou figure dans la liste des exceptions justifiées'
);

select is(
  (
    select coalesce(string_agg(p.oid::regprocedure::text, ', ' order by p.proname), '')
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and pg_get_function_result(p.oid) <> 'trigger'
      and (
        has_function_privilege('anon', p.oid, 'EXECUTE')
        or has_function_privilege('authenticated', p.oid, 'EXECUTE')
      )
      and p.prosrc ~* 'auth\.uid\s*\('
      and p.prosrc !~* 'is_admin\s*\('
      and p.prosrc !~* 'has_capability\s*\('
      and p.prosrc !~* 'is_anonymous_session\s*\('
      and p.prosrc !~* 'partner_id_for_account\s*\('
      and p.proname not in (
        -- is_anonymous_session() elle-même : lit auth.uid() pour résoudre la nature de LA session
        -- appelante, ce n'est pas un garde d'AUTORISATION — même rôle que is_admin/has_capability
        -- ci-dessus pour le cas 1, prédicat lu par les policies/RPC, pas soumis à ce contrôle.
        'is_anonymous_session',
        -- LISTE BLANCHE (invariant 5, spec 31) : ces RPC acceptent DÉLIBÉRÉMENT un visiteur
        -- anonyme — c'est le parcours client lui-même (panier, paiement, annulation). Ne pas
        -- ajouter search_catalog/search_catalog_tags/get_product_slots/expand_product_slots/
        -- client_key_for_order ici : elles ne contiennent aucun auth.uid( (lecture publique par
        -- construction), donc jamais captées par ce filtre — les y ajouter serait sans effet et
        -- laisserait croire, à tort, qu'elles ont un garde à surveiller.
        'create_order',
        'create_payment_intent'
        -- ⚠️ 'cancel_order' RETIRÉE le 2026-09-11 (spec 34 décision ⑩) : la fonction est droppée
        -- (20260911120000), et sa remplaçante `cancel_order_line` n'a besoin d'aucune entrée ici
        -- — elle appelle `is_anonymous_session()`, donc elle se défend elle-même et le filtre
        -- ci-dessus ne la relève pas. Cette liste RÉTRÉCIT : elle n'a jamais gagné d'entrée depuis
        -- la spec 31, et c'est la première qu'elle perd.
      )
  ),
  '',
  'toute RPC dont le SEUL garde est auth.uid() exclut explicitement une session anonyme (is_anonymous_session/partner_id_for_account), ou figure nommément dans la liste blanche (spec 31 invariant 5)'
);

select * from finish();
rollback;
