do $$
declare
  partition_name text;
begin
  for partition_name in
    select child.relname
    from pg_inherits inheritance
    join pg_class parent on parent.oid = inheritance.inhparent
    join pg_class child on child.oid = inheritance.inhrelid
    join pg_namespace namespace on namespace.oid = child.relnamespace
    where parent.relname = 'sonar_survey_points'
      and namespace.nspname = 'public'
  loop
    execute format(
      'alter table public.%I enable row level security',
      partition_name
    );
    execute format(
      'alter table public.%I force row level security',
      partition_name
    );
    execute format(
      'revoke all on table public.%I from public, anon, authenticated',
      partition_name
    );
    execute format(
      'grant all on table public.%I to service_role',
      partition_name
    );
  end loop;
end
$$;
