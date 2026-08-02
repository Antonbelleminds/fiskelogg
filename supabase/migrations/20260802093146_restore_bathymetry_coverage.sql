-- Preserve the precise 10 metre bathymetry surface and its 0.5 metre
-- contours, while restoring the wider coverage that the earlier 25 metre
-- interpolation provided. The coverage surface is deliberately stored and
-- rendered separately so it cannot be mistaken for measured 10 metre detail.

create table public.sonar_bathymetry_coverage_contributions (
  user_id uuid not null references auth.users(id) on delete cascade,
  job_id uuid not null references public.sonar_import_jobs(id) on delete cascade,
  source_bucket smallint not null check (source_bucket between 0 and 31),
  target_bucket smallint not null check (target_bucket between 0 and 31),
  grid_x bigint not null,
  grid_y bigint not null,
  weighted_depth_sum double precision not null,
  weight_sum double precision not null check (weight_sum > 0),
  min_depth_m real not null,
  max_depth_m real not null,
  source_cell_count integer not null check (source_cell_count > 0),
  nearest_distance_cells real not null check (nearest_distance_cells >= 0),
  primary key (user_id, job_id, source_bucket, grid_x, grid_y)
);

create index sonar_bathymetry_coverage_contributions_target_idx
  on public.sonar_bathymetry_coverage_contributions (
    user_id,
    job_id,
    target_bucket,
    grid_x,
    grid_y
  );

create table public.sonar_bathymetry_coverage_cells (
  user_id uuid not null references auth.users(id) on delete cascade,
  job_id uuid not null references public.sonar_import_jobs(id) on delete cascade,
  resolution_m smallint not null default 25 check (resolution_m = 25),
  grid_x bigint not null,
  grid_y bigint not null,
  source_cell_count integer not null check (source_cell_count > 0),
  avg_depth_m real not null,
  min_depth_m real not null,
  max_depth_m real not null,
  confidence real not null check (confidence between 0 and 1),
  centroid geometry(Point, 4326) not null,
  geometry geometry(Polygon, 4326) not null,
  created_at timestamptz not null default now(),
  primary key (user_id, job_id, grid_x, grid_y)
);

create index sonar_bathymetry_coverage_cells_geometry_gix
  on public.sonar_bathymetry_coverage_cells using gist (geometry);
create index sonar_bathymetry_coverage_cells_job_idx
  on public.sonar_bathymetry_coverage_cells (user_id, job_id);
