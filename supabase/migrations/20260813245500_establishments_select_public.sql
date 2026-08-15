-- Feature 6 (Client : composer un panier à plusieurs lignes sur une même commande,
-- multi-établissement) — gap constaté en écrivant e2e/cart-multi-establishment.spec.ts.
--
-- establishments_select (20260813210000_establishments_core_table.sql) ne couvre que l'admin ou
-- le partenaire propriétaire ("aucun écran public ne consomme establishments pour l'instant",
-- vrai au moment où cette policy a été posée). app/(public)/[locale]/products/[slug]/page.tsx
-- (Feature 6) joint désormais establishments(name) pour l'afficher sur la fiche produit ET dans
-- chaque ligne du panier (/checkout) — un visiteur public (ou un client authentifié sans aucun
-- lien avec ce partenaire) doit pouvoir lire le nom de l'établissement d'un produit qu'il peut
-- déjà légitimement voir. Sans cette policy, la jointure renvoie `null` (RLS filtre la ligne
-- établissement, pas d'erreur visible) — établissement affiché vide, silencieusement.
--
-- Additive (2e policy permissive de select, jamais une modification de establishments_select) —
-- même logique que products_select_own (20260813234500_product_proposals.sql) : Postgres combine
-- plusieurs policies permissives en OR. Portée alignée sur products_select_public (Tranche 2) :
-- visible dès que l'établissement porte au moins un produit sellable=true — jamais tous les
-- établissements sans distinction, qui exposerait aussi les établissements n'ayant que des fiches
-- non publiées (feature 15).
create policy establishments_select_public on establishments
  for select
  using (
    exists (
      select 1 from products p
      where p.establishment_id = establishments.id and p.sellable = true
    )
  );
