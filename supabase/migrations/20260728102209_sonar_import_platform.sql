-- Sonar import platform
-- Additive migration: existing catches and encrypted Fiskepin data are not modified.

create table public.sonar_import_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'preparing'
    check (status in (
      'preparing', 'uploading', 'queued', 'parsing', 'deriving',
      'matching', 'completed', 'completed_with_errors', 'failed', 'cancelled'
    )),
  source_kind text not null default 'files'
    check (source_kind in ('files', 'folder', 'zip', 'sd_card')),
  device_timezone text not null default 'Europe/Stockholm',
  manufacturer text,
  detected_model text,
  workflow_run_id text,
  files_total integer not null default 0 check (files_total >= 0),
  files_completed integer not null default 0 check (files_completed >= 0),
  bytes_total bigint not null default 0 check (bytes_total >= 0),
  bytes_uploaded bigint not null default 0 check (bytes_uploaded >= 0),
  points_total bigint not null default 0 check (points_total >= 0),
  points_imported bigint not null default 0 check (points_imported >= 0),
  invalid_records bigint not null default 0 check (invalid_records >= 0),
  error_count integer not null default 0 check (error_count >= 0),
  current_stage text,
  settings jsonb not null default '{}'::jsonb,
  error_summary text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz
);

create table public.sonar_surveys (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.sonar_import_jobs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  manufacturer text not null,
  device_model text,
  source_format text not null,
  parser_plugin text not null,
  parser_version text not null,
  started_at timestamptz,
  ended_at timestamptz,
  point_count bigint not null default 0 check (point_count >= 0),
  min_depth_m real,
  max_depth_m real,
  bounds geometry(Polygon, 4326),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.sonar_import_files (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.sonar_import_jobs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  survey_id uuid references public.sonar_surveys(id) on delete set null,
  deduplicates_file_id uuid references public.sonar_import_files(id) on delete set null,
  original_name text not null,
  relative_path text not null,
  extension text not null,
  media_type text,
  byte_size bigint not null check (byte_size >= 0),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  storage_path text,
  status text not null default 'pending_upload'
    check (status in (
      'pending_upload', 'uploading', 'uploaded', 'parsing', 'completed',
      'duplicate', 'ignored', 'unsupported', 'failed'
    )),
  manufacturer text,
  detected_model text,
  detected_format text,
  parser_plugin text,
  parser_version text,
  record_size integer,
  record_count bigint not null default 0 check (record_count >= 0),
  processed_records bigint not null default 0 check (processed_records >= 0),
  imported_points bigint not null default 0 check (imported_points >= 0),
  invalid_records bigint not null default 0 check (invalid_records >= 0),
  header jsonb not null default '{}'::jsonb,
  error_code text,
  error_message text,
  uploaded_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_id, sha256)
);

-- Hash partitioning prevents a single multi-million-point heap/index from becoming
-- the write bottleneck while retaining a simple logical table for PostgREST.
create table public.sonar_survey_points (
  id bigint generated always as identity,
  user_id uuid not null references auth.users(id) on delete cascade,
  job_id uuid not null references public.sonar_import_jobs(id) on delete cascade,
  survey_id uuid not null references public.sonar_surveys(id) on delete cascade,
  file_id uuid not null references public.sonar_import_files(id) on delete cascade,
  record_index bigint not null check (record_index >= 0),
  observed_at timestamptz not null,
  elapsed_ms bigint not null check (elapsed_ms >= 0),
  position geometry(Point, 4326) not null,
  depth_m real not null check (depth_m >= 0 and depth_m <= 2000),
  water_temp_c real,
  speed_ms real,
  heading_deg real,
  bottom_hardness real,
  vegetation_height_m real,
  vendor_channel_a real,
  vendor_channel_b real,
  sonar_source text,
  raw_attributes jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (user_id, id),
  unique (user_id, file_id, record_index)
) partition by hash (user_id);

do $$
begin
  for i in 0..15 loop
    execute format(
      'create table public.sonar_survey_points_p%s partition of public.sonar_survey_points for values with (modulus 16, remainder %s)',
      i,
      i
    );
  end loop;
end
$$;

create table public.sonar_tracks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  job_id uuid not null references public.sonar_import_jobs(id) on delete cascade,
  survey_id uuid not null references public.sonar_surveys(id) on delete cascade,
  name text,
  started_at timestamptz,
  ended_at timestamptz,
  point_count bigint not null default 0 check (point_count >= 0),
  distance_m double precision,
  geometry geometry(LineString, 4326) not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (user_id, survey_id)
);

