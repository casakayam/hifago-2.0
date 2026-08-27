-- T1 — saisie des horaires et du mode d'hébergement d'un établissement.
--
-- POURQUOI UNE RPC SÉPARÉE PLUTÔT QU'ÉTENDRE `update_establishment`, et les deux raisons sont des
-- pièges déjà rencontrés dans ce dépôt :
--
-- 1. SURCHARGE. `update_establishment` est appelée en arguments NOMMÉS depuis
--    EstablishmentEditBlock.tsx. Lui ajouter trois paramètres à valeur par défaut ne la remplace
--    pas : Postgres crée une SECONDE fonction, et l'appel à 8 arguments nommés devient ambigu
--    (`function is not unique`). C'est exactement ce qui a cassé `create_partner_invitation` le
--    2026-08-24 — « create or replace avec un paramètre en plus ne remplace jamais une signature
--    différente ». Il faudrait donc DROP puis recréer.
--
-- 2. ET SURTOUT, ÉCRASEMENT SILENCIEUX. `update_establishment` remplace TOUS les champs qu'elle
--    reçoit, et elle est appelée par trois chemins de modération de propositions
--    (20260819200000, 20260824070000, 20260825130000) qui ne connaissent pas ces nouvelles
--    colonnes. Chaque approbation de proposition remettrait donc les horaires et le mode à NULL,
--    sans erreur et sans trace. Les faire passer par ces trois fonctions supposerait de les
--    recréer toutes — beaucoup de surface remuée pour trois champs.
--
-- Une RPC étroite évite les deux, garde intacte la fonction la plus appelée du domaine, et permet
-- d'EFFACER une valeur (passer null la met à null) — ce qu'un `coalesce(p_x, x)` défensif dans la
-- fonction commune aurait interdit : un horaire saisi par erreur serait devenu ineffaçable.
--
-- `security invoker`, comme sa sœur : la RLS de l'appelant décide, la frontière de confiance ne
-- bouge pas d'un pouce (hifago/CLAUDE.md §10).
create or replace function public.update_establishment_stay_details(
  p_establishment_id uuid,
  p_check_in_time time default null,
  p_check_out_time time default null,
  p_mode text default null
)
returns jsonb
language plpgsql
security invoker
as $$
begin
  if p_mode is not null and p_mode not in ('rooms', 'whole_house') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_mode');
  end if;

  update public.establishments
     set check_in_time = p_check_in_time,
         check_out_time = p_check_out_time,
         mode = p_mode,
         updated_at = now()
   where id = p_establishment_id;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'establishment_not_found');
  end if;

  perform public.log_admin_action(
    'establishment.update_stay_details', 'establishments', p_establishment_id, null,
    jsonb_build_object('check_in_time', p_check_in_time, 'check_out_time', p_check_out_time, 'mode', p_mode),
    null
  );

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.update_establishment_stay_details(uuid, time, time, text) to authenticated;
