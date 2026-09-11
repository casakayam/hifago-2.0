-- Spec 35 Tranche 1 — suppression de compte par son propre titulaire (entretien Jérôme 2026-09-11).
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- ELLE S'APPELLE `delete_` ET N'EXÉCUTE QU'UN `UPDATE` — ce n'est pas une approximation
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- Supprimer physiquement le compte est STRUCTURELLEMENT IMPOSSIBLE ici, et c'est déjà prouvé dans
-- ce dépôt : `partner_accounts.id` référence `auth.users(id) on delete cascade`, mais
-- `orders.account_id` retient la ligne — le job de purge des identités anonymes
-- (20260910130000_purge_expired_anonymous_identities.sql) ne purge QUE les identités sans commande
-- pour cette raison exacte, et rattrape `foreign_key_violation` pour les autres. Or décision ① de
-- l'entretien : les commandes d'un compte supprimé SURVIVENT, toutes, pour toujours. Un client réel
-- qui demande la suppression en a donc presque toujours — le `DELETE` échouerait sur la quasi-
-- totalité des cas réels.
--
-- Le nom garde le vocabulaire de l'utilisateur (« supprimer mon compte »), le corps dit la vérité.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- CE QU'ELLE NE TOUCHE PAS, ET POURQUOI C'EST LE CŒUR DE LA DÉCISION
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- `orders` / `order_lines` : JAMAIS. Décision ③, confirmée explicitement par Jérôme après qu'il ait
-- nommé lui-même la subtilité — « il faut qu'on ait quand même les infos personnelles de la personne
-- pour le prestataire ». Ces tables portent leur PROPRE copie de `holder_name`/`holder_email`/
-- `holder_phone` (20260813194515, 20260817180000, 20260819180000) : l'établissement et LobbyPMS
-- n'ont jamais lu `partner_accounts` pour honorer une réservation. Idem pour les commissions, figées
-- par ligne à la création (20260814180000) — décision ② : elles ne bougent pas.
--
-- `auth.users` : PAS ICI. L'email et le mot de passe sont changés par l'API Admin Supabase depuis le
-- Route Handler (spec 35 §7.2, Tranche 4), jamais en SQL sur le schéma `auth` : il appartient à
-- `supabase_auth_admin`, `insert into auth.users` est déjà confirmé REFUSÉ sur Supabase Cloud
-- (2026-08-21), et rien ne garantit qu'un `update` s'y comporte autrement. Le job de purge porte
-- déjà le même risque non vérifié pour son `delete` — en ajouter un second en SQL nu serait doubler
-- une incertitude au lieu de la contenir.
--
-- `saved_attribution_code` : laissé tel quel. Ce n'est pas une donnée personnelle (c'est un code
-- partenaire), et le compte anonymisé ne peut plus jamais commander — il n'a donc aucun effet futur.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- LA GARDE « COMPTE PROFESSIONNEL » PASSE PAR DEUX CHEMINS, PAS UN
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- Décision ⑪ : un compte porteur d'une capacité partenaire ne peut pas se supprimer depuis l'écran
-- CLIENT (même email, sessions indépendantes entre apps/web et apps/admin — rien n'empêche un
-- référent de se connecter côté vitrine). ⚠️ Le piège : `partner_capabilities` porte sa contrainte
-- `partner_capabilities_scope` (20260813161117) —
--     role = 'admin'                   → account_id NOT NULL, partner_id NULL
--     role in ('referrer','operator')  → partner_id NOT NULL, account_id NULL
-- Chercher seulement `account_id = auth.uid()` n'attraperait donc QUE les admins, et laisserait
-- passer référents et opérateurs : exactement les deux profils que Jérôme a nommés. Le rattachement
-- d'un référent/opérateur se lit sur `partner_accounts.partner_id` (c'est ainsi que `has_capability`
-- fait sa jointure, 20260813211500).
--
-- La garde ne regarde PAS `status` : une capacité `suspended` ou `onboarding` reste un lien
-- professionnel réel qu'un geste côté client ne doit pas effacer en silence. Décision de rédaction,
-- signalée à Jérôme (spec 35 §10) — sa réponse d'entretien disait « capacité active », c'est un
-- élargissement prudent, pas une interprétation neutre.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- Checklist CLAUDE.md §3
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- `partner_accounts` est RPC-only en écriture depuis 20260828000103 (revoke insert/update/delete à
-- anon+authenticated, aucune policy d'écriture) : cette fonction contourne la RLS exactement comme
-- `update_my_account_profile` le fait déjà pour les mêmes colonnes. SECURITY DEFINER +
-- `set search_path = ''` (§3.4), `auth.uid()` enveloppé en `(select auth.uid())` (§3.5). VOLATILE
-- (elle écrit) — pas de `stable`, qui serait faux.
--
-- PAS une opération critique au sens §4.1 : aucun compteur de capacité, aucune réservation, aucun
-- décrément. Donc pas de squelette anti-survente, pas de test de concurrence à barrière (même
-- calibrage que `cancel_order_line`).
--
-- Cas 2 de `security_definer_exposure.test.sql` : son garde ne se limite pas à `auth.uid()`, elle
-- appelle `is_anonymous_session()` nommément — aucune entrée en liste blanche nécessaire.

create or replace function public.delete_my_account()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account_id uuid := (select auth.uid());
  v_partner_id uuid;
begin
  if v_account_id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;

  -- Un invité n'a pas de compte à supprimer : il n'a même pas l'écran (spec 34 décision ⑦, la garde
  -- de zone refuse une session anonyme sur tout `(cuenta)`). Refus explicite quand même — une garde
  -- d'écran n'est jamais le seul rempart d'un geste irréversible.
  if (select public.is_anonymous_session()) then
    return jsonb_build_object('ok', false, 'reason', 'anonymous_session');
  end if;

  select pa.partner_id into v_partner_id
    from public.partner_accounts pa
   where pa.id = v_account_id
   for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'account_not_found');
  end if;

  -- Chemin 1 — référent/opérateur : le rattachement vit sur partner_accounts.partner_id.
  -- Chemin 2 — admin : la capacité est portée par le compte lui-même. Voir l'en-tête : chercher
  -- l'un sans l'autre laisse passer la moitié des cas.
  if v_partner_id is not null
     or exists (
       select 1
         from public.partner_capabilities pc
        where pc.account_id = v_account_id
     )
  then
    return jsonb_build_object('ok', false, 'reason', 'professional_account');
  end if;

  -- Les deux seules colonnes personnelles de cette table (les autres : id, partner_id, timestamps,
  -- saved_attribution_code). `partner_id` n'est PAS remis à null ici — la garde ci-dessus vient de
  -- garantir qu'il l'est déjà ; l'écrire quand même serait du code mort qui ferait croire à un cas
  -- qui n'existe pas.
  update public.partner_accounts
     set full_name = null,
         phone = null,
         updated_at = now()
   where id = v_account_id;

  return jsonb_build_object('ok', true);
end;
$$;

-- Le revoke d'abord, et il inclut `authenticated` : PostgreSQL accorde EXECUTE à PUBLIC sur toute
-- fonction neuve, et l'`alter default privileges` du projet accorde NOMMÉMENT à anon —
-- qu'un revoke sur `public` seul ne retire pas (piège payé par la spec 33, .claude/rules/supabase.md).
revoke all on function public.delete_my_account() from public, anon, authenticated;
grant execute on function public.delete_my_account() to authenticated;

comment on function public.delete_my_account() is
  'Anonymise le compte de l''appelant (spec 35, entretien Jérôme 2026-09-11) : efface full_name et '
  'phone de partner_accounts, et RIEN d''autre. Ne supprime aucune ligne — orders/order_lines '
  'survivent intactes, PII dénormalisée et commissions figées comprises (décisions ① ② ③), et un '
  'DELETE serait de toute façon bloqué par orders.account_id. L''email et le mot de passe d''auth.users '
  'sont changés par l''API Admin depuis le Route Handler, jamais en SQL. Refuse une session anonyme '
  'et tout compte professionnel — référent/opérateur via partner_accounts.partner_id, admin via '
  'partner_capabilities.account_id : les deux chemins, quel que soit le statut de la capacité.';
