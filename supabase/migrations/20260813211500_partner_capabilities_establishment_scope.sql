-- Correctif Tranche 1 — granularité par établissement de la capacité operator.
-- 00-modele-de-donnees.md §6 : le statut operator vit sur le lien établissement↔identité, pas sur
-- l'identité seule (une organisation peut avoir un établissement suspendu et les autres actifs).
-- Migration ADDITIVE : partner_capabilities existe depuis 20260813161117_identity_core_tables.sql
-- (déjà appliquée, jamais réécrite) — on complète son schéma ici, on ne le recrée pas. S'applique
-- après 20260813210000_establishments_core_table.sql (dépendance de la FK ci-dessous).
alter table partner_capabilities
  add column establishment_id uuid references establishments(id);
-- admin/referrer : toujours null (inchangé, la capacité référent reste au niveau de l'identité).
-- operator : nullable à dessein — null = "onboardé comme prestataire, aucun établissement encore
-- créé/rattaché" (ce que consume_partner_invitation crée aujourd'hui, aucun changement requis côté
-- RPC) ; non-null = statut actif pour CET établissement précis. Plusieurs lignes operator par
-- partenaire deviennent possibles, une par établissement.

-- L'index existant (Tranche 1, unique (partner_id, role) where partner_id is not null) interdisait
-- toute DEUXIÈME ligne operator pour un même partenaire, quel que soit l'établissement — devenu
-- incompatible avec le nouveau design. On le DROP puis on le recrée restreint aux rôles autres
-- qu'operator (referrer/admin restent uniques par partenaire, inchangé) ; operator sort de cet
-- index, gouverné par les deux index partiels ci-dessous. Ne pas se contenter d'ajouter les deux
-- nouveaux index à côté de l'ancien : celui-ci continuerait de bloquer toute deuxième ligne
-- operator, exactement le cas que ce correctif introduit.
drop index partner_capabilities_partner_role_idx;
create unique index partner_capabilities_partner_role_idx
  on partner_capabilities(partner_id, role)
  where partner_id is not null and role <> 'operator';

-- Au plus une ligne operator "en attente" (establishment_id null) par partenaire.
create unique index partner_capabilities_operator_pending_idx
  on partner_capabilities(partner_id)
  where role = 'operator' and establishment_id is null;

-- Au plus une ligne operator par (partenaire, établissement) une fois rattachée.
create unique index partner_capabilities_operator_establishment_idx
  on partner_capabilities(partner_id, establishment_id)
  where role = 'operator' and establishment_id is not null;

-- Helper RLS centralisé, mêmes garanties que is_admin()/partner_id_for_account() (0002) : STABLE,
-- SECURITY DEFINER, search_path vide car il lit partner_capabilities/partner_accounts qui sont
-- elles-mêmes sous RLS — le bypass est volontaire et ne re-déclenche donc aucune policy en
-- cascade. Appelé has_capability(uid, 'referrer') (sans 3e argument) pour un contrôle au niveau
-- identité, has_capability(uid, 'operator', establishment_id) pour un contrôle scopé — une ligne
-- operator en attente (establishment_id null) ne matche jamais un appel avec un establishment_id
-- précis, comportement voulu (pas encore un vrai opérateur de CET établissement).
create or replace function has_capability(uid uuid, p_role text, p_establishment_id uuid default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.partner_capabilities pc
    join public.partner_accounts pa on pa.partner_id = pc.partner_id
    where pa.id = uid
      and pc.role = p_role
      and pc.status = 'active'
      and (p_establishment_id is null or pc.establishment_id = p_establishment_id)
  );
$$;
