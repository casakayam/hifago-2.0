-- Feature 15 (Socio : soumettre une proposition d'édition sur une activité existante).
-- Miroir de la feature 3 (nom/description/prix/catégorie) mais en proposition, pas en écriture
-- directe : le produit publié garde ses valeurs actuelles jusqu'à approbation (feature 16, pas
-- celle-ci).

-- RPC-only (cf. hifago/CLAUDE.md §3) : écriture cross-identité auditable — l'admin doit voir les
-- propositions de tous les socios, un socio ne doit jamais pouvoir écrire directement sur celle
-- d'un autre ni maquiller le statut/reviewed_by de la sienne.
create table product_proposals (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id),
  partner_id uuid not null references partners(id),
  submitted_by uuid not null references partner_accounts(id),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'withdrawn')),
  payload jsonb not null,
  rejection_reason text,
  version int not null default 1,     -- verrou optimiste, feature 16 (modération) — colonne seule
  reviewed_by uuid references partner_accounts(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Pas de GRANT explicite : product_proposals est créée après le ALTER DEFAULT PRIVILEGES de
-- 20260813163456_identity_rls.sql, qui couvre déjà automatiquement toute table future.
alter table product_proposals enable row level security;
revoke insert, update, delete on product_proposals from authenticated, anon;

create policy product_proposals_select_own on product_proposals
  for select using (partner_id = (select partner_id_for_account(auth.uid())));
create policy product_proposals_select_admin on product_proposals
  for select using ((select is_admin(auth.uid())));

-- Gap constaté en écrivant l'écran /partner/products : products_select_public (Tranche 2) ne
-- couvre que sellable=true ou admin — un socio ne peut aujourd'hui voir AUCUN de ses propres
-- produits non vendables. Additive (deuxième policy permissive de select, pas une modification de
-- products_select_public) : Postgres combine plusieurs policies permissives en OR.
-- products.partner_id (gardé délibérément en feature 2 malgré establishment_id) directement, pas
-- une jointure vers establishments — même logique anti-cascade que products_select_public.
create policy products_select_own on products
  for select using (partner_id = (select partner_id_for_account(auth.uid())));

-- RPC critique du titre de cette feature : 3 garde-fous serveur, dans l'ordre où ils protègent
-- (cahier des charges socio §3d/§3e). Pas le squelette anti-survente (§4) : aucun compteur de
-- capacité touché ici, même calibrage que les RPC admin bas-volume (create_establishment,
-- create_partner_invitation).
create or replace function submit_product_proposal(p_product_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account_id uuid := auth.uid();
  v_partner_id uuid;
  v_establishment_id uuid;
  v_proposal_id uuid;
  v_safe_payload jsonb;
begin
  if v_account_id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;

  v_partner_id := (select public.partner_id_for_account(v_account_id));

  select establishment_id into v_establishment_id
    from public.products where id = p_product_id;

  -- Garde-fous 1+2 (identité + propriété) : produit inexistant ou d'un autre partenaire → même
  -- réponse "introuvable" dans les deux cas, jamais un refus explicite qui révèlerait l'existence
  -- du produit d'un tiers (cahier des charges socio §3d).
  if v_establishment_id is null or not exists (
    select 1 from public.establishments
     where id = v_establishment_id and partner_id = v_partner_id
  ) then
    return jsonb_build_object('ok', false, 'reason', 'product_not_found');
  end if;

  -- Garde-fou 3 (capacité) : operator actif pour CET établissement précis, pas juste l'identité
  -- (correctif Tranche 1 — has_capability avec le 3e argument).
  if not (select public.has_capability(v_account_id, 'operator', v_establishment_id)) then
    return jsonb_build_object('ok', false, 'reason', 'capability_suspended');
  end if;

  -- Plafond de propositions en attente (cahier des charges socio §3e — valeur à revalider, fixée
  -- à 10 pour ce premier périmètre).
  if (
    select count(*) from public.product_proposals
     where partner_id = v_partner_id and status = 'pending'
  ) >= 10 then
    return jsonb_build_object('ok', false, 'reason', 'pending_cap_exceeded');
  end if;

  -- Propriété de sûreté n°2 (socio §3e) : seuls des champs de CONTENU sont acceptés, jamais
  -- commission/remise/visibilité/mapping PMS — filtrage explicite du payload, pas une confiance
  -- dans ce que le front n'envoie « normalement » pas.
  v_safe_payload := jsonb_build_object(
    'name', p_payload->'name', 'description', p_payload->'description',
    'price_cop', p_payload->'price_cop', 'category', p_payload->'category'
  );

  insert into public.product_proposals (product_id, partner_id, submitted_by, payload)
  values (p_product_id, v_partner_id, v_account_id, v_safe_payload)
  returning id into v_proposal_id;

  return jsonb_build_object('ok', true, 'proposal_id', v_proposal_id);
end;
$$;

grant execute on function submit_product_proposal(uuid, jsonb) to authenticated;

-- Pas dans le titre de la feature, mais son complément direct et peu coûteux (cahier des charges
-- socio §3e : « retirable par le prestataire tant qu'elle n'a pas été traitée »).
create or replace function withdraw_product_proposal(p_proposal_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account_id uuid := auth.uid();
  v_partner_id uuid;
  v_proposal_partner_id uuid;
  v_status text;
begin
  if v_account_id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;
  v_partner_id := (select public.partner_id_for_account(v_account_id));

  select partner_id, status into v_proposal_partner_id, v_status
    from public.product_proposals where id = p_proposal_id for update;

  if not found or v_proposal_partner_id is distinct from v_partner_id then
    return jsonb_build_object('ok', false, 'reason', 'proposal_not_found');
  end if;
  if v_status <> 'pending' then
    return jsonb_build_object('ok', false, 'reason', 'not_pending');
  end if;

  update public.product_proposals set status = 'withdrawn', updated_at = now()
   where id = p_proposal_id;

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function withdraw_product_proposal(uuid) to authenticated;