create table public.sonar_waypoints (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  job_id uuid not null references public.sonar_import_jobs(id) on delete cascade,
  survey_id uuid references public.sonar_surveys(id) on delete cascade,
  source_key text,
  name text,
  waypoint_type text,
  observed_at timestamptz,
  position geometry(Point, 4326) not null,
  depth_m real,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.sonar_depth_cells (
  user_id uuid not null references auth.users(id) on delete cascade,
  job_id uuid not null references public.sonar_import_jobs(id) on delete cascade,
  resolution_m smallint not null check (resolution_m in (10, 25, 50, 100)),
  grid_x bigint not null,
  grid_y bigint not null,
  sample_count integer not null check (sample_count > 0),
  avg_depth_m real not null,
  min_depth_m real not null,
  max_depth_m real not null,
  avg_bottom_hardness real,
  avg_vegetation_height_m real,
  avg_vendor_channel_a real,
  avg_vendor_channel_b real,
  slope_deg real,
  aspect_deg real,
  hillshade real,
  centroid geometry(Point, 4326) not null,
  geometry geometry(Polygon, 4326) not null,
  created_at timestamptz not null default now(),
  primary key (user_id, job_id, resolution_m, grid_x, grid_y)
);

create table public.sonar_depth_contours (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  job_id uuid not null references public.sonar_import_jobs(id) on delete cascade,
  depth_m real not null,
  interval_m real not null default 1,
  geometry geometry(LineString, 4326) not null,
  created_at timestamptz not null default now()
);

create table public.sonar_bottom_classifications (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  job_id uuid not null references public.sonar_import_jobs(id) on delete cascade,
  survey_id uuid references public.sonar_surveys(id) on delete cascade,
  classification text not null
    check (classification in ('unknown', 'soft', 'medium', 'hard', 'vegetation')),
  confidence real check (confidence is null or (confidence >= 0 and confidence <= 1)),
  source_method text not null,
  geometry geometry(Geometry, 4326) not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.catch_sonar_enrichments (
  catch_id uuid primary key references public.catches(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  job_id uuid not null references public.sonar_import_jobs(id) on delete cascade,
  survey_id uuid not null references public.sonar_surveys(id) on delete cascade,
  source_point_user_id uuid,
  source_point_id bigint,
  match_distance_m real not null,
  match_time_delta_seconds integer not null,
  depth_m real,
  bottom_hardness real,
  slope_deg real,
  distance_to_dropoff_m real,
  distance_to_vegetation_m real,
  distance_to_structure_m real,
  water_temp_c real,
  boat_speed_ms real,
  heading_deg real,
  matched_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  foreign key (source_point_user_id, source_point_id)
    references public.sonar_survey_points(user_id, id) on delete set null
);

-- Sparse one-to-one context rows keep future weather/astronomy data out of the
-- hot survey-point table until it is actually enriched.
create table public.sonar_environment_context (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  point_user_id uuid not null,
  point_id bigint not null,
  provider text,
  observed_at timestamptz,
  weather jsonb,
  wind jsonb,
  air_pressure_hpa real,
  water_level_m real,
  water_temp_c real,
  moon_phase text,
  sunrise_at timestamptz,
  sunset_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (point_user_id, point_id)
    references public.sonar_survey_points(user_id, id) on delete cascade,
  unique (user_id, point_user_id, point_id)
);

create index sonar_import_jobs_user_created_idx
  on public.sonar_import_jobs (user_id, created_at desc);
create index sonar_import_files_job_status_idx
  on public.sonar_import_files (job_id, status, created_at);
create index sonar_import_files_user_sha_idx
  on public.sonar_import_files (user_id, sha256, status);
create index sonar_import_files_survey_idx
  on public.sonar_import_files (survey_id) where survey_id is not null;
create index sonar_surveys_user_started_idx
  on public.sonar_surveys (user_id, started_at desc);
create index sonar_surveys_job_idx on public.sonar_surveys (job_id);
create index sonar_surveys_bounds_gix on public.sonar_surveys using gist (bounds);
create index sonar_survey_points_position_gix
  on public.sonar_survey_points using gist (position);
create index sonar_survey_points_survey_time_idx
  on public.sonar_survey_points (user_id, survey_id, observed_at, record_index);
create index sonar_survey_points_job_idx
  on public.sonar_survey_points (user_id, job_id, id);
create index sonar_survey_points_observed_brin
  on public.sonar_survey_points using brin (observed_at) with (pages_per_range = 64);
create index sonar_tracks_geometry_gix on public.sonar_tracks using gist (geometry);
create index sonar_tracks_job_idx on public.sonar_tracks (user_id, job_id);
create index sonar_waypoints_position_gix on public.sonar_waypoints using gist (position);
create index sonar_waypoints_job_idx on public.sonar_waypoints (user_id, job_id);
create index sonar_depth_cells_geometry_gix on public.sonar_depth_cells using gist (geometry);
create index sonar_depth_cells_tile_idx
  on public.sonar_depth_cells (user_id, resolution_m, job_id);
create index sonar_depth_contours_geometry_gix
  on public.sonar_depth_contours using gist (geometry);
create index sonar_depth_contours_job_idx
  on public.sonar_depth_contours (user_id, job_id, depth_m);
create index sonar_bottom_classifications_geometry_gix
  on public.sonar_bottom_classifications using gist (geometry);
create index catch_sonar_enrichments_user_job_idx
  on public.catch_sonar_enrichments (user_id, job_id);
create index catch_sonar_enrichments_source_point_idx
  on public.catch_sonar_enrichments (source_point_user_id, source_point_id);
create index sonar_environment_context_point_idx
  on public.sonar_environment_context (point_user_id, point_id);

create or replace function public.sonar_touch_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end
$$;

create trigger sonar_import_jobs_touch_updated_at
before update on public.sonar_import_jobs
for each row execute function public.sonar_touch_updated_at();

create trigger sonar_import_files_touch_updated_at
before update on public.sonar_import_files
for each row execute function public.sonar_touch_updated_at();

create trigger sonar_surveys_touch_updated_at
before update on public.sonar_surveys
for each row execute function public.sonar_touch_updated_at();

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'sonar_import_jobs',
    'sonar_surveys',
    'sonar_import_files',
    'sonar_survey_points',
    'sonar_tracks',
    'sonar_waypoints',
    'sonar_depth_cells',
    'sonar_depth_contours',
    'sonar_bottom_classifications',
    'catch_sonar_enrichments',
    'sonar_environment_context'
  ]
  loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('alter table public.%I force row level security', table_name);
    execute format(
      'create policy %I on public.%I for select to authenticated using ((select auth.uid()) = user_id)',
      table_name || '_select_own',
      table_name
    );
  end loop;
end
$$;

revoke all on table
  public.sonar_import_jobs,
  public.sonar_surveys,
  public.sonar_import_files,
  public.sonar_survey_points,
  public.sonar_tracks,
  public.sonar_waypoints,
  public.sonar_depth_cells,
  public.sonar_depth_contours,
  public.sonar_bottom_classifications,
  public.catch_sonar_enrichments,
  public.sonar_environment_context
from anon, authenticated;

grant select on table
  public.sonar_import_jobs,
  public.sonar_surveys,
  public.sonar_import_files,
  public.sonar_survey_points,
  public.sonar_tracks,
  public.sonar_waypoints,
  public.sonar_depth_cells,
  public.sonar_depth_contours,
  public.sonar_bottom_classifications,
  public.catch_sonar_enrichments,
  public.sonar_environment_context
to authenticated;

revoke all on function public.sonar_touch_updated_at() from public, anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit)
values ('sonar-imports', 'sonar-imports', false, 53687091200)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit;

create policy "sonar_imports_insert_own_folder"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'sonar-imports'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy "sonar_imports_select_own_folder"
on storage.objects for select to authenticated
using (
  bucket_id = 'sonar-imports'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy "sonar_imports_update_own_folder"
on storage.objects for update to authenticated
using (
  bucket_id = 'sonar-imports'
  and (storage.foldername(name))[1] = (select auth.uid())::text
)
with check (
  bucket_id = 'sonar-imports'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy "sonar_imports_delete_own_folder"
on storage.objects for delete to authenticated
using (
  bucket_id = 'sonar-imports'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

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
      st_envelope(st_collect(position)) as chunk_bounds,
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

create or replace function public.sonar_enrich_motion(
  p_job_id uuid,
  p_user_id uuid
)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  changed_count bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_job_id::text || ':motion', 0));

  with ordered as (
    select
      p.user_id,
      p.id,
      p.position,
      p.observed_at,
      lag(p.position) over (
        partition by p.survey_id
        order by p.observed_at, p.record_index
      ) as previous_position,
      lag(p.observed_at) over (
        partition by p.survey_id
        order by p.observed_at, p.record_index
      ) as previous_at
    from public.sonar_survey_points p
    where p.job_id = p_job_id
      and p.user_id = p_user_id
  ),
  motion as (
    select
      o.user_id,
      o.id,
      extract(epoch from (o.observed_at - o.previous_at)) as seconds_delta,
      st_distance(o.previous_position::geography, o.position::geography) as distance_delta,
      degrees(st_azimuth(o.previous_position, o.position))::real as heading
    from ordered o
    where o.previous_position is not null
      and o.previous_at is not null
  )
  update public.sonar_survey_points p
  set speed_ms = case
        when m.seconds_delta between 0.2 and 30
          and m.distance_delta / m.seconds_delta between 0 and 40
        then (m.distance_delta / m.seconds_delta)::real
        else null
      end,
      heading_deg = case
        when m.seconds_delta between 0.2 and 30 then m.heading
        else null
      end
  from motion m
  where p.user_id = m.user_id
    and p.id = m.id;

  get diagnostics changed_count = row_count;
  return changed_count;
end
$$;

create or replace function public.sonar_build_depth_cells(
  p_job_id uuid,
  p_user_id uuid,
  p_resolution_m smallint
)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  inserted_count bigint;
begin
  if p_resolution_m not in (10, 25, 50, 100) then
    raise exception 'Unsupported depth-cell resolution';
  end if;

  if not exists (
    select 1 from public.sonar_import_jobs
    where id = p_job_id and user_id = p_user_id
  ) then
    raise exception 'Sonar job not found';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_job_id::text || ':cells:' || p_resolution_m::text, 0)
  );

  delete from public.sonar_depth_cells
  where job_id = p_job_id
    and user_id = p_user_id
    and resolution_m = p_resolution_m;

  with projected as materialized (
    select
      floor(st_x(st_transform(p.position, 3857)) / p_resolution_m)::bigint as grid_x,
      floor(st_y(st_transform(p.position, 3857)) / p_resolution_m)::bigint as grid_y,
      p.depth_m,
      p.bottom_hardness,
      p.vegetation_height_m,
      p.vendor_channel_a,
      p.vendor_channel_b
    from public.sonar_survey_points p
    where p.job_id = p_job_id
      and p.user_id = p_user_id
  ),
  aggregated as (
    select
      grid_x,
      grid_y,
      count(*)::integer as sample_count,
      avg(depth_m)::real as avg_depth_m,
      min(depth_m)::real as min_depth_m,
      max(depth_m)::real as max_depth_m,
      avg(bottom_hardness)::real as avg_bottom_hardness,
      avg(vegetation_height_m)::real as avg_vegetation_height_m,
      avg(vendor_channel_a) filter (where vendor_channel_a >= 0)::real as avg_vendor_channel_a,
      avg(vendor_channel_b) filter (where vendor_channel_b >= 0)::real as avg_vendor_channel_b
    from projected
    group by grid_x, grid_y
  )
  insert into public.sonar_depth_cells (
    user_id,
    job_id,
    resolution_m,
    grid_x,
    grid_y,
    sample_count,
    avg_depth_m,
    min_depth_m,
    max_depth_m,
    avg_bottom_hardness,
    avg_vegetation_height_m,
    avg_vendor_channel_a,
    avg_vendor_channel_b,
    centroid,
    geometry
  )
  select
    p_user_id,
    p_job_id,
    p_resolution_m,
    a.grid_x,
    a.grid_y,
    a.sample_count,
    a.avg_depth_m,
    a.min_depth_m,
    a.max_depth_m,
    a.avg_bottom_hardness,
    a.avg_vegetation_height_m,
    a.avg_vendor_channel_a,
    a.avg_vendor_channel_b,
    st_transform(
      st_setsrid(
        st_makepoint(
          (a.grid_x + 0.5) * p_resolution_m,
          (a.grid_y + 0.5) * p_resolution_m
        ),
        3857
      ),
      4326
    ),
    st_transform(
      st_makeenvelope(
        a.grid_x * p_resolution_m,
        a.grid_y * p_resolution_m,
        (a.grid_x + 1) * p_resolution_m,
        (a.grid_y + 1) * p_resolution_m,
        3857
      ),
      4326
    )
  from aggregated a;

  get diagnostics inserted_count = row_count;

  with gradients as (
    select
      c.user_id,
      c.job_id,
      c.resolution_m,
      c.grid_x,
      c.grid_y,
      (
        coalesce(e.avg_depth_m, c.avg_depth_m)
        - coalesce(w.avg_depth_m, c.avg_depth_m)
      ) / (2 * p_resolution_m) as dzdx,
      (
        coalesce(n.avg_depth_m, c.avg_depth_m)
        - coalesce(s.avg_depth_m, c.avg_depth_m)
      ) / (2 * p_resolution_m) as dzdy
    from public.sonar_depth_cells c
    left join public.sonar_depth_cells e
      on e.user_id = c.user_id
      and e.job_id = c.job_id
      and e.resolution_m = c.resolution_m
      and e.grid_x = c.grid_x + 1
      and e.grid_y = c.grid_y
    left join public.sonar_depth_cells w
      on w.user_id = c.user_id
      and w.job_id = c.job_id
      and w.resolution_m = c.resolution_m
      and w.grid_x = c.grid_x - 1
      and w.grid_y = c.grid_y
    left join public.sonar_depth_cells n
      on n.user_id = c.user_id
      and n.job_id = c.job_id
      and n.resolution_m = c.resolution_m
      and n.grid_x = c.grid_x
      and n.grid_y = c.grid_y + 1
    left join public.sonar_depth_cells s
      on s.user_id = c.user_id
      and s.job_id = c.job_id
      and s.resolution_m = c.resolution_m
      and s.grid_x = c.grid_x
      and s.grid_y = c.grid_y - 1
    where c.user_id = p_user_id
      and c.job_id = p_job_id
      and c.resolution_m = p_resolution_m
  ),
  terrain as (
    select
      g.*,
      degrees(atan(sqrt(g.dzdx * g.dzdx + g.dzdy * g.dzdy))) as slope,
      (
        degrees(atan2(g.dzdy, -g.dzdx)) + 360
        - floor((degrees(atan2(g.dzdy, -g.dzdx)) + 360) / 360) * 360
      ) as aspect
    from gradients g
  )
  update public.sonar_depth_cells c
  set slope_deg = t.slope::real,
      aspect_deg = t.aspect::real,
      hillshade = greatest(
        0,
        least(
          1,
          sin(radians(45)) * cos(radians(t.slope))
          + cos(radians(45)) * sin(radians(t.slope))
            * cos(radians(315 - t.aspect))
        )
      )::real
  from terrain t
  where c.user_id = t.user_id
    and c.job_id = t.job_id
    and c.resolution_m = t.resolution_m
    and c.grid_x = t.grid_x
    and c.grid_y = t.grid_y;

  return inserted_count;
