-- Le plafond de tentatives de la file d'annulation redescend dans la BASE — trouvé par la revue
-- `/simplify`, signalé indépendamment sous deux angles (altitude et efficacité).
--
-- CE QUI N'ALLAIT PAS. `MAX_ATTEMPTS = 3` vivait dans l'Edge Function `pms-cancel-bookings`, qui
-- l'appliquait après avoir RELU la table en direct (`select attempts from pms_cancellation_queue`)
-- — alors que la migration qui crée cette table annonce l'accès RPC-only et révoque tout pour
-- `authenticated`/`anon`. Trois conséquences, dont une vraie :
--
--   1. Un aller-retour PostgREST par entrée en échec, pour une valeur que `claim_...` venait
--      d'écrire quelques millisecondes plus tôt dans son propre UPDATE.
--   2. Le claim ne filtrait pas sur `attempts` : une entrée épuisée restait éligible.
--   3. LE VRAI DÉFAUT — si la fonction meurt entre le claim (qui a déjà incrémenté) et la
--      résolution (timeout du net.http_post à 25 s, crash Deno), l'entrée reste `pending` POUR
--      TOUJOURS. Elle est re-réclamée toutes les 10 minutes, et n'est jamais vue par la
--      supervision nocturne, qui ne compte que les `failed`. Un booking non annulé, invisible.
--
-- CE QUE FAIT CETTE MIGRATION.
--
--   a. `claim_pms_cancellation_batch` clôt d'abord en `failed` les entrées `pending` qui ont
--      épuisé leurs tentatives sans jamais être résolues. C'est le rattrapage du point 3 : le
--      plafond n'est plus seulement un refus d'agir, c'est une clôture qui rend le cas visible.
--   b. Le claim ne réclame plus que `attempts < p_max_attempts`.
--   c. Il RETOURNE `attempts`, pour que l'appelant n'ait plus à relire la table.
--
-- Changement de signature (paramètre ajouté ET colonne de retour) : `create or replace` ne peut
-- faire ni l'un ni l'autre, d'où le `drop` explicite. Le grant est reposé à l'identique —
-- `service_role` uniquement, jamais `authenticated`.

drop function if exists public.claim_pms_cancellation_batch(integer);

create or replace function public.claim_pms_cancellation_batch(
  p_limit integer default 20,
  p_max_attempts integer default 3
)
returns table(
  entry_id uuid,
  pms_booking_id text,
  establishment_id uuid,
  lobby_api_token text,
  hifago_status text,
  attempts integer
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- (a) Rattrapage : une entrée réclamée mais jamais résolue reste `pending` avec un compteur au
  -- plafond. Sans cette clôture, elle est re-réclamée indéfiniment et n'apparaît dans aucun
  -- rapport. `last_error` n'est écrasé que s'il est vide — le motif du dernier échec réel, s'il
  -- a pu être écrit, vaut mieux que ce message générique.
  update public.pms_cancellation_queue q
     set status = 'failed',
         processed_at = now(),
         last_error = coalesce(
           q.last_error,
           'abandonnée sans résolution après ' || p_max_attempts || ' tentative(s)'
         )
   where q.status = 'pending'
     and q.attempts >= p_max_attempts;

  return query
    with claimed as (
      select q.id
        from public.pms_cancellation_queue q
        join public.establishments e on e.id = q.establishment_id
       where q.status = 'pending'
         and q.attempts < p_max_attempts
         and e.lobby_connector_active = true
         and e.lobby_api_token is not null
       order by q.created_at asc
       limit p_limit
       for update of q skip locked
    )
    update public.pms_cancellation_queue q
       set attempts = q.attempts + 1
      from claimed c, public.establishments e
     where q.id = c.id and e.id = q.establishment_id
    returning q.id, q.pms_booking_id, e.id, e.lobby_api_token, q.hifago_status, q.attempts;
end;
$$;

revoke all on function public.claim_pms_cancellation_batch(integer, integer) from public;
grant execute on function public.claim_pms_cancellation_batch(integer, integer) to service_role;
