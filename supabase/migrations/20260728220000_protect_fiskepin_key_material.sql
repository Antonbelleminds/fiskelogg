-- A Fiskepin salt is part of the encryption key. Replacing or deleting it
-- while encrypted catches exist would make those locations unreadable.
create index if not exists catches_encrypted_user_id_idx
  on public.catches (user_id)
  where location_encrypted is true;

create or replace function public.protect_fiskepin_key_material()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_user_id uuid;
  key_material_changed boolean;
begin
  target_user_id := case
    when tg_op = 'DELETE' then old.id
    else new.id
  end;

  key_material_changed := case
    when tg_op = 'INSERT' then true
    when tg_op = 'DELETE' then true
    else
      new.pin_hash is distinct from old.pin_hash
      or new.pin_salt is distinct from old.pin_salt
  end;

  -- PostgREST sessions keep `authenticator` as session_user even after
  -- assuming the authenticated role. Direct maintenance runs as postgres.
  if session_user <> 'postgres'
    and key_material_changed
    and exists (
      select 1
      from public.catches
      where user_id = target_user_id
        and location_encrypted is true
    )
  then
    raise exception using
      errcode = 'P0001',
      message = 'cannot_change_fiskepin_with_encrypted_catches';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

revoke all on function public.protect_fiskepin_key_material()
  from public, anon, authenticated, service_role;

drop trigger if exists protect_fiskepin_key_material on public.user_secrets;

create trigger protect_fiskepin_key_material
before insert or update of pin_hash, pin_salt or delete
on public.user_secrets
for each row
execute function public.protect_fiskepin_key_material();
