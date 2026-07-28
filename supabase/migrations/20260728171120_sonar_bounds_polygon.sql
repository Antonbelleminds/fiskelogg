-- A chunk containing one stationary point (or several collinear points) makes
-- ST_Envelope return Point/LineString. sonar_surveys.bounds is intentionally a
-- Polygon, so expand every non-empty chunk by a negligible amount before the
-- envelope is assigned.
create or replace function public.sonar_ingest_points(
  p_job_id uuid,
  p_file_id uuid,
  p_survey_id uuid,
  p_user_id uuid,
  p_points jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  inserted_count bigint := 0;
  invalid_count bigint := 0;
  highest_record bigint := 0;
  chunk_bounds geometry;
  chunk_min_depth real;
  chunk_max_depth real;
  chunk_started_at timestamptz;
  chunk_ended_at timestamptz;
begin
  if not exists (
    select 1
    from public.sonar_import_files f
    where f.id = p_file_id
      and f.job_id = p_job_id
      and f.user_id = p_user_id
      and f.survey_id = p_survey_id
  ) then
    raise exception 'Sonar file ownership or survey mismatch';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_file_id::text, 0));

  with decoded as (
    select
      point.record_index,
      point.observed_at,
      point.elapsed_ms,
      point.lat,
      point.lon,
      point.depth_m,
      point.water_temp_c,
      point.bottom_hardness,
      point.vegetation_height_m,
      point.vendor_channel_a,
      point.vendor_channel_b,
      point.sonar_source,
      coalesce(point.raw_attributes, '{}'::jsonb) as raw_attributes,
      (
        point.record_index >= 0
        and point.elapsed_ms >= 0
        and point.lat between -90 and 90
        and point.lon between -180 and 180
        and point.depth_m between 0 and 2000
        and point.observed_at is not null
      ) as valid
    from jsonb_to_recordset(coalesce(p_points, '[]'::jsonb)) as point(
      record_index bigint,
      observed_at timestamptz,
      elapsed_ms bigint,
      lat double precision,
      lon double precision,
      depth_m real,
      water_temp_c real,
      bottom_hardness real,
      vegetation_height_m real,
      vendor_channel_a real,
      vendor_channel_b real,
      sonar_source text,
      raw_attributes jsonb
    )
  ),
  inserted as (
    insert into public.sonar_survey_points (
      user_id,
      job_id,
      survey_id,
      file_id,
      record_index,
      observed_at,
      elapsed_ms,
      position,
      depth_m,
      water_temp_c,
      bottom_hardness,
      vegetation_height_m,
      vendor_channel_a,
      vendor_channel_b,
      sonar_source,
      raw_attributes
    )
    select
      p_user_id,
      p_job_id,
      p_survey_id,
      p_file_id,
      d.record_index,
      d.observed_at,
      d.elapsed_ms,
      st_setsrid(st_makepoint(d.lon, d.lat), 4326),
      d.depth_m,
      d.water_temp_c,
      d.bottom_hardness,
      d.vegetation_height_m,
      d.vendor_channel_a,
      d.vendor_channel_b,
      d.sonar_source,
      d.raw_attributes
    from decoded d
    where d.valid
    on conflict (user_id, file_id, record_index) do nothing
    returning position, depth_m, observed_at, record_index
  ),
  inserted_stats as (
    select
      count(*)::bigint as inserted_count,
      max(record_index)::bigint as highest_record,
      st_expand(
        st_envelope(st_collect(position)),
        0.0000001
      ) as chunk_bounds,
      min(depth_m)::real as chunk_min_depth,
      max(depth_m)::real as chunk_max_depth,
      min(observed_at) as chunk_started_at,
      max(observed_at) as chunk_ended_at
    from inserted
  ),
  decoded_stats as (
    select
      count(*) filter (where not valid)::bigint as invalid_count,
      coalesce(max(record_index), -1)::bigint as highest_input_record
    from decoded
  )
  select
    i.inserted_count,
    d.invalid_count,
    greatest(coalesce(i.highest_record, -1), d.highest_input_record),
    i.chunk_bounds,
    i.chunk_min_depth,
    i.chunk_max_depth,
    i.chunk_started_at,
    i.chunk_ended_at
  into
    inserted_count,
    invalid_count,
    highest_record,
    chunk_bounds,
    chunk_min_depth,
    chunk_max_depth,
    chunk_started_at,
    chunk_ended_at
  from inserted_stats i
  cross join decoded_stats d;

  update public.sonar_import_files
  set status = 'parsing',
      processed_records = greatest(processed_records, highest_record + 1),
      imported_points = imported_points + inserted_count,
      invalid_records = invalid_records + invalid_count,
      started_at = coalesce(started_at, now())
  where id = p_file_id
    and user_id = p_user_id;

  update public.sonar_surveys
  set point_count = point_count + inserted_count,
      min_depth_m = case
        when chunk_min_depth is null then min_depth_m
        when min_depth_m is null then chunk_min_depth
        else least(min_depth_m, chunk_min_depth)
      end,
      max_depth_m = case
        when chunk_max_depth is null then max_depth_m
        when max_depth_m is null then chunk_max_depth
        else greatest(max_depth_m, chunk_max_depth)
      end,
      bounds = case
        when chunk_bounds is null then bounds
        when bounds is null then chunk_bounds
        else st_envelope(st_collect(bounds, chunk_bounds))
      end,
      started_at = case
        when chunk_started_at is null then started_at
        when started_at is null then chunk_started_at
        else least(started_at, chunk_started_at)
      end,
      ended_at = case
        when chunk_ended_at is null then ended_at
        when ended_at is null then chunk_ended_at
        else greatest(ended_at, chunk_ended_at)
      end
  where id = p_survey_id
    and user_id = p_user_id;

  update public.sonar_import_jobs j
  set points_imported = totals.imported_points,
      invalid_records = totals.invalid_records,
      current_stage = 'Läser mätpunkter'
  from (
    select
      coalesce(sum(f.imported_points), 0)::bigint as imported_points,
      coalesce(sum(f.invalid_records), 0)::bigint as invalid_records
    from public.sonar_import_files f
    where f.job_id = p_job_id
      and f.user_id = p_user_id
  ) totals
  where j.id = p_job_id
    and j.user_id = p_user_id;

  return jsonb_build_object(
    'inserted', inserted_count,
    'invalid', invalid_count,
    'processedThrough', highest_record
  );
end
$$;

revoke all on function public.sonar_ingest_points(
  uuid, uuid, uuid, uuid, jsonb
) from public, anon, authenticated;

grant execute on function public.sonar_ingest_points(
  uuid, uuid, uuid, uuid, jsonb
) to service_role;