end
$$;

create or replace function public.sonar_build_tracks(
  p_job_id uuid,
  p_user_id uuid
)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  inserted_count bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_job_id::text || ':tracks', 0));

  delete from public.sonar_tracks
  where job_id = p_job_id
    and user_id = p_user_id;

  with track_rows as (
    select
      p.survey_id,
      min(p.observed_at) as started_at,
      max(p.observed_at) as ended_at,
      count(*)::bigint as point_count,
      st_makeline(p.position order by p.observed_at, p.record_index) as geometry
    from public.sonar_survey_points p
    where p.job_id = p_job_id
      and p.user_id = p_user_id
    group by p.survey_id
    having count(*) >= 2
  )
  insert into public.sonar_tracks (
    user_id,
    job_id,
    survey_id,
    name,
    started_at,
    ended_at,
    point_count,
    distance_m,
    geometry
  )
  select
    p_user_id,
    p_job_id,
    t.survey_id,
    s.name,
    t.started_at,
    t.ended_at,
    t.point_count,
    st_length(t.geometry::geography),
    t.geometry
  from track_rows t
  join public.sonar_surveys s
    on s.id = t.survey_id
   and s.user_id = p_user_id;

  get diagnostics inserted_count = row_count;
  return inserted_count;
end
$$;

create or replace function public.sonar_build_contours(
  p_job_id uuid,
  p_user_id uuid,
  p_interval_m real default 1
)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  inserted_count bigint;
begin
  if p_interval_m <= 0 or p_interval_m > 20 then
    raise exception 'Invalid contour interval';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_job_id::text || ':contours', 0));

  delete from public.sonar_depth_contours
  where job_id = p_job_id
    and user_id = p_user_id;

  with depth_bands as materialized (
    select
      floor(c.avg_depth_m / p_interval_m) * p_interval_m as depth_m,
      st_unaryunion(st_collect(c.geometry)) as geometry
    from public.sonar_depth_cells c
    where c.job_id = p_job_id
      and c.user_id = p_user_id
      and c.resolution_m = 25
    group by floor(c.avg_depth_m / p_interval_m)
  ),
  dumped_lines as (
    select
      b.depth_m::real as depth_m,
      (st_dump(st_collectionextract(st_boundary(b.geometry), 2))).geom as geometry
    from depth_bands b
  )
  insert into public.sonar_depth_contours (
    user_id,
    job_id,
    depth_m,
    interval_m,
    geometry
  )
  select
    p_user_id,
    p_job_id,
    d.depth_m,
    p_interval_m,
    st_simplify(d.geometry, 0.000002)
  from dumped_lines d
  where not st_isempty(d.geometry)
    and st_npoints(d.geometry) >= 2;

  get diagnostics inserted_count = row_count;
  return inserted_count;
