-- Spec 33 Tranche 3 — `attach_orders_to_account`. Migration 20260910180000, seule source de vérité.
--
-- Cette fonction décide QUI PEUT S'APPROPRIER UNE COMMANDE, donc les données personnelles qu'elle
-- porte (nom, téléphone, email). Chacune de ses trois gardes est testée SÉPARÉMENT ET PAR LE CAS
-- QUI LA VIOLE — un test qui vérifierait seulement le chemin heureux laisserait passer un
-- pre-account takeover sans virer au rouge une seule fois.
--
--   Garde 1 — session anonyme refusée (spec 31 invariant 4).
--   Garde 2 — email NON CONFIRMÉ refusé : le seul rempart contre « je m'inscris avec l'adresse de
--             quelqu'un d'autre et je récupère ses réservations ».
--   Garde 3 — propriétaire actuel anonyme uniquement : ne vole jamais la commande d'un compte réel
--             qui aurait saisi l'email d'un tiers dans le checkout.
begin;
select plan(15);

create function test_login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

insert into partners (id, display_name) values
  ('89340000-0000-4000-8000-000000000001', 'Attach Test Partner');
insert into establishments (id, partner_id, name) values
  ('89340000-0000-4000-8000-000000000011', '89340000-0000-4000-8000-000000000001',
   jsonb_build_object('es', 'Establecimiento Attach'));
insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug)
values ('89340000-0000-4000-8000-000000000021', '89340000-0000-4000-8000-000000000001',
        '89340000-0000-4000-8000-000000000011', 'activity',
        jsonb_build_object('es', 'Actividad Attach'), 100000, true, 'attach-test');

-- Les identités du scénario :
--   031 — l'INVITÉ (anonyme) qui a commandé sous cliente@test.local ;
--   032 — le COMPTE RÉEL que ce même client se crée ensuite, email CONFIRMÉ, même adresse ;
--   033 — un compte réel dont l'email n'est PAS confirmé (garde 2) ;
--   034 — un compte réel TIERS qui a commandé en saisissant l'adresse d'autrui (garde 3) ;
--   035 — une identité anonyme quelconque (garde 1).
--
-- ⚠️ Découvert en écrivant ce test, et ça RESSERRE la surface d'attaque : `auth.users` porte une
-- contrainte d'unicité sur l'email (`users_email_partial_key`). Deux comptes ne peuvent donc JAMAIS
-- porter la même adresse — l'usurpation n'est possible que tant que la victime n'a pas encore de
-- compte, ce qui est précisément le cas d'un invité. D'où l'ordre ci-dessous : l'attaquant (033)
-- détient d'abord l'adresse, le compte légitime (032) ne la reçoit qu'après.
insert into auth.users (id, email, email_confirmed_at) values
  ('89340000-0000-4000-8000-000000000031', 'invitado-attach@test.local', null),
  ('89340000-0000-4000-8000-000000000032', 'legit-attach@test.local', now()),
  ('89340000-0000-4000-8000-000000000033', 'cliente@test.local', null),
  ('89340000-0000-4000-8000-000000000034', 'tercero@test.local', now()),
  ('89340000-0000-4000-8000-000000000035', 'anonimo-attach@test.local', null);
update auth.users set is_anonymous = true
 where id in ('89340000-0000-4000-8000-000000000031', '89340000-0000-4000-8000-000000000035');

-- A : la commande de l'invité, sous l'adresse que le compte 032 confirmera. À rattacher.
insert into orders (id, account_id, holder_name, holder_email)
values ('89340000-0000-4000-8000-000000000041', '89340000-0000-4000-8000-000000000031',
        'Holder Attach', 'cliente@test.local');
insert into order_lines (
  id, order_id, account_id, product_id, date, qty, status, holder_name,
  price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
  acompte_cop, referrer_commission_cop, app_commission_cop
) values
  ('89340000-0000-4000-8000-000000000051', '89340000-0000-4000-8000-000000000041',
   '89340000-0000-4000-8000-000000000031', '89340000-0000-4000-8000-000000000021',
   '2026-11-05', 1, 'reserved', 'Holder Attach',
   100000, 100000, 'direct', 0.17, 0, 0.17, 17000, 0, 17000);

-- B : une commande d'un COMPTE RÉEL tiers, mais portant la MÊME adresse. Ne doit JAMAIS bouger.
insert into orders (id, account_id, holder_name, holder_email)
values ('89340000-0000-4000-8000-000000000042', '89340000-0000-4000-8000-000000000034',
        'Holder Tercero', 'cliente@test.local');
insert into order_lines (
  id, order_id, account_id, product_id, date, qty, status, holder_name,
  price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
  acompte_cop, referrer_commission_cop, app_commission_cop
) values
  ('89340000-0000-4000-8000-000000000052', '89340000-0000-4000-8000-000000000042',
   '89340000-0000-4000-8000-000000000034', '89340000-0000-4000-8000-000000000021',
   '2026-11-06', 1, 'reserved', 'Holder Tercero',
   100000, 100000, 'direct', 0.17, 0, 0.17, 17000, 0, 17000);

-- C : une commande d'invité sous une AUTRE adresse. Ne doit jamais bouger non plus.
insert into orders (id, account_id, holder_name, holder_email)
values ('89340000-0000-4000-8000-000000000043', '89340000-0000-4000-8000-000000000031',
        'Holder Autre', 'otro@test.local');

