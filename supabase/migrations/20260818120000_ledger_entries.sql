-- Spec 19 §0 Tranche 0 — table du ledger de règlement (référent + compensation établissement).
-- N'existait pas encore côté hifago 2.0 (commentaire explicite laissé dans
-- 20260814170000_set_order_line_status_rpc.sql : « le ledger n'existe pas encore »).
--
-- Financier, à auditer nominativement → RPC-only (checklist /hifago-migration point 1) : aucune
-- policy d'écriture, seulement des RPC security definer (create_order pour l'écriture initiale,
-- set_order_line_status pour les transitions, mark_ledger_entry_paid pour le règlement manuel).
--
-- beneficiary_id EN DEUX COLONNES DÉDIÉES (referrer_partner_id / establishment_id), PAS un couple
-- polymorphe (entity_type, entity_id) — le projet a déjà explicitement écarté ce pattern (spec 17
-- §10, correction vers deux tables/colonnes FK dédiées plutôt qu'une paire polymorphe). Le check
-- constraint ci-dessous garantit que la colonne remplie correspond bien à beneficiary_type.
create table ledger_entries (
  id uuid primary key default gen_random_uuid(),
  order_line_id uuid not null references order_lines(id),
  beneficiary_type text not null check (beneficiary_type in ('referrer', 'establishment')),
  referrer_partner_id uuid references partners(id),
  establishment_id uuid references establishments(id),
  entry_type text not null check (entry_type in ('referral_earned', 'establishment_compensation')),
  amount_cop bigint not null check (amount_cop > 0),
  status text not null default 'estimated'
    check (status in ('estimated', 'due', 'paid', 'reversed', 'void')),
  comprobante_path text,
  note text,
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  constraint ledger_entries_beneficiary_matches_type check (
    (beneficiary_type = 'referrer'
       and referrer_partner_id is not null and establishment_id is null)
    or
    (beneficiary_type = 'establishment'
       and establishment_id is not null and referrer_partner_id is null)
  )
);

create index ledger_entries_order_line_id_idx on ledger_entries(order_line_id);

alter table ledger_entries enable row level security;
revoke insert, update, delete on ledger_entries from authenticated, anon;

create policy ledger_entries_select_admin on ledger_entries
  for select using ((select is_admin(auth.uid())));

-- Même patron que order_lines_select_referrer (20260814200000) : un référent voit ses propres
-- entrées de ledger, jamais celles d'un tiers ni les entrées de type establishment_compensation
-- (referrer_partner_id y est toujours null par construction, cf. check ci-dessus).
create policy ledger_entries_select_referrer on ledger_entries
  for select using (referrer_partner_id = (select partner_id_for_account(auth.uid())));