create index sonar_bathymetry_coverage_cells_bucket_idx
  on public.sonar_bathymetry_coverage_cells (
    user_id,
    job_id,
    (((grid_x # grid_y) & 31))
  );

alter table public.sonar_bathymetry_coverage_contributions
  enable row level security;
alter table public.sonar_bathymetry_coverage_cells
  enable row level security;

revoke all on table public.sonar_bathymetry_coverage_contributions
  from public, anon, authenticated;
revoke all on table public.sonar_bathymetry_coverage_cells
  from public, anon, authenticated;
grant all on table public.sonar_bathymetry_coverage_contributions
  to service_role;
grant all on table public.sonar_bathymetry_coverage_cells
  to service_role;

create or replace function public.sonar_prepare_bathymetry_coverage(
  p_job_id uuid,
  p_user_id uuid
)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  deleted_count bigint;
begin
  if not exists (
    select 1
    from public.sonar_import_jobs
    where id = p_job_id
      and user_id = p_user_id
  ) then
    raise exception 'Sonar job not found';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_job_id::text || ':bathymetry:coverage:prepare', 0)
  );

  -- Keep the published coverage available until each replacement bucket is
  -- complete, matching the zero-downtime behaviour of the detail surface.
  delete from public.sonar_bathymetry_coverage_contributions
  where job_id = p_job_id
    and user_id = p_user_id;

  get diagnostics deleted_count = row_count;
  return deleted_count;
end
$$;

create or replace function public.sonar_accumulate_bathymetry_coverage_bucket(
  p_job_id uuid,
  p_user_id uuid,
  p_source_bucket smallint
)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
set statement_timeout = '5min'
as $$
declare
  inserted_count bigint;
begin
  if p_source_bucket not between 0 and 31 then
    raise exception 'Invalid bathymetry coverage source bucket';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      p_job_id::text || ':bathymetry:coverage:source:'
        || p_source_bucket::text,
      0
    )
  );

  delete from public.sonar_bathymetry_coverage_contributions
  where job_id = p_job_id
    and user_id = p_user_id
    and source_bucket = p_source_bucket;

  with offsets as materialized (
    select
      x.dx,
      y.dy,
      sqrt((x.dx * x.dx + y.dy * y.dy)::double precision)::real
        as distance_cells,
      case
        when x.dx = 0 and y.dy = 0 then 4::double precision
        else 1::double precision / (x.dx * x.dx + y.dy * y.dy)
      end as distance_weight
    from generate_series(-3, 3) as x(dx)
    cross join generate_series(-3, 3) as y(dy)
    where x.dx * x.dx + y.dy * y.dy <= 9
  ),
  contributions as materialized (
    select
      c.grid_x + o.dx as grid_x,
      c.grid_y + o.dy as grid_y,
      c.avg_depth_m,
      o.distance_cells,
      o.distance_weight
        * (1 + ln(1 + greatest(c.sample_count, 1)))
          as contribution_weight
    from public.sonar_depth_cells c
    cross join offsets o
    where c.job_id = p_job_id
      and c.user_id = p_user_id
      and c.resolution_m = 25
      and c.avg_depth_m between 0.2 and 200
      and ((c.grid_x # c.grid_y) & 31) = p_source_bucket
  ),
  aggregated as (
    select
      c.grid_x,
      c.grid_y,
      sum(c.avg_depth_m * c.contribution_weight) as weighted_depth_sum,
      sum(c.contribution_weight) as weight_sum,
      min(c.avg_depth_m)::real as min_depth_m,
      max(c.avg_depth_m)::real as max_depth_m,
      count(*)::integer as source_cell_count,
      min(c.distance_cells)::real as nearest_distance_cells
    from contributions c
    group by c.grid_x, c.grid_y
  )
  insert into public.sonar_bathymetry_coverage_contributions (
    user_id,
    job_id,
    source_bucket,
    target_bucket,
    grid_x,
    grid_y,
    weighted_depth_sum,
    weight_sum,
    min_depth_m,
    max_depth_m,
    source_cell_count,
    nearest_distance_cells
  )
  select
    p_user_id,
    p_job_id,
    p_source_bucket,
    ((a.grid_x # a.grid_y) & 31)::smallint,
    a.grid_x,
    a.grid_y,
    a.weighted_depth_sum,
    a.weight_sum,
    a.min_depth_m,
    a.max_depth_m,
    a.source_cell_count,
    a.nearest_distance_cells
  from aggregated a
  on conflict (user_id, job_id, source_bucket, grid_x, grid_y)
  do update set
    target_bucket = excluded.target_bucket,
    weighted_depth_sum = excluded.weighted_depth_sum,
    weight_sum = excluded.weight_sum,
    min_depth_m = excluded.min_depth_m,
    max_depth_m = excluded.max_depth_m,
    source_cell_count = excluded.source_cell_count,
    nearest_distance_cells = excluded.nearest_distance_cells;

  get diagnostics inserted_count = row_count;
  return inserted_count;
end
$$;

create or replace function public.sonar_finalize_bathymetry_coverage_bucket(
  p_job_id uuid,
  p_user_id uuid,
  p_target_bucket smallint
)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
set statement_timeout = '5min'
as $$
declare
  inserted_count bigint;
begin
  if p_target_bucket not between 0 and 31 then
    raise exception 'Invalid bathymetry coverage target bucket';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      p_job_id::text || ':bathymetry:coverage:target:'
        || p_target_bucket::text,
      0
    )
  );

  delete from public.sonar_bathymetry_coverage_cells
  where job_id = p_job_id
    and user_id = p_user_id
    and ((grid_x # grid_y) & 31) = p_target_bucket;

  with aggregated as materialized (
    select
      c.grid_x,
      c.grid_y,
      (sum(c.weighted_depth_sum) / nullif(sum(c.weight_sum), 0))::real
        as avg_depth_m,
      min(c.min_depth_m)::real as min_depth_m,
      max(c.max_depth_m)::real as max_depth_m,
      sum(c.source_cell_count)::integer as source_cell_count,
      min(c.nearest_distance_cells)::real as nearest_distance_cells
    from public.sonar_bathymetry_coverage_contributions c
    where c.job_id = p_job_id
      and c.user_id = p_user_id
      and c.target_bucket = p_target_bucket
    group by c.grid_x, c.grid_y
  )
  insert into public.sonar_bathymetry_coverage_cells (
    user_id,
    job_id,
    resolution_m,
    grid_x,
    grid_y,
    source_cell_count,
    avg_depth_m,
    min_depth_m,
    max_depth_m,
    confidence,
    centroid,
    geometry
  )
  select
    p_user_id,
    p_job_id,
    25,
    a.grid_x,
    a.grid_y,
    a.source_cell_count,
    a.avg_depth_m,
    a.min_depth_m,
    a.max_depth_m,
    least(
      0.72,
      greatest(
        0.1,
        (1 - least(a.nearest_distance_cells, 3) / 4) * 0.48
          + least(a.source_cell_count, 8)::real / 8 * 0.24
      )
    )::real,
    st_transform(
      st_setsrid(
        st_makepoint((a.grid_x + 0.5) * 25, (a.grid_y + 0.5) * 25),
        3857
      ),
      4326
    ),
    st_transform(
      st_makeenvelope(
        a.grid_x * 25,
        a.grid_y * 25,
        (a.grid_x + 1) * 25,
        (a.grid_y + 1) * 25,
        3857
      ),
      4326
    )
  from aggregated a;

  get diagnostics inserted_count = row_count;
  return inserted_count;
end
$$;

create or replace function public.sonar_clear_bathymetry_coverage_bucket(
  p_job_id uuid,
  p_user_id uuid,
  p_source_bucket smallint
)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  deleted_count bigint;
begin
  if p_source_bucket not between 0 and 31 then
    raise exception 'Invalid bathymetry coverage source bucket';
  end if;

  delete from public.sonar_bathymetry_coverage_contributions
  where job_id = p_job_id
    and user_id = p_user_id
    and source_bucket = p_source_bucket;

  get diagnostics deleted_count = row_count;
  return deleted_count;
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
  contour_simplification_m double precision;
  coverage_tile bytea;
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
    else 25
  end;
  contour_simplification_m := case
    when p_z <= 10 then 12
    when p_z <= 12 then 4
    when p_z <= 14 then 1
    else 0.25
  end;

  -- The broad 25 metre surface is a separate MVT layer. The client paints
  -- it below the measured/high-resolution surface and with lower opacity.
  with coverage_features as (
    select
      b.avg_depth_m as depth,
      b.min_depth_m as min_depth,
      b.max_depth_m as max_depth,
      b.source_cell_count as samples,
      b.confidence,
      b.resolution_m as resolution,
      st_asmvtgeom(
        st_transform(b.geometry, 3857),
        tile_bounds,
        4096,
        64,
        true
      ) as geom
    from public.sonar_bathymetry_coverage_cells b
    join public.sonar_import_jobs j on j.id = b.job_id
    where p_z >= 13
      and b.user_id = p_user_id
      and j.status in ('completed', 'completed_with_errors')
      and b.geometry && geographic_bounds
  )
  select coalesce(
    st_asmvt(coverage_features, 'depth_coverage', 4096, 'geom'),
    ''::bytea
  )
  into coverage_tile
  from coverage_features;

  with depth_features as (
    select
      b.avg_depth_m as depth,
      b.min_depth_m as min_depth,
      b.max_depth_m as max_depth,
      b.source_cell_count as samples,
      b.slope_deg as slope,
      b.aspect_deg as aspect,
      b.hillshade,
      null::real as hardness,
      null::real as vegetation,
      null::real as vendor_a,
      null::real as vendor_b,
      b.confidence,
      st_asmvtgeom(
        st_transform(b.geometry, 3857),
        tile_bounds,
        4096,
        64,
        true
      ) as geom
    from public.sonar_bathymetry_cells b
    join public.sonar_import_jobs j on j.id = b.job_id
    where p_z >= 14
      and b.user_id = p_user_id
      and b.resolution_m = 10
      and j.status in ('completed', 'completed_with_errors')
      and b.geometry && geographic_bounds

    union all

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
      1::real as confidence,
      st_asmvtgeom(
        st_transform(c.geometry, 3857),
        tile_bounds,
        4096,
        64,
        true
      ) as geom
    from public.sonar_depth_cells c
    join public.sonar_import_jobs j on j.id = c.job_id
    where p_z < 14
      and c.user_id = p_user_id
      and c.resolution_m = cell_resolution
      and j.status in ('completed', 'completed_with_errors')
      and c.geometry && geographic_bounds
  )
  select coalesce(
    st_asmvt(depth_features, 'depth_cells', 4096, 'geom'),
    ''::bytea
  )
  into depth_tile
  from depth_features;

  with contour_features as (
    select
      c.depth_m as depth,
      c.interval_m as interval,
      st_asmvtgeom(
        st_simplify(
          st_transform(c.geometry, 3857),
          contour_simplification_m
        ),
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
      and (
        p_z >= 14
        or (
          p_z = 13
          and mod(round(c.depth_m * 2)::integer, 2) = 0
        )
        or (
          p_z between 11 and 12
          and mod(round(c.depth_m * 2)::integer, 5) = 0
        )
        or (
          p_z <= 10
          and mod(round(c.depth_m * 2)::integer, 10) = 0
        )
      )
  )
  select coalesce(
    st_asmvt(contour_features, 'contours', 4096, 'geom'),
    ''::bytea
  )
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
  select coalesce(
    st_asmvt(track_features, 'tracks', 4096, 'geom'),
    ''::bytea
  )
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
  select coalesce(
    st_asmvt(waypoint_features, 'waypoints', 4096, 'geom'),
    ''::bytea
  )
  into waypoint_tile
  from waypoint_features;

  return encode(
    coalesce(coverage_tile, ''::bytea)
    || coalesce(depth_tile, ''::bytea)
    || coalesce(contour_tile, ''::bytea)
    || coalesce(track_tile, ''::bytea)
    || coalesce(waypoint_tile, ''::bytea),
    'base64'
  );
end
$$;

revoke all on function public.sonar_prepare_bathymetry_coverage(
  uuid, uuid
) from public, anon, authenticated;
revoke all on function public.sonar_accumulate_bathymetry_coverage_bucket(
  uuid, uuid, smallint
) from public, anon, authenticated;
revoke all on function public.sonar_finalize_bathymetry_coverage_bucket(
  uuid, uuid, smallint
) from public, anon, authenticated;
revoke all on function public.sonar_clear_bathymetry_coverage_bucket(
  uuid, uuid, smallint
) from public, anon, authenticated;
revoke all on function public.sonar_vector_tile(
  uuid, integer, integer, integer
) from public, anon, authenticated;

grant execute on function public.sonar_prepare_bathymetry_coverage(
  uuid, uuid
) to service_role;
grant execute on function public.sonar_accumulate_bathymetry_coverage_bucket(
  uuid, uuid, smallint
) to service_role;
grant execute on function public.sonar_finalize_bathymetry_coverage_bucket(
  uuid, uuid, smallint
) to service_role;
grant execute on function public.sonar_clear_bathymetry_coverage_bucket(
  uuid, uuid, smallint
) to service_role;
grant execute on function public.sonar_vector_tile(
  uuid, integer, integer, integer
) to service_role;