-- ── Garde 1 : aucune session ──────────────────────────────────────────────────────────────────
select is(
  public.attach_orders_to_account()->>'reason', 'not_authenticated',
  'sans session : refus explicite, aucune commande touchée'
);

-- ── Garde 1 bis : session anonyme ─────────────────────────────────────────────────────────────
select test_login('89340000-0000-4000-8000-000000000035');
select is(
  public.attach_orders_to_account()->>'reason', 'anonymous_session',
  'une identité ANONYME ne peut rien s''approprier (spec 31 invariant 4)'
);

-- ── Garde 2 : email non confirmé — LE rempart contre le pre-account takeover ───────────────────
-- 033 EST l'attaquant : il s'est inscrit avec l'adresse exacte de la commande de l'invité et n'a
-- pas cliqué le lien de vérification. C'est le cas réel, pas une approximation.
select test_login('89340000-0000-4000-8000-000000000033');
select is(
  public.attach_orders_to_account()->>'reason', 'email_not_confirmed',
  'en usurpant l''adresse EXACTE d''une commande d''invité, sans email confirmé, rien n''est '
  'rattaché (pre-account takeover)'
);
select is(
  (select account_id::text from orders where id = '89340000-0000-4000-8000-000000000041'),
  '89340000-0000-4000-8000-000000000031',
  'la commande visée est restée à son invité'
);

-- L'attaquant abandonne, le vrai client s'inscrit et confirme : l'adresse se libère et lui revient.
update auth.users set email = 'sin-confirmar@test.local'
 where id = '89340000-0000-4000-8000-000000000033';
update auth.users set email = 'cliente@test.local'
 where id = '89340000-0000-4000-8000-000000000032';

-- ── Le chemin heureux ─────────────────────────────────────────────────────────────────────────
select test_login('89340000-0000-4000-8000-000000000032');
select is(
  (public.attach_orders_to_account()->>'ok')::boolean, true,
  'un compte à l''email confirmé rattache bien'
);
select is(
  (select account_id::text from orders where id = '89340000-0000-4000-8000-000000000041'),
  '89340000-0000-4000-8000-000000000032',
  'la commande de l''invité appartient désormais au compte réel'
);
-- ⚠️ Le test qui manquerait le plus s'il n'était pas écrit : `order_lines.account_id` est
-- dénormalisé depuis `orders`. L'oublier ferait apparaître la commande dans /cuenta/reservas avec
-- ses lignes MASQUÉES par order_lines_select — un demi-rattachement, plus déroutant que pas de
-- rattachement du tout.
select is(
  (select account_id::text from order_lines where id = '89340000-0000-4000-8000-000000000051'),
  '89340000-0000-4000-8000-000000000032',
  'et SES LIGNES ont suivi (account_id dénormalisé, 20260813194515) — jamais l''un sans l''autre'
);

-- ── Garde 3 : la commande d'un compte réel n'est jamais volée ─────────────────────────────────
select is(
  (select account_id::text from orders where id = '89340000-0000-4000-8000-000000000042'),
  '89340000-0000-4000-8000-000000000034',
  'la commande d''un COMPTE RÉEL portant la même adresse n''a PAS été rattachée'
);
select is(
  (select account_id::text from order_lines where id = '89340000-0000-4000-8000-000000000052'),
  '89340000-0000-4000-8000-000000000034',
  'ni ses lignes'
);

-- ── Portée : une autre adresse ne suit pas ────────────────────────────────────────────────────
select is(
  (select account_id::text from orders where id = '89340000-0000-4000-8000-000000000043'),
  '89340000-0000-4000-8000-000000000031',
  'une commande d''invité sous une AUTRE adresse reste où elle est'
);

-- ── Idempotence ───────────────────────────────────────────────────────────────────────────────
-- Un seul appel, une seule assertion : deux appels pour lire deux champs du MÊME retour
-- testaient surtout que la fonction est appelable deux fois.
select is(
  public.attach_orders_to_account(),
  jsonb_build_object('ok', true, 'attached', 0),
  'un second appel ne rattache plus rien et répond ok=true — idempotent, jamais un faux échec'
);

-- ── Casse de l'adresse ────────────────────────────────────────────────────────────────────────
insert into orders (id, account_id, holder_name, holder_email)
values ('89340000-0000-4000-8000-000000000044', '89340000-0000-4000-8000-000000000031',
        'Holder Casse', 'CLIENTE@Test.Local');
select is(
  (public.attach_orders_to_account()->>'attached')::int, 1,
  'la comparaison d''adresse ignore la casse — un client qui tape son email en majuscules compte'
);

-- ── Grants ────────────────────────────────────────────────────────────────────────────────────
select ok(
  has_function_privilege('authenticated', 'public.attach_orders_to_account()', 'EXECUTE'),
  'authenticated peut l''exécuter'
);
select ok(
  not has_function_privilege('anon', 'public.attach_orders_to_account()', 'EXECUTE'),
  'anon ne le peut PAS — vérifié sur l''ACL, jamais déduit du corps (le revoke explicite compte : '
  'PostgreSQL accorde EXECUTE à PUBLIC sur toute fonction neuve)'
);

-- ── Elle satisfait le contrôle mécanique du dépôt ─────────────────────────────────────────────
select ok(
  (select p.prosrc ~* 'is_anonymous_session\s*\(' from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'attach_orders_to_account'),
  'son source appelle NOMMÉMENT is_anonymous_session() — sans quoi le cas 2 de '
  'security_definer_exposure.test.sql la relèverait (spec 31 invariant 4)'
);

select * from finish();
rollback;
