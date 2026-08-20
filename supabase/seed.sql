-- Données synthétiques — Tranche 1 (identité composable) uniquement. Aucune PII réelle, aucune
-- copie de production (cf. hifago/CLAUDE.md §7). Ce seed grossira au fil des tranches suivantes
-- (catalogue, disponibilité, commandes...) — normal, pas une dérive à corriger.
--
-- 4 profils demandés par le plan de la Tranche 1 :
--   1. Invitation en attente (jamais consommée)
--   2. Référent seul, actif
--   3. Référent + opérateur, actif
--   4. Référent suspendu
--
-- Les profils 2/3/4 sont créés en consommant réellement une invitation via la RPC
-- consume_partner_invitation (dogfooding : exerce le vrai chemin métier plutôt que d'insérer des
-- lignes à la main), puis leur statut de capacité est ajusté par UPDATE direct — aucune RPC
-- d'approbation/suspension admin n'existe encore à ce stade du chantier (backlog Partie B). Les
-- trois profils partagent la même séquence en 6 étapes ; factorisée en boucle plutôt que répétée.

-- 1. Invitation en attente --------------------------------------------------
insert into partner_codes (code) values ('SEED-PENDING');

insert into partner_invitations (token_hash, promo_code, onboarding_path, expires_at, partner_hint)
values (
  encode(extensions.digest('seed-pending-token', 'sha256'), 'hex'),
  'SEED-PENDING',
  'referrer',
  now() + interval '30 days',
  jsonb_build_object('display_name', 'Organisation en attente')
);

-- 2/3/4. Référent seul actif, référent+opérateur actif, référent suspendu ----
do $$
declare
  profile record;
begin
  for profile in
    select * from (values
      ('a0000000-0000-4000-8000-000000000002'::uuid, 'referent.actif@hifago.test',
       'SEED-REFACTIVE', 'seed-referent-actif-token', 'referrer', 'Référent Actif', 'active'),
      -- Opérateur actif : sa ligne operator (insérée par consume_partner_invitation ci-dessous)
      -- reste establishment_id = null (pending) après le correctif Tranche 1 — aucun
      -- établissement seedé pour ce partenaire à ce stade, comportement voulu, pas un oubli.
      ('a0000000-0000-4000-8000-000000000003'::uuid, 'operateur.actif@hifago.test',
       'SEED-OPACTIVE', 'seed-operateur-actif-token', 'provider', 'Opérateur Actif', 'active'),
      ('a0000000-0000-4000-8000-000000000004'::uuid, 'referent.suspendu@hifago.test',
       'SEED-REFSUSP', 'seed-referent-suspendu-token', 'referrer', 'Référent Suspendu', 'suspended')
    ) as t(account_id, email, code, token, onboarding_path, signer_name, final_status)
  loop
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      created_at, updated_at, raw_app_meta_data, raw_user_meta_data
    ) values (
      '00000000-0000-0000-0000-000000000000', profile.account_id, 'authenticated', 'authenticated',
      profile.email, crypt('Seed1234!', gen_salt('bf')), now(), now(), now(),
      '{"provider":"email","providers":["email"]}', '{}'
    );

    insert into partner_codes (code) values (profile.code);
    insert into partner_invitations (token_hash, promo_code, onboarding_path, expires_at, partner_hint)
    values (
      encode(extensions.digest(profile.token, 'sha256'), 'hex'),
      profile.code,
      profile.onboarding_path,
      now() + interval '30 days',
      jsonb_build_object('display_name', profile.signer_name || ' Org')
    );

    perform set_config(
      'request.jwt.claims',
      json_build_object('sub', profile.account_id, 'role', 'authenticated')::text,
      false
    );
    perform consume_partner_invitation(profile.token, profile.signer_name, 'v1', null, null);

    update partner_capabilities set status = profile.final_status
     where partner_id = partner_id_for_account(profile.account_id);
  end loop;
end $$;

reset role;
select set_config('request.jwt.claims', '', false);

