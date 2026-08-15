-- Extension pgTAP, nécessaire à la suite de tests (policies RLS, contraintes, logique
-- séquentielle) — jamais pour un test de concurrence (cf. hifago/CLAUDE.md §6).
create extension if not exists pgtap with schema extensions;
