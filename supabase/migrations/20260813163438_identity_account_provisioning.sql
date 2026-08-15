-- Provisionnement automatique du miroir partner_accounts à chaque création d'utilisateur
-- Supabase Auth. Nécessaire pour que is_admin()/partner_id_for_account() (0002) aient toujours
-- une ligne à lire — sans ce trigger, aucun compte (client, référent, admin) n'aurait jamais de
-- ligne partner_accounts, quel que soit le chemin d'inscription (email/mot de passe, Google).
create or replace function handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.partner_accounts (id) values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function handle_new_auth_user();