end
$$;

create or replace function public.sonar_match_catches(
  p_job_id uuid,
  p_user_id uuid
)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  matched_count bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_job_id::text || ':matches', 0));

  with catch_positions as materialized (
    select
      c.id as catch_id,
      c.caught_at,
      case
        when c.location is not null and geometrytype(c.location) = 'POINT'
          then st_setsrid(c.location, 4326)
        when c.exif_lat is not null and c.exif_lng is not null
          then st_setsrid(st_makepoint(c.exif_lng, c.exif_lat), 4326)
        else null
      end as position
    from public.catches c
    where c.user_id = p_user_id
      and coalesce(c.location_encrypted, false) = false
  ),
  best_matches as (
    select
      c.catch_id,
      c.caught_at,
      c.position as catch_position,
      nearest.user_id as point_user_id,
      nearest.id as point_id,
      nearest.survey_id,
      nearest.depth_m,
      nearest.bottom_hardness,
      nearest.water_temp_c,
      nearest.speed_ms,
      nearest.heading_deg,
      nearest.position as point_position,
      st_distance(c.position::geography, nearest.position::geography)::real
        as match_distance_m,
      round(abs(extract(epoch from (c.caught_at - nearest.observed_at))))::integer
        as match_time_delta_seconds
    from catch_positions c
    cross join lateral (
      select p.*
      from public.sonar_survey_points p
      where p.user_id = p_user_id
        and p.job_id = p_job_id
        and p.observed_at between c.caught_at - interval '30 minutes'
                              and c.caught_at + interval '30 minutes'
        and st_dwithin(p.position::geography, c.position::geography, 20)
      order by
        st_distance(p.position::geography, c.position::geography),
        abs(extract(epoch from (p.observed_at - c.caught_at)))
      limit 1
    ) nearest
    where c.position is not null
  ),
  enriched as (
    select
      b.*,
      terrain.slope_deg,
      dropoff.distance_m as distance_to_dropoff_m,
      structure.distance_m as distance_to_structure_m
    from best_matches b
    left join lateral (
      select c.slope_deg
      from public.sonar_depth_cells c
      where c.user_id = p_user_id
        and c.job_id = p_job_id
        and c.resolution_m = 10
        and st_dwithin(c.centroid::geography, b.point_position::geography, 25)
      order by st_distance(c.centroid::geography, b.point_position::geography)
      limit 1
    ) terrain on true
    left join lateral (
      select st_distance(c.centroid::geography, b.catch_position::geography)::real as distance_m
      from public.sonar_depth_cells c
      where c.user_id = p_user_id
        and c.job_id = p_job_id
        and c.resolution_m = 10
        and c.slope_deg >= 10
        and st_dwithin(c.centroid::geography, b.catch_position::geography, 500)
      order by st_distance(c.centroid::geography, b.catch_position::geography)
      limit 1
    ) dropoff on true
    left join lateral (
      select st_distance(c.centroid::geography, b.catch_position::geography)::real as distance_m
      from public.sonar_depth_cells c
      where c.user_id = p_user_id
        and c.job_id = p_job_id
        and c.resolution_m = 10
        and c.slope_deg >= 20
        and st_dwithin(c.centroid::geography, b.catch_position::geography, 500)
      order by st_distance(c.centroid::geography, b.catch_position::geography)
      limit 1
    ) structure on true
  )
  insert into public.catch_sonar_enrichments (
    catch_id,
    user_id,
    job_id,
    survey_id,
    source_point_user_id,
    source_point_id,
    match_distance_m,
    match_time_delta_seconds,
    depth_m,
    bottom_hardness,
    slope_deg,
    distance_to_dropoff_m,
    distance_to_structure_m,
    water_temp_c,
    boat_speed_ms,
    heading_deg,
    metadata
  )
  select
    e.catch_id,
    p_user_id,
    p_job_id,
    e.survey_id,
    e.point_user_id,
    e.point_id,
    e.match_distance_m,
    e.match_time_delta_seconds,
    e.depth_m,
    e.bottom_hardness,
    e.slope_deg,
    e.distance_to_dropoff_m,
    e.distance_to_structure_m,
    e.water_temp_c,
    e.speed_ms,
    e.heading_deg,
    jsonb_build_object(
      'matchRule', 'within-20m-and-30min',
      'existingCatchFieldsOverwritten', false
    )
  from enriched e
  on conflict (catch_id) do update
  set user_id = excluded.user_id,
      job_id = excluded.job_id,
      survey_id = excluded.survey_id,
      source_point_user_id = excluded.source_point_user_id,
      source_point_id = excluded.source_point_id,
      match_distance_m = excluded.match_distance_m,
      match_time_delta_seconds = excluded.match_time_delta_seconds,
      depth_m = excluded.depth_m,
      bottom_hardness = excluded.bottom_hardness,
      slope_deg = excluded.slope_deg,
      distance_to_dropoff_m = excluded.distance_to_dropoff_m,
      distance_to_structure_m = excluded.distance_to_structure_m,
      water_temp_c = excluded.water_temp_c,
      boat_speed_ms = excluded.boat_speed_ms,
      heading_deg = excluded.heading_deg,
      matched_at = now(),
      metadata = excluded.metadata
  where
    excluded.match_distance_m < catch_sonar_enrichments.match_distance_m
    or (
      excluded.match_distance_m = catch_sonar_enrichments.match_distance_m
      and excluded.match_time_delta_seconds
        < catch_sonar_enrichments.match_time_delta_seconds
    );

  get diagnostics matched_count = row_count;
  return matched_count;
