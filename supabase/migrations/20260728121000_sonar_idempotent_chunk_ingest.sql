create or replace function public.sonar_ingest_point_chunk(
  p_job_id uuid,
  p_file_id uuid,
  p_survey_id uuid,
  p_user_id uuid,
  p_points jsonb,
  p_processed_records bigint,
  p_invalid_records bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  previous_processed_records bigint;
  ingest_result jsonb;
begin
  if p_processed_records < 0 or p_invalid_records < 0 then
    raise exception 'Invalid chunk counters';
  end if;

  select processed_records
  into previous_processed_records
  from public.sonar_import_files
  where id = p_file_id
    and job_id = p_job_id
    and survey_id = p_survey_id
    and user_id = p_user_id
  for update;

  if previous_processed_records is null then
    raise exception 'Sonar file ownership or survey mismatch';
  end if;

  -- A durable step can be replayed after its database commit. The end-exclusive
  -- processed counter makes the replay a no-op, including invalid-record totals.
  if previous_processed_records >= p_processed_records then
    return jsonb_build_object(
      'inserted', 0,
      'invalid', 0,
      'processedThrough', p_processed_records - 1,
      'replayed', true
    );
  end if;

  ingest_result := public.sonar_ingest_points(
    p_job_id,
    p_file_id,
    p_survey_id,
    p_user_id,
    p_points
  );

  update public.sonar_import_files
  set processed_records = greatest(processed_records, p_processed_records),
      invalid_records = invalid_records + p_invalid_records
  where id = p_file_id
    and user_id = p_user_id;

  update public.sonar_import_jobs job
  set points_imported = totals.imported_points,
      invalid_records = totals.invalid_records
  from (
    select
      coalesce(sum(imported_points), 0)::bigint as imported_points,
      coalesce(sum(invalid_records), 0)::bigint as invalid_records
    from public.sonar_import_files
    where job_id = p_job_id
      and user_id = p_user_id
  ) totals
  where job.id = p_job_id
    and job.user_id = p_user_id;

  return ingest_result || jsonb_build_object(
    'invalid',
    p_invalid_records,
    'processedThrough',
    p_processed_records - 1,
    'replayed',
    false
  );
end
$$;

revoke all on function public.sonar_ingest_point_chunk(
  uuid, uuid, uuid, uuid, jsonb, bigint, bigint
) from public, anon, authenticated;

grant execute on function public.sonar_ingest_point_chunk(
  uuid, uuid, uuid, uuid, jsonb, bigint, bigint
) to service_role;
