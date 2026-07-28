create table public.sonar_bathymetry_contributions (
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

create index sonar_bathymetry_contributions_target_idx
  on public.sonar_bathymetry_contributions (
    user_id,
    job_id,
    target_bucket,
    grid_x,
    grid_y
  );

create table public.sonar_bathymetry_cells (
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
  slope_deg real,
  aspect_deg real,
  hillshade real,
  centroid geometry(Point, 4326) not null,
  geometry geometry(Polygon, 4326) not null,
  created_at timestamptz not null default now(),
  primary key (user_id, job_id, grid_x, grid_y)
);

create index sonar_bathymetry_cells_geometry_gix
  on public.sonar_bathymetry_cells using gist (geometry);
create index sonar_bathymetry_cells_tile_idx
  on public.sonar_bathymetry_cells (user_id, job_id);
create index sonar_bathymetry_cells_bucket_idx
  on public.sonar_bathymetry_cells (
    user_id,
    job_id,
    (((grid_x # grid_y) & 31))
  );

alter table public.sonar_bathymetry_contributions enable row level security;
alter table public.sonar_bathymetry_cells enable row level security;
revoke all on table public.sonar_bathymetry_contributions
  from public, anon, authenticated;
revoke all on table public.sonar_bathymetry_cells
  from public, anon, authenticated;
grant all on table public.sonar_bathymetry_contributions to service_role;
grant all on table public.sonar_bathymetry_cells to service_role;

create or replace function public.sonar_prepare_bathymetry(
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
    hashtextextended(p_job_id::text || ':bathymetry:prepare', 0)
  );

  delete from public.sonar_bathymetry_contributions
  where job_id = p_job_id
    and user_id = p_user_id;

  delete from public.sonar_bathymetry_cells
  where job_id = p_job_id
    and user_id = p_user_id;

  get diagnostics deleted_count = row_count;
  return deleted_count;
end
$$;

create or replace function public.sonar_accumulate_bathymetry_bucket(
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
  inserted_count bigint;
begin
  if p_source_bucket not between 0 and 31 then
    raise exception 'Invalid bathymetry source bucket';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      p_job_id::text || ':bathymetry:source:' || p_source_bucket::text,
      0
    )
  );

  delete from public.sonar_bathymetry_contributions
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
        * (1 + ln(1 + greatest(c.sample_count, 1))) as contribution_weight
    from public.sonar_depth_cells c
    cross join offsets o
    where c.job_id = p_job_id
      and c.user_id = p_user_id
      and c.resolution_m = 25
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
  insert into public.sonar_bathymetry_contributions (
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

create or replace function public.sonar_finalize_bathymetry_bucket(
  p_job_id uuid,
  p_user_id uuid,
  p_target_bucket smallint
)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  inserted_count bigint;
begin
  if p_target_bucket not between 0 and 31 then
    raise exception 'Invalid bathymetry target bucket';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      p_job_id::text || ':bathymetry:target:' || p_target_bucket::text,
      0
    )
  );

  delete from public.sonar_bathymetry_cells
  where job_id = p_job_id
    and user_id = p_user_id
    and ((grid_x # grid_y) & 31) = p_target_bucket;

  with aggregated as materialized (
    select
      c.grid_x,
      c.grid_y,
      (
        sum(c.weighted_depth_sum) / nullif(sum(c.weight_sum), 0)
      )::real as avg_depth_m,
      min(c.min_depth_m)::real as min_depth_m,
      max(c.max_depth_m)::real as max_depth_m,
      sum(c.source_cell_count)::integer as source_cell_count,
      min(c.nearest_distance_cells)::real as nearest_distance_cells
    from public.sonar_bathymetry_contributions c
    where c.job_id = p_job_id
      and c.user_id = p_user_id
      and c.target_bucket = p_target_bucket
    group by c.grid_x, c.grid_y
  )
  insert into public.sonar_bathymetry_cells (
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
      1,
      greatest(
        0.12,
        (1 - least(a.nearest_distance_cells, 3) / 4) * 0.65
          + least(a.source_cell_count, 8)::real / 8 * 0.35
      )
    )::real,
    st_transform(
      st_setsrid(
        st_makepoint(
          (a.grid_x + 0.5) * 25,
          (a.grid_y + 0.5) * 25
        ),
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

create or replace function public.sonar_finalize_bathymetry_terrain_bucket(
  p_job_id uuid,
  p_user_id uuid,
  p_target_bucket smallint
)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  changed_count bigint;
begin
  if p_target_bucket not between 0 and 31 then
    raise exception 'Invalid bathymetry terrain bucket';
  end if;

  with gradients as (
    select
      c.user_id,
      c.job_id,
      c.grid_x,
      c.grid_y,
      (
        coalesce(e.avg_depth_m, c.avg_depth_m)
        - coalesce(w.avg_depth_m, c.avg_depth_m)
      ) / 50 as dzdx,
      (
        coalesce(n.avg_depth_m, c.avg_depth_m)
        - coalesce(s.avg_depth_m, c.avg_depth_m)
      ) / 50 as dzdy
    from public.sonar_bathymetry_cells c
    left join public.sonar_bathymetry_cells e
      on e.user_id = c.user_id
      and e.job_id = c.job_id
      and e.grid_x = c.grid_x + 1
      and e.grid_y = c.grid_y
    left join public.sonar_bathymetry_cells w
      on w.user_id = c.user_id
      and w.job_id = c.job_id
      and w.grid_x = c.grid_x - 1
      and w.grid_y = c.grid_y
    left join public.sonar_bathymetry_cells n
      on n.user_id = c.user_id
      and n.job_id = c.job_id
      and n.grid_x = c.grid_x
      and n.grid_y = c.grid_y + 1
    left join public.sonar_bathymetry_cells s
      on s.user_id = c.user_id
      and s.job_id = c.job_id
      and s.grid_x = c.grid_x
      and s.grid_y = c.grid_y - 1
    where c.user_id = p_user_id
      and c.job_id = p_job_id
      and ((c.grid_x # c.grid_y) & 31) = p_target_bucket
  ),
  terrain as (
    select
      g.*,
      degrees(atan(sqrt(g.dzdx * g.dzdx + g.dzdy * g.dzdy))) as slope,
      (
        degrees(atan2(g.dzdy, -g.dzdx)) + 360
        - floor(
          (degrees(atan2(g.dzdy, -g.dzdx)) + 360) / 360
        ) * 360
      ) as aspect
    from gradients g
  )
  update public.sonar_bathymetry_cells c
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
    and c.grid_x = t.grid_x
    and c.grid_y = t.grid_y;

  get diagnostics changed_count = row_count;
  return changed_count;
end
$$;

create or replace function public.sonar_clear_bathymetry_bucket(
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
  delete from public.sonar_bathymetry_contributions
  where job_id = p_job_id
    and user_id = p_user_id
    and source_bucket = p_source_bucket;

  get diagnostics deleted_count = row_count;
  return deleted_count;
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
set statement_timeout = '5min'
as $$
declare
  inserted_count bigint;
begin
  if p_interval_m <= 0 or p_interval_m > 20 then
    raise exception 'Invalid contour interval';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_job_id::text || ':contours', 0)
  );

  delete from public.sonar_depth_contours
  where job_id = p_job_id
    and user_id = p_user_id;

  with surface_cells as materialized (
    select
      b.avg_depth_m,
      b.geometry
    from public.sonar_bathymetry_cells b
    where b.job_id = p_job_id
      and b.user_id = p_user_id
    union all
    select
      c.avg_depth_m,
      c.geometry
    from public.sonar_depth_cells c
    where c.job_id = p_job_id
      and c.user_id = p_user_id
      and c.resolution_m = 25
      and not exists (
        select 1
        from public.sonar_bathymetry_cells b
        where b.job_id = p_job_id
          and b.user_id = p_user_id
      )
  ),
  depth_bands as materialized (
    select
      floor(c.avg_depth_m / p_interval_m) * p_interval_m as depth_m,
      st_unaryunion(st_collect(c.geometry)) as geometry
    from surface_cells c
    group by floor(c.avg_depth_m / p_interval_m)
  ),
  dumped_lines as (
    select
      b.depth_m::real as depth_m,
      (st_dump(st_collectionextract(st_boundary(b.geometry), 2))).geom
        as geometry
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
    else 25
  end;

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
    where p_z >= 12
      and b.user_id = p_user_id
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
    where p_z < 12
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
    coalesce(depth_tile, ''::bytea)
    || coalesce(contour_tile, ''::bytea)
    || coalesce(track_tile, ''::bytea)
    || coalesce(waypoint_tile, ''::bytea),
    'base64'
  );
end
$$;

revoke all on function public.sonar_prepare_bathymetry(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.sonar_accumulate_bathymetry_bucket(
  uuid,
  uuid,
  smallint
) from public, anon, authenticated;
revoke all on function public.sonar_finalize_bathymetry_bucket(
  uuid,
  uuid,
  smallint
) from public, anon, authenticated;
revoke all on function public.sonar_finalize_bathymetry_terrain_bucket(
  uuid,
  uuid,
  smallint
) from public, anon, authenticated;
revoke all on function public.sonar_clear_bathymetry_bucket(
  uuid,
  uuid,
  smallint
) from public, anon, authenticated;

grant execute on function public.sonar_prepare_bathymetry(uuid, uuid)
  to service_role;
grant execute on function public.sonar_accumulate_bathymetry_bucket(
  uuid,
  uuid,
  smallint
) to service_role;
grant execute on function public.sonar_finalize_bathymetry_bucket(
  uuid,
  uuid,
  smallint
) to service_role;
grant execute on function public.sonar_finalize_bathymetry_terrain_bucket(
  uuid,
  uuid,
  smallint
) to service_role;
grant execute on function public.sonar_clear_bathymetry_bucket(
  uuid,
  uuid,
  smallint
) to service_role;

revoke all on function public.sonar_vector_tile(uuid, integer, integer, integer)
  from public, anon, authenticated;
grant execute on function public.sonar_vector_tile(
  uuid,
  integer,
  integer,
  integer
) to service_role;