end
$$;

create or replace function public.sonar_vector_tile(
  p_user_id uuid,
  p_z integer,
  p_x integer,
  p_y integer
)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  tile_bounds geometry;
  geographic_bounds geometry;
  cell_resolution smallint;
  depth_tile bytea;
  contour_tile bytea;
  track_tile bytea;
  waypoint_tile bytea;
begin
  if p_z < 0 or p_z > 22 or p_x < 0 or p_y < 0 then
    raise exception 'Invalid tile coordinate';
  end if;

  tile_bounds := st_tileenvelope(p_z, p_x, p_y);
  geographic_bounds := st_transform(tile_bounds, 4326);
  cell_resolution := case
    when p_z <= 9 then 100
    when p_z <= 11 then 50
    when p_z <= 13 then 25
    else 10
  end;

  with depth_features as (
    select
      c.avg_depth_m as depth,
      c.min_depth_m as min_depth,
      c.max_depth_m as max_depth,
      c.sample_count as samples,
      c.slope_deg as slope,
      c.aspect_deg as aspect,
      c.hillshade,
      c.avg_bottom_hardness as hardness,
      c.avg_vegetation_height_m as vegetation,
      c.avg_vendor_channel_a as vendor_a,
      c.avg_vendor_channel_b as vendor_b,
      st_asmvtgeom(
        st_transform(c.geometry, 3857),
        tile_bounds,
        4096,
        64,
        true
      ) as geom
    from public.sonar_depth_cells c
    join public.sonar_import_jobs j on j.id = c.job_id
    where c.user_id = p_user_id
      and c.resolution_m = cell_resolution
      and j.status in ('completed', 'completed_with_errors')
      and c.geometry && geographic_bounds
  )
  select coalesce(st_asmvt(depth_features, 'depth_cells', 4096, 'geom'), ''::bytea)
  into depth_tile
  from depth_features;

  with contour_features as (
    select
      c.depth_m as depth,
      c.interval_m as interval,
      st_asmvtgeom(
        st_transform(c.geometry, 3857),
        tile_bounds,
        4096,
        64,
        true
      ) as geom
    from public.sonar_depth_contours c
    join public.sonar_import_jobs j on j.id = c.job_id
    where c.user_id = p_user_id
      and j.status in ('completed', 'completed_with_errors')
      and c.geometry && geographic_bounds
  )
  select coalesce(st_asmvt(contour_features, 'contours', 4096, 'geom'), ''::bytea)
  into contour_tile
  from contour_features;

  with track_features as (
    select
      t.id::text as id,
      t.name,
      t.point_count,
      round(t.distance_m)::bigint as distance_m,
      st_asmvtgeom(
        st_transform(t.geometry, 3857),
        tile_bounds,
        4096,
        64,
        true
      ) as geom
    from public.sonar_tracks t
    join public.sonar_import_jobs j on j.id = t.job_id
    where t.user_id = p_user_id
      and j.status in ('completed', 'completed_with_errors')
      and t.geometry && geographic_bounds
  )
  select coalesce(st_asmvt(track_features, 'tracks', 4096, 'geom'), ''::bytea)
  into track_tile
  from track_features;

  with waypoint_features as (
    select
      w.id::text as id,
      w.name,
      w.waypoint_type as type,
      w.depth_m as depth,
      st_asmvtgeom(
        st_transform(w.position, 3857),
        tile_bounds,
        4096,
        64,
        true
      ) as geom
    from public.sonar_waypoints w
    join public.sonar_import_jobs j on j.id = w.job_id
    where w.user_id = p_user_id
      and j.status in ('completed', 'completed_with_errors')
      and w.position && geographic_bounds
  )
  select coalesce(st_asmvt(waypoint_features, 'waypoints', 4096, 'geom'), ''::bytea)
  into waypoint_tile
  from waypoint_features;

  return encode(
    coalesce(depth_tile, ''::bytea)
    || coalesce(contour_tile, ''::bytea)
    || coalesce(track_tile, ''::bytea)
    || coalesce(waypoint_tile, ''::bytea),
    'base64'
  );
