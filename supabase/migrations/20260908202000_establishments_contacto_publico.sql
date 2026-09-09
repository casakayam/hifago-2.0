-- Spec 30 (Tranche 2) — le CONTACT PUBLIC d'un établissement.
--
-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- POURQUOI CETTE COLONNE, ET PAS UNE DES DEUX QUI EXISTENT DÉJÀ
-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- La décision « le contact d'un établissement devient public » date du 2026-09-07 ; la COLONNE
-- restait à trancher (cahier §2f, trois issues ouvertes). Tranchée le 2026-09-08, spec 30 §3.2,
-- après mesure — et la mesure a écarté le candidat qui paraissait évident :
--
--   `partners.phone`         0 ligne remplie sur 36.
--   `partner_accounts.phone` 1 ligne sur 41.
--
-- La migration 20260819100000 dit pourquoi `partners.phone` reste vide : `partners` est
-- l'ORGANISATION, partageable entre plusieurs comptes, et « un écran de compte personnel ne doit
-- jamais écraser ce que voit un collègue du même partenaire ». Le partenaire saisit son téléphone
-- dans `partner_accounts`. Publier `partners.phone` aurait donc livré un bouton de contact VIDE
-- sur toutes les fiches : un lot mesuré vert, et sans le moindre effet.
--
-- Publier `partner_accounts.phone` aurait demandé une policy publique sur une table d'IDENTITÉ,
-- qui porte aussi des référents particuliers et leurs numéros d'identification. C'est le geste le
-- plus risqué des trois, pour une colonne remplie une fois sur 41.
--
-- D'où une colonne sur `establishments` : le contact décrit LE LIEU — c'est ce que la fiche
-- affiche —, la table a déjà sa lecture publique, et AUCUNE table d'identité n'est ouverte.
--
-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- FRONTIÈRE RLS / RPC-ONLY : RLS DIRECTE, et voici pourquoi (CLAUDE.md §3)
-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- Aucun compteur de capacité, aucune écriture concurrente, aucune lecture d'une autre identité :
-- rien ici ne relève de la frontière RPC-only (§3.1). `establishments` reste en RLS directe, son
-- calibrage est inchangé depuis le 2026-08-15, et cette migration ne crée AUCUNE policy.
--
-- ⚠️ La lecture publique est donc celle qui existe déjà, `establishments_select_public` :
-- `status = 'active'` ET au moins un produit `sellable` rattaché. Un établissement invisible au
-- public ne laisse donc pas fuir son contact — c'est la même porte, pas une nouvelle.
--
-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- ⚠️ LES DEUX GRANTS SONT LE CŒUR DE CETTE MIGRATION, PAS UNE FORMALITÉ
-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- `establishments` n'a AUCUN grant au niveau TABLE pour `anon`/`authenticated` : dix-huit grants
-- COLONNE PAR COLONNE, posés un par un depuis 20260827200000 (mesuré le 2026-09-08). Une colonne
-- ajoutée n'hérite donc de rien, et l'erreur qui tombe alors est `permission denied for column` —
-- AVANT la RLS, ce qui la fait passer pour un bug de policy (piège §11.1).
--
--   SELECT  sans lui, la vitrine ne voit jamais la colonne : bouton absent, aucune erreur visible.
--   UPDATE  sans lui, PERSONNE ne peut l'écrire — pas même un admin. `update_establishment_contact`
--           ci-dessous est `security invoker` (comme `update_establishment_stay_details`, son
--           modèle) : elle s'exécute avec les droits de l'appelant, donc elle a besoin du grant,
--           et c'est la RLS `establishments_write_admin` qui décide qui a le droit.
--
-- Une colonne lisible que personne ne peut remplir serait exactement le défaut de `partners.phone`
-- qu'on vient d'écarter, reproduit sous une autre forme.
--
-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- POURQUOI UNE RPC PLUTÔT QU'UNE ÉCRITURE DIRECTE (écart assumé au §6b de la spec)
-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- Le §6b n'annonçait que « la colonne + son grant ». Deux faits, constatés en écrivant :
--   1. `update_establishment` REMPLACE tous les champs et est appelée par TROIS chemins de
--      modération de propositions : y ajouter le contact le ferait écraser à chaque approbation,
--      sans erreur et sans trace. C'est mot pour mot la raison pour laquelle les horaires ont eu
--      leur propre RPC (cf. l'en-tête de 20260827210000, et le commentaire d'EstablishmentStayBlock).
--   2. Le contact n'est PAS un « détail de séjour » : l'ajouter à `update_establishment_stay_details`
--      donnerait à cette fonction un nom qui ment.
-- D'où une RPC dédiée, calquée sur elle : même forme, même journal d'audit, même `security invoker`.