-- Feature 1 (Admin : créer un établissement) — compte admin seedé. Nécessaire pour l'e2e
-- admin-establishment.spec.ts et pour toute future feature admin (aucun profil admin n'existait
-- avant cette feature). Capacité insérée directement, pas de flux d'invitation à consommer : une
-- capacité admin est account_id-scoped (jamais partner_id-scoped), cf.
-- partner_capabilities_scope — même schéma que les fixtures admin des tests pgTAP.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  created_at, updated_at, raw_app_meta_data, raw_user_meta_data
) values (
  '00000000-0000-0000-0000-000000000000', 'a0000000-0000-4000-8000-000000000005',
  'authenticated', 'authenticated', 'admin@hifago.test', crypt('Seed1234!', gen_salt('bf')),
  now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'
);

insert into partner_capabilities (account_id, role, source, status)
values ('a0000000-0000-4000-8000-000000000005', 'admin', 'migration', 'active');

-- Feature 31 (docs/specs/07-connexion-inscription-complete.md §8) — 2FA TOTP désormais obligatoire
-- pour is_admin() (AAL2, migration 20260815250000_admin_2fa_aal2.sql) : sans un facteur déjà
-- enrôlé, tout test e2e utilisant ce compte échouerait sur chaque écran admin. Secret FIXE (pas un
-- vrai secret, uniquement pour environnement de test local) : packages/e2e-support/src/mfa.ts
-- calcule le TOTP courant à partir de cette même valeur pour compléter la connexion
-- programmatique (loginAs) — jamais utilisé/valide en dehors de la base locale.
-- friendly_name = '' (jamais NULL) : le scanner Go de GoTrue attend une string, pas un NULL — une
-- valeur NULL ici casse silencieusement TOUTE connexion (pas seulement celle de ce compte), "sql:
-- Scan error on column index 2, name friendly_name: converting NULL to string is unsupported",
-- reproduit puis corrigé en écrivant cette migration (l'enrôlement réel via mfa.enroll() laisse
-- toujours une chaîne vide, jamais NULL, cf. logs auth de ce même test).
insert into auth.mfa_factors (id, user_id, factor_type, status, friendly_name, secret, created_at, updated_at)
values (
  'c0000000-0000-4000-8000-00000000000f', 'a0000000-0000-4000-8000-000000000005',
  'totp', 'verified', '', 'MUFUB2W7HB62XKO323JGYVPWPE7OJHI7', now(), now()
);