end
$$;

create or replace function public.sonar_inspect_point(
  p_user_id uuid,
  p_lon double precision,
  p_lat double precision
)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with click as (
    select st_setsrid(st_makepoint(p_lon, p_lat), 4326) as position
  ),
  nearest_cell as (
    select
      c.avg_depth_m,
      c.min_depth_m,
      c.max_depth_m,
      c.slope_deg,
      c.aspect_deg,
      c.hillshade,
      c.avg_bottom_hardness,
      c.avg_vegetation_height_m,
      c.avg_vendor_channel_a,
      c.avg_vendor_channel_b,
      c.sample_count,
      st_distance(c.centroid::geography, click.position::geography)::real
        as distance_m
    from public.sonar_depth_cells c
    join public.sonar_import_jobs j on j.id = c.job_id
    cross join click
    where c.user_id = p_user_id
      and c.resolution_m = 10
      and j.status in ('completed', 'completed_with_errors')
      and st_dwithin(c.centroid::geography, click.position::geography, 100)
    order by st_distance(c.centroid::geography, click.position::geography)
    limit 1
  ),
  nearest_point as (
    select
      p.observed_at,
      p.water_temp_c,
      p.speed_ms,
      p.heading_deg,
      st_distance(p.position::geography, click.position::geography)::real
        as distance_m
    from public.sonar_survey_points p
    join public.sonar_import_jobs j on j.id = p.job_id
    cross join click
    where p.user_id = p_user_id
      and j.status in ('completed', 'completed_with_errors')
      and st_dwithin(p.position::geography, click.position::geography, 100)
    order by st_distance(p.position::geography, click.position::geography)
    limit 1
  ),
  catch_positions as materialized (
    select
      c.id,
      c.weight_kg,
      case
        when c.location is not null and geometrytype(c.location) = 'POINT'
          then st_setsrid(c.location, 4326)
        when c.exif_lat is not null and c.exif_lng is not null
          then st_setsrid(st_makepoint(c.exif_lng, c.exif_lat), 4326)
        else null
      end as position
    from public.catches c
    where c.user_id = p_user_id
      and coalesce(c.location_encrypted, false) = false
  ),
  catch_stats as (
    select
      count(*) filter (
        where cp.position is not null
          and st_dwithin(cp.position::geography, click.position::geography, 25)
      )::integer as catch_count,
      avg(cp.weight_kg) filter (
        where cp.position is not null
          and st_dwithin(cp.position::geography, click.position::geography, 25)
      )::real as avg_weight_kg,
      max(cp.weight_kg) filter (
        where cp.position is not null
          and st_dwithin(cp.position::geography, click.position::geography, 25)
      )::real as max_weight_kg,
      min(st_distance(cp.position::geography, click.position::geography)) filter (
        where cp.position is not null
      )::real as nearest_catch_m
    from catch_positions cp
    cross join click
  )
  select jsonb_build_object(
    'found', (select count(*) > 0 from nearest_cell),
    'depthM', (select avg_depth_m from nearest_cell),
    'minDepthM', (select min_depth_m from nearest_cell),
    'maxDepthM', (select max_depth_m from nearest_cell),
    'slopeDeg', (select slope_deg from nearest_cell),
    'aspectDeg', (select aspect_deg from nearest_cell),
    'hillshade', (select hillshade from nearest_cell),
    'bottomHardness', (select avg_bottom_hardness from nearest_cell),
    'vegetationHeightM', (select avg_vegetation_height_m from nearest_cell),
    'vendorChannelA', (select avg_vendor_channel_a from nearest_cell),
    'vendorChannelB', (select avg_vendor_channel_b from nearest_cell),
    'samples', (select sample_count from nearest_cell),
    'cellDistanceM', (select distance_m from nearest_cell),
    'observedAt', (select observed_at from nearest_point),
    'waterTempC', (select water_temp_c from nearest_point),
    'boatSpeedMs', (select speed_ms from nearest_point),
    'headingDeg', (select heading_deg from nearest_point),
    'catchCount', coalesce((select catch_count from catch_stats), 0),
    'avgWeightKg', (select avg_weight_kg from catch_stats),
    'maxWeightKg', (select max_weight_kg from catch_stats),
    'nearestCatchM', (select nearest_catch_m from catch_stats),
    'bottomClassification',
      case
        when (select avg_bottom_hardness from nearest_cell) is null
          then 'Ej klassificerad'
        else 'Leverantörssignal'
      end
  );