alter table public.establishments
  add column contact_phone text;

-- E.164 : le `+`, un indicatif non nul, 8 à 15 chiffres. La contrainte est nommée explicitement —
-- un CHECK inline reçoit un nom auto-généré qu'aucun message d'erreur ne rend lisible.
--
-- ⚠️ Ce n'est pas du zèle de saisie : la cible est `https://wa.me/<numéro sans le +>`. Un numéro
-- écrit « 300 123 45 67 » produirait un lien MORT — présent à l'écran, cliquable, et n'allant
-- nulle part — sans qu'aucun test ne rougisse. Une contrainte est le seul endroit où cette règle
-- ne peut pas être contournée.
alter table public.establishments
  add constraint establishments_contact_phone_e164
  check (contact_phone is null or contact_phone ~ '^\+[1-9][0-9]{7,14}$');

comment on column public.establishments.contact_phone is
  'Contact WhatsApp PUBLIC du lieu, E.164 (+573001234567). Distinct de partners.phone et de '
  'partner_accounts.phone, qui restent privés. Lu par la fiche établissement ; null = pas de '
  'bouton de contact. Spec 30 §3.2 (2026-09-08), ferme le point « source du contact » du cahier §2f.';

-- ⚠️ SANS CES DEUX LIGNES, LA COLONNE EST INERTE. Voir l'en-tête.
grant select (contact_phone) on public.establishments to anon, authenticated;
grant update (contact_phone) on public.establishments to authenticated;

-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- L'ÉCRITURE — calquée sur `update_establishment_stay_details`, jamais sur `update_establishment`
-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- `security invoker` (donc PAS de `search_path` à fixer, §3.4 ne s'appliquant qu'au definer) : la
-- RLS `establishments_write_admin` s'applique d'elle-même, et un non-admin ne met à jour aucune
-- ligne — d'où `not found`, jamais une erreur de permission.
create function public.update_establishment_contact(
  p_establishment_id uuid,
  p_contact_phone    text default null
)
returns jsonb
language plpgsql
as $$
declare
  v_normalise text;
begin
  -- Une chaîne vide venue d'un champ de formulaire vidé vaut « pas de contact », jamais un numéro
  -- invalide : sans ça, effacer le champ dans l'admin rendrait `invalid_phone` au lieu de retirer
  -- le bouton.
  v_normalise := nullif(btrim(coalesce(p_contact_phone, '')), '');

  if v_normalise is not null and v_normalise !~ '^\+[1-9][0-9]{7,14}$' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_phone');
  end if;

  update public.establishments
     set contact_phone = v_normalise,
         updated_at = now()
   where id = p_establishment_id;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'establishment_not_found');
  end if;

  -- ⚠️ Le numéro N'EST PAS écrit au journal d'audit : c'est une donnée de contact, et l'audit doit
  -- dire QUI a changé QUOI, pas recopier la valeur. On journalise sa PRÉSENCE.
  perform public.log_admin_action(
    'establishment.update_contact', 'establishments', p_establishment_id, null,
    jsonb_build_object('contact_phone_defini', v_normalise is not null),
    null
  );

  return jsonb_build_object('ok', true);
end;
$$;

comment on function public.update_establishment_contact is
  'Pose ou retire le contact WhatsApp public d''un établissement. security invoker : la policy '
  'establishments_write_admin décide. Séparée d''update_establishment, qui remplace tous les '
  'champs et est appelée par les trois chemins de modération de propositions. Spec 30 §3.2.';

grant execute on function public.update_establishment_contact(uuid, text) to authenticated;