-- Feature 2 (products.establishment_id not null) — établissement créé AVANT le produit de
-- Checkpoint B ci-dessous (Checkpoint B a été codé avant que establishments n'existe, cf. plan) :
-- réordonné ici plutôt qu'un vrai backfill, rien ne persiste entre deux `db reset`. Même
-- partenaire ("Opérateur Actif Org") que le produit qu'il va porter.
insert into establishments (id, partner_id, name)
values (
  'b0000000-0000-4000-8000-000000000002',
  (select partner_id from partner_accounts where id = 'a0000000-0000-4000-8000-000000000003'),
  jsonb_build_object('es', 'Casa Kayam Guatapé')
);

-- Checkpoint B (premier écran réel) — catalogue + disponibilité de démonstration. Ajout ciblé,
-- ne touche à aucune ligne existante ci-dessus (identité/capacités, Tranche 1). Rattaché au
-- partenaire "Opérateur Actif Org" déjà seedé (le seul profil avec la capacité operator, cohérent
-- avec le rôle qui possède réellement un établissement/produit à vendre) et à l'établissement
-- ci-dessus (feature 2, même produit — pas un nouveau).
insert into products (
  id, partner_id, establishment_id, type, name, description, price_cop, unit, schedule, qty_unit,
  category, sellable, slug
)
values (
  'b0000000-0000-4000-8000-000000000001',
  (select partner_id from partner_accounts where id = 'a0000000-0000-4000-8000-000000000003'),
  'b0000000-0000-4000-8000-000000000002',
  'activity',
  jsonb_build_object(
    'es', 'Tour en lancha por el Embalse de Guatapé',
    'en', 'Boat tour on the Guatapé reservoir'
  ),
  jsonb_build_object(
    'es', 'Recorrido guiado de una hora por el embalse, salida desde el muelle principal.',
    'en', 'Guided one-hour tour of the reservoir, departing from the main dock.'
  ),
  80000,
  'per_person',
  'date',
  'qty',
  'nautica',
  true,
  'tour-lancha-guatape'
);

-- 5 dates de démonstration sur le même produit : une largement disponible (réservation réussie),
-- une déjà pleine (message d'échec clair), une à cupo=1 (« dernière place ») — cette dernière est
-- réutilisée à la fois par la vérification manuelle du Checkpoint B et par
-- e2e/reserve-concurrency.spec.ts (exactement une réservation concurrente doit réussir dessus) —
-- une réservée exclusivement à e2e/login.spec.ts (feature 6 : preuve que la session posée par
-- le vrai formulaire de connexion survit jusqu'au bout du parcours panier → checkout → create_order)
-- et une réservée exclusivement à e2e/attribution.spec.ts (feature 7 : parcours invité complet via
-- un lien ?ref=, sans partager de ressource avec les autres specs qui manipulent 2026-09-05/07/10/12).
insert into product_availability (product_id, date, capacity, booked)
values
  ('b0000000-0000-4000-8000-000000000001', '2026-09-05', 10, 0),
  ('b0000000-0000-4000-8000-000000000001', '2026-09-07', 1, 1),
  ('b0000000-0000-4000-8000-000000000001', '2026-09-10', 1, 0),
  ('b0000000-0000-4000-8000-000000000001', '2026-09-12', 10, 0),
  ('b0000000-0000-4000-8000-000000000001', '2026-09-13', 10, 0),
  -- Feature 8 : réservée exclusivement à e2e/cancel-order.spec.ts (setup direct via create_order,
  -- resetAvailability exige une ligne product_availability déjà existante pour ce (product, date)).
  ('b0000000-0000-4000-8000-000000000001', '2026-09-14', 10, 0),
  -- Feature 10 : réservée exclusivement à e2e/admin-order-status.spec.ts (même raison : setup
  -- direct via create_order pour créer une ligne reserved à faire passer à un statut terminal).
  ('b0000000-0000-4000-8000-000000000001', '2026-09-15', 10, 0),
  -- Feature 18 : réservée exclusivement à e2e/partner-qr-tool.spec.ts (parcours bout-en-bout via le
  -- vrai lien /[locale]/r/[code] généré par /partner/tools, disjointe de toutes les dates ci-dessus).
  ('b0000000-0000-4000-8000-000000000001', '2026-09-20', 10, 0);

-- Feature 15 (Socio : soumettre une proposition d'édition) — profil dédié isolé. Constat en
-- préparant cette feature : aucun compte seedé n'a de capacité operator à la fois ACTIVE et
-- SCOPÉE à un établissement précis. operateur.actif@hifago.test (profil 3 ci-dessus) a bien une
-- capacité operator active, mais son establishment_id reste volontairement null ("en attente",
-- documenté plus haut) — has_capability(uid, 'operator', establishment_id) avec un
-- establishment_id précis ne matche jamais une ligne en attente (établissement_id null), donc
-- submit_product_proposal renverrait systématiquement capability_suspended pour ce compte.
-- Nouveau partenaire/compte/établissement/produit entièrement isolé plutôt que de toucher à la
-- ligne existante d'operateur.actif ou de réutiliser son partner_id : has_capability résout par
-- partner_id (pas par account_id, cf. correctif Tranche 1), donc ajouter une deuxième ligne
-- operator au partenaire "Opérateur Actif Org" aurait accordé un effet de bord — une nouvelle
-- capacité effective — au compte operateur.actif existant, qu'on ne doit pas modifier.
insert into partners (id, display_name)
values ('b0000000-0000-4000-8000-000000000003', 'Prestador Propuestas Org');

insert into establishments (id, partner_id, name)
values (
  'b0000000-0000-4000-8000-000000000004',
  'b0000000-0000-4000-8000-000000000003',
  jsonb_build_object('es', 'Establecimiento Propuestas E2E')
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  created_at, updated_at, raw_app_meta_data, raw_user_meta_data
) values (
  '00000000-0000-0000-0000-000000000000', 'a0000000-0000-4000-8000-000000000006',
  'authenticated', 'authenticated', 'operador.propuestas@hifago.test',
  crypt('Seed1234!', gen_salt('bf')), now(), now(), now(),
  '{"provider":"email","providers":["email"]}', '{}'
);

-- partner_accounts est déjà provisionné par le trigger handle_new_auth_user (Tranche 1) avec
-- partner_id null — rattaché ici directement (pas de flux d'invitation à consommer, ce profil n'a
-- besoin que de sa capacité finale, pas de tester le parcours d'onboarding).
update partner_accounts set partner_id = 'b0000000-0000-4000-8000-000000000003'
 where id = 'a0000000-0000-4000-8000-000000000006';

-- referrer inséré avant operator : l'invariant operator ⇒ referrer (0002) exige que la ligne
-- referrer existe déjà au moment de l'insertion operator, même ordre que consume_partner_invitation.
insert into partner_capabilities (partner_id, role, source, status)
values ('b0000000-0000-4000-8000-000000000003', 'referrer', 'migration', 'active');

insert into partner_capabilities (partner_id, role, source, status, establishment_id)
values (
  'b0000000-0000-4000-8000-000000000003', 'operator', 'migration', 'active',
  'b0000000-0000-4000-8000-000000000004'
);

-- sellable=false à dessein : preuve que products_select_own (feature 15) est bien nécessaire pour
-- que ce socio voie sa propre fiche dans /partner/products (products_select_public, Tranche 2, ne
-- couvre que sellable=true ou admin).
insert into products (
  id, partner_id, establishment_id, type, name, description, price_cop, unit, schedule, qty_unit,
  category, sellable, slug
)
values (
  'b0000000-0000-4000-8000-000000000005',
  'b0000000-0000-4000-8000-000000000003',
  'b0000000-0000-4000-8000-000000000004',
  'activity',
  jsonb_build_object('es', 'Caminata ecológica por el bosque nativo'),
  jsonb_build_object('es', 'Caminata guiada de dos horas por senderos del bosque nativo.'),
  60000,
  'per_person',
  'date',
  'qty',
  'bienestar',
  false,
  'caminata-ecologica-propuestas'
);

-- Feature 6 (Client : composer un panier multi-établissement) — second produit sellable=true,
-- rattaché à un SECOND établissement ("Establecimiento Propuestas E2E", déjà seedé par la feature
-- 15 — réutilisé plutôt qu'un troisième partenaire créé pour la forme : un établissement qui
-- porte à la fois une fiche non publiée (feature 15) et une fiche publiée est un scénario normal,
-- pas une confusion entre les deux features). Sans ce second produit sellable, le scénario
-- multi-établissement (cahier des charges client §3e) ne serait pas testable de bout en bout : un
-- panier avec des lignes de deux établissements différents nécessite deux produits publiés
-- distincts, jamais un seul.
insert into products (
  id, partner_id, establishment_id, type, name, description, price_cop, unit, schedule, qty_unit,
  category, sellable, slug
)
values (
  'b0000000-0000-4000-8000-000000000006',
  'b0000000-0000-4000-8000-000000000003',
  'b0000000-0000-4000-8000-000000000004',
  'activity',
  jsonb_build_object('es', 'Kayak en el Embalse de Guatapé', 'en', 'Kayaking on the Guatapé reservoir'),
  jsonb_build_object(
    'es', 'Recorrido en kayak de dos horas, equipo incluido, salida desde el muelle comunitario.',
    'en', 'Two-hour kayak tour, equipment included, departing from the community dock.'
  ),
  45000,
  'per_person',
  'date',
  'qty',
  'nautica',
  true,
  'kayak-embalse-guatape'
);

-- Même date que la disponibilité principale de tour-lancha-guatape (Checkpoint B, 2026-09-05) —
-- un client peut composer un panier avec une ligne de chaque établissement sur le même jour,
-- scénario le plus direct pour e2e/cart-multi-establishment.spec.ts. La date déjà pleine de
-- tour-lancha-guatape (2026-09-07, capacity=1/booked=1) est réutilisée telle quelle pour le cas
-- "capacité dépassée" de ce même test — pas besoin d'une deuxième ressource pleine ici.
insert into product_availability (product_id, date, capacity, booked)
values ('b0000000-0000-4000-8000-000000000006', '2026-09-05', 10, 0);

-- Feature 9 (Admin : liste des commandes) — 2 commandes de démonstration pour exercer les deux cas
-- d'affichage du référent dès le premier chargement de /admin/orders : une "directe" et une avec
-- un référent externe résolu. Dates dédiées (2026-10-01/02), disjointes de celles utilisées par
-- les specs e2e du panier (2026-09-05/07/10/12/13/14). Préfixe c0000000 (nouveau domaine, ni
-- identité ni catalogue).
insert into partner_codes (code, partner_id, active)
values ('SEED-DEMO-REF', 'b0000000-0000-4000-8000-000000000003', true);

-- Commande directe : invité (account_id null), aucun référent — cf. correctif réservation invité.
insert into orders (id, account_id, holder_name, holder_phone, holder_email)
values (
  'c0000000-0000-4000-8000-000000000001', null, 'Cliente Directo Seed', '+57 300 000 0001',
  'cliente.directo.seed@test.local'
);
-- Feature 11 (snapshot prix+commission) : commande directe, qty=1, price_cop=80000 (produit
-- tour-lancha-guatape ci-dessus) → total_cop=80000, direct (0/17), acompte_cop=13600.
-- holder_name obligatoire (spec 17 §0 Tranche 1, 20260817180000) : bug latent trouvé en testant
-- (spec 19) — ce seed n'avait jamais été rejoué depuis que la colonne est devenue NOT NULL,
-- corrigé ici sur les 3 inserts order_lines du fichier, pas seulement celui-ci.
insert into order_lines (
  order_id, account_id, product_id, date, qty, status, holder_name,
  price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
  acompte_cop, referrer_commission_cop, app_commission_cop
) values (
  'c0000000-0000-4000-8000-000000000001', null,
  'b0000000-0000-4000-8000-000000000001', '2026-10-01', 1, 'reserved', 'Cliente Directo Seed',
  80000, 80000, 'direct', 0.17, 0, 0.17, 13600, 0, 13600
);

-- Commande avec référent résolu : compte enregistré (referente.actif), code SEED-DEMO-REF
-- présenté, référent externe (Prestador Propuestas Org — différent du partenaire propriétaire du
-- produit tour-lancha-guatape) — scénario réaliste, pas une auto-référence.
insert into orders (
  id, account_id, holder_name, holder_phone, holder_email, referrer_partner_id, attribution_code, attribution_source
)
values (
  'c0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000002',
  'Cliente Referido Seed', '+57 300 000 0002', 'cliente.referido.seed@test.local',
  'b0000000-0000-4000-8000-000000000003', 'SEED-DEMO-REF', 'link'
);
-- Feature 11 : référent externe (b0000000-...-0003, différent du propriétaire du produit), qty=2,
-- price_cop=80000 → total_cop=160000, external_referrer (10/7), referrer_commission_cop=16000,
-- app_commission_cop=11200.
-- Feature 14 : referrer_partner_id dénormalisé ici aussi (colonne créée après cette ligne, backfill
-- de cohérence — sans lui, ce référent ne verrait pas cette ligne dans /partner/commissions malgré
-- orders.referrer_partner_id déjà résolu ci-dessus).
insert into order_lines (
  order_id, account_id, product_id, date, qty, status, referrer_partner_id, holder_name,
  price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
  acompte_cop, referrer_commission_cop, app_commission_cop
) values (
  'c0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000002',
  'b0000000-0000-4000-8000-000000000001', '2026-10-02', 2, 'reserved',
  'b0000000-0000-4000-8000-000000000003', 'Cliente Referido Seed',
  80000, 160000, 'external_referrer', 0.17, 0.10, 0.07, 27200, 16000, 11200
);

-- Revue admin clientes (Jérôme, 2026-08-19) — payments n'avait jusqu'ici AUCUNE ligne dans ce
-- seed (table posée par 20260818200000, jamais alimentée) : premier consommateur réel de cette
-- table côté affichage (fiche détail client), sans ligne le bloc paiement resterait vide de tout
-- premier chargement local/e2e. amount_cop = l'acompte de cette commande (27200, cf. ligne
-- au-dessus), jamais le total (cahier des charges §3f).
insert into payments (order_id, mp_payment_id, status, amount_cop, payer_email) values (
  'c0000000-0000-4000-8000-000000000002', 'SEED-MP-PAYMENT-001', 'approved', 27200,
  'cliente.referido.seed@test.local'
);

-- Feature 12 (ledger) : commande DÉDIÉE (pas les 2 ci-dessus, "Cliente Directo Seed"/"Cliente
-- Referido Seed" — e2e/admin-orders-list.spec.ts scope ses locators par nom de titulaire et
-- s'attend à ce que "Cliente Referido Seed" reste ABSENT du filtre "Realizada", une ligne fulfilled
-- de plus sur cette même commande casserait cette assertion). Même référent externe
-- (b0000000-...-0003) sur 2 lignes, statuts différents, pour exercer visuellement earned et
-- redistributed dès le premier chargement de /admin/orders/[id] — sans elles, la différence entre
-- les deux ne serait jamais visible (le ledger ne modifie jamais ces colonnes, il les DÉRIVE à la
-- lecture, cf. deriveLedgerEntry).
insert into orders (
  id, account_id, holder_name, holder_phone, holder_email, referrer_partner_id, attribution_code, attribution_source
)
values (
  'c0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000002',
  'Cliente Ledger Seed', '+57 300 000 0003', 'cliente.ledger.seed@test.local',
  'b0000000-0000-4000-8000-000000000003', 'SEED-DEMO-REF', 'link'
);
-- qty=1, price_cop=80000 → total_cop=80000, external_referrer (10/7) : acompte_cop=13600,
-- referrer_commission_cop=8000, app_commission_cop=5600 (identique sur les 3 lignes, seul le
-- statut diffère). Feature 14 : referrer_partner_id dénormalisé aussi ici — ce même trio
-- fulfilled/cancelled_by_client/fulfilled(payé) sert désormais aussi de fixture e2e pour
-- e2e/partner-commissions.spec.ts (compte operador.propuestas, référent de b0000000-...-0003),
-- pas seulement pour le ledger admin (feature 12) qui a introduit les deux premières.
insert into order_lines (
  order_id, account_id, product_id, date, qty, status, referrer_partner_id, holder_name,
  price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
  acompte_cop, referrer_commission_cop, app_commission_cop
) values
  -- fulfilled → ledger_entries status 'due' : referrer_commission_cop reste dû au référent tel quel.
  ('c0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000002',
   'b0000000-0000-4000-8000-000000000001', '2026-10-03', 1, 'fulfilled',
   'b0000000-0000-4000-8000-000000000003', 'Cliente Ledger Seed',
   80000, 80000, 'external_referrer', 0.17, 0.10, 0.07, 13600, 8000, 5600),
  -- cancelled_by_client → ledger_entries status 'void' : referrer_commission_cop redirigé vers le
  -- prestataire (compensation), jamais simplement perdu — c'est précisément ce que l'écran doit
  -- rendre visible.
  ('c0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000002',
   'b0000000-0000-4000-8000-000000000001', '2026-10-04', 1, 'cancelled_by_client',
   'b0000000-0000-4000-8000-000000000003', 'Cliente Ledger Seed',
   80000, 80000, 'external_referrer', 0.17, 0.10, 0.07, 13600, 8000, 5600),
  -- fulfilled + déjà réglé (spec 19 §0 Tranche 0) → ledger_entries status 'paid' directement en
  -- fixture (représente un règlement historique déjà fait, pas une transition rejouée via les RPC
  -- — même logique que pms_reconciliation_entries qui seed aussi un statut 'resolved' directement).
  -- Seule ligne du seed capable de prouver que /partner/commissions affiche "Pagada", un état que
  -- l'ancienne dérivation (deriveLedgerEntry) ne pouvait structurellement jamais produire.
  ('c0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000002',
   'b0000000-0000-4000-8000-000000000001', '2026-10-05', 1, 'fulfilled',
   'b0000000-0000-4000-8000-000000000003', 'Cliente Ledger Seed',
   80000, 80000, 'external_referrer', 0.17, 0.10, 0.07, 13600, 8000, 5600);

-- Spec 19 §0 Tranche 0 (ledger de règlement réel) — ledger_entries correspondantes aux 4 lignes
-- external_referrer ci-dessus, comme create_order/set_order_line_status/mark_ledger_entry_paid les
-- auraient produites elles-mêmes (jamais un id en dur : order_lines n'a pas d'id explicite dans ses
-- INSERT, résolu ici par sous-requête (order_id, date), même patron que
-- pms_reconciliation_entries plus bas). Sert à la fois au dashboard référent (/partner/commissions,
-- désormais lu depuis le vrai ledger, plus une dérivation) et à l'écran admin (/admin/ledger).
insert into ledger_entries (order_line_id, beneficiary_type, referrer_partner_id, entry_type, amount_cop, status)
select id, 'referrer', 'b0000000-0000-4000-8000-000000000003', 'referral_earned', 16000, 'estimated'
  from order_lines
 where order_id = 'c0000000-0000-4000-8000-000000000002' and date = '2026-10-02';

insert into ledger_entries (order_line_id, beneficiary_type, referrer_partner_id, entry_type, amount_cop, status)
select id, 'referrer', 'b0000000-0000-4000-8000-000000000003', 'referral_earned', 8000, 'due'
  from order_lines
 where order_id = 'c0000000-0000-4000-8000-000000000003' and date = '2026-10-03';

-- cancelled_by_client (2026-10-04) : la part référent est void (jamais due, ligne pas réalisée) et
-- redirigée en compensation à l'établissement propriétaire du produit (b0000000-...-0002, "Casa
-- Kayam Guatapé") — même mécanique que set_order_line_status, §0 invariants spec 19.
insert into ledger_entries (order_line_id, beneficiary_type, referrer_partner_id, entry_type, amount_cop, status)
select id, 'referrer', 'b0000000-0000-4000-8000-000000000003', 'referral_earned', 8000, 'void'
  from order_lines
 where order_id = 'c0000000-0000-4000-8000-000000000003' and date = '2026-10-04';

-- 2026-10-05 : déjà réglé (paid_at fixe, pas now() — un seed déterministe ne dépend jamais de
-- l'heure d'exécution). comprobante_path/note factices, cohérents avec un vrai appel
-- mark_ledger_entry_paid.
insert into ledger_entries (
  order_line_id, beneficiary_type, referrer_partner_id, entry_type, amount_cop, status,
  comprobante_path, note, paid_at
)
select id, 'referrer', 'b0000000-0000-4000-8000-000000000003', 'referral_earned', 8000, 'paid',
  'comprobantes/seed-demo.pdf', 'Transferencia Bancolombia (seed)', '2026-10-06 10:00:00+00'
  from order_lines
 where order_id = 'c0000000-0000-4000-8000-000000000003' and date = '2026-10-05';

insert into ledger_entries (order_line_id, beneficiary_type, establishment_id, entry_type, amount_cop, status)
select id, 'establishment', 'b0000000-0000-4000-8000-000000000002', 'establishment_compensation', 8000, 'due'
  from order_lines
 where order_id = 'c0000000-0000-4000-8000-000000000003' and date = '2026-10-04';

-- Feature 22 (Admin : file de réconciliation PMS) — 2 entrées de démonstration (open/retrying),
-- rattachées à des order_lines RÉELLEMENT seedées ci-dessus (jamais un UUID inventé : order_lines
-- n'a pas d'id explicite dans ses INSERT, généré par gen_random_uuid(), donc résolu ici par
-- sous-requête sur (order_id, date) plutôt que codé en dur). Les deux lignes ciblées portent sur
-- tour-lancha-guatape (établissement "Casa Kayam Guatapé", b0000000-...-0002) pour que l'écran
-- affiche un contexte réaliste (établissement + référence de commande) dès son premier chargement.
insert into pms_reconciliation_entries (order_line_id, status, attempts, last_attempt_at)
select id, 'open', 1, now() - interval '2 hours'
  from order_lines
 where order_id = 'c0000000-0000-4000-8000-000000000001' and date = '2026-10-01';

insert into pms_reconciliation_entries (order_line_id, status, attempts, last_attempt_at)
select id, 'retrying', 2, now() - interval '30 minutes'
  from order_lines
 where order_id = 'c0000000-0000-4000-8000-000000000002' and date = '2026-10-02';

-- Feature 25 (Admin : audiences serveur + moteur de campagne) — 2 comptes clients ENREGISTRÉS
-- dédiés (jamais un simple invité : list_audience_members ne voit que les comptes avec une ligne
-- partner_accounts, jointe depuis auth.users) — l'un avec consentement marketing sur sa commande la
-- plus récente, l'autre sans, pour que e2e/admin-campaign.spec.ts observe une vraie répartition
-- envoyé/ignoré après traitement du lot, pas un seul cas. Aucun mot de passe/champ d'auth complet
-- nécessaire : ces comptes ne sont jamais connectés, seulement ciblés par une campagne admin.
insert into auth.users (id, email) values
  ('d0000000-0000-4000-8000-000000000001', 'campaign-client-consent-seed@test.local'),
  ('d0000000-0000-4000-8000-000000000002', 'campaign-client-no-consent-seed@test.local');

insert into orders (id, account_id, holder_name, holder_email, marketing_consent) values
  ('c0000000-0000-4000-8000-000000000004', 'd0000000-0000-4000-8000-000000000001',
   'Cliente Campaign Consent Seed', 'campaign-client-consent-seed@test.local', true),
  ('c0000000-0000-4000-8000-000000000005', 'd0000000-0000-4000-8000-000000000002',
   'Cliente Campaign No Consent Seed', 'campaign-client-no-consent-seed@test.local', false);

-- Spec 21 (connecteur LobbyPMS) — établissement PMS-backed de démonstration. Réutilise "Casa Kayam
-- Guatapé" (b0000000-...-0002), déjà l'établissement seedé de référence (feature 22 ci-dessus) —
-- cohérent avec la réalité du projet, Casa Kayam étant le seul établissement réellement PMS-backed
-- (jamais un établissement synthétique séparé qui fragmenterait la donnée de démo). Jeton FACTICE
-- (jamais un vrai jeton dans le seed, cf. hifago/CLAUDE.md §8.2) — un appel réel échouerait en 401,
-- comportement attendu et déjà documenté (401 local = normal, aucune IP whitelistée hors Fly/relais
-- réseau). category_id 9631 repris du legacy (VIDPOVO) pour la continuité narrative, sans lien réel
-- avec un compte Lobby existant.
update establishments
   set lobby_connector_active = true, lobby_api_token = 'seed-fake-token'
 where id = 'b0000000-0000-4000-8000-000000000002';

insert into products (
  id, partner_id, establishment_id, type, name, description, price_cop, unit, schedule, qty_unit,
  sellable, slug, lobby_category_id
)
values (
  'b0000000-0000-4000-8000-000000000007',
  (select partner_id from partner_accounts where id = 'a0000000-0000-4000-8000-000000000003'),
  'b0000000-0000-4000-8000-000000000002',
  'lodging',
  jsonb_build_object('es', 'Alojamiento PMS-backed (demo)', 'en', 'PMS-backed lodging (demo)'),
  jsonb_build_object(
    'es', 'Dormitorio de demostración, disponibilité gérée par LobbyPMS (connecteur, spec 21).',
    'en', 'Demo dorm, availability managed by LobbyPMS (connector, spec 21).'
  ),
  100000,
  'per_person',
  'date',
  'qty',
  true,
  'alojamiento-pms-backed-demo',
  9631
);