$$;

revoke all on function public.sonar_ingest_points(uuid, uuid, uuid, uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.sonar_enrich_motion(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.sonar_build_depth_cells(uuid, uuid, smallint)
  from public, anon, authenticated;
revoke all on function public.sonar_build_tracks(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.sonar_build_contours(uuid, uuid, real)
  from public, anon, authenticated;
revoke all on function public.sonar_match_catches(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.sonar_vector_tile(uuid, integer, integer, integer)
  from public, anon, authenticated;
revoke all on function public.sonar_inspect_point(uuid, double precision, double precision)
  from public, anon, authenticated;

grant execute on function public.sonar_ingest_points(uuid, uuid, uuid, uuid, jsonb)
  to service_role;
grant execute on function public.sonar_enrich_motion(uuid, uuid)
  to service_role;
grant execute on function public.sonar_build_depth_cells(uuid, uuid, smallint)
  to service_role;
grant execute on function public.sonar_build_tracks(uuid, uuid)
  to service_role;
grant execute on function public.sonar_build_contours(uuid, uuid, real)
  to service_role;
grant execute on function public.sonar_match_catches(uuid, uuid)
  to service_role;
grant execute on function public.sonar_vector_tile(uuid, integer, integer, integer)
  to service_role;
grant execute on function public.sonar_inspect_point(uuid, double precision, double precision)
  to service_role;
