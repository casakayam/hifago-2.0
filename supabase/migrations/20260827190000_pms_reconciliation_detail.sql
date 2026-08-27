-- pms_reconciliation_entries.detail — pourquoi l'entrée existe, pas seulement qu'elle existe.
--
-- LE DÉFAUT, constaté deux fois dans la même journée. Une entrée de réconciliation ne portait QUE
-- `order_line_id` : elle disait qu'un aller-retour LobbyPMS avait échoué, jamais pourquoi. Le
-- 2026-08-27, une création de booking a échoué en préprod et il a fallu changer une variable à
-- l'aveugle pour comprendre — la réponse de Lobby n'était nulle part. Le job nocturne avait
-- exactement le même angle mort le matin même, corrigé de la même façon (journaliser le CORPS).
--
-- Ce n'est pas un confort de debug : `notify_all_admins` (20260824060000) envoie un e-mail à chaque
-- admin dès qu'une entrée apparaît. Sans motif, l'e-mail dit « quelque chose a échoué » et l'écran
-- de réconciliation n'en sait pas plus — on demande à un humain d'aller enquêter sans lui donner le
-- seul élément que la machine avait sous les yeux.
--
-- DISTINCT de `resolution_note`, qui est ce qu'un ADMIN écrit en clôturant. `detail` est ce que la
-- MACHINE a observé au moment de l'échec — les deux coexistent, ils ne racontent pas la même chose.
--
-- ⚠️ N'y écrire QUE des corps de réponse, jamais l'URL de la requête : elle porte `api_token` en
-- query string (hifago/CLAUDE.md §8). Tronqué court côté appelant.

alter table public.pms_reconciliation_entries
  add column detail text;

comment on column public.pms_reconciliation_entries.detail is
  'Motif machine de l''échec (statut HTTP + corps de réponse LobbyPMS, tronqué). Jamais l''URL de requête, qui porte api_token. À ne pas confondre avec resolution_note, écrite par l''admin qui clôt l''entrée.';
