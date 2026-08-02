-- Add scientifically distinct contours for the broad 25 metre interpolated
-- surface. They are kept separate from the measured/detail contours so the
-- client can render them with a dashed, lower-confidence style.

create table public.sonar_bathymetry_coverage_contours (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  job_id uuid not null references public.sonar_import_jobs(id) on delete cascade,
  depth_m real not null,
  interval_m real not null default 1,
  confidence text not null default 'interpolated'
    check (confidence = 'interpolated'),
  geometry geometry(LineString, 4326) not null,
  created_at timestamptz not null default now()
);

create index sonar_bathymetry_coverage_contours_geometry_gix
  on public.sonar_bathymetry_coverage_contours using gist (geometry);
create index sonar_bathymetry_coverage_contours_job_depth_idx
  on public.sonar_bathymetry_coverage_contours (user_id, job_id, depth_m);
create index sonar_bathymetry_coverage_contours_job_id_idx
  on public.sonar_bathymetry_coverage_contours (job_id);

alter table public.sonar_bathymetry_coverage_contours
  enable row level security;
revoke all on table public.sonar_bathymetry_coverage_contours
  from public, anon, authenticated;
grant all on table public.sonar_bathymetry_coverage_contours
  to service_role;

create or replace function public.sonar_build_bathymetry_coverage_contours(
  p_job_id uuid,
  p_user_id uuid,
  p_interval_m real default 1
)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
set statement_timeout = '10min'
as $$
declare
  inserted_count bigint;
begin
  if p_interval_m < 0.5 or p_interval_m > 20 then
    raise exception 'Invalid coverage contour interval';
  end if;

  if not exists (
    select 1
    from public.sonar_import_jobs
    where id = p_job_id
      and user_id = p_user_id
  ) then
    raise exception 'Sonar job not found';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_job_id::text || ':coverage-contours', 0)
  );

  delete from public.sonar_bathymetry_coverage_contours
  where job_id = p_job_id
    and user_id = p_user_id;

  with depth_percentile as materialized (
    select
      percentile_cont(0.99) within group (order by avg_depth_m)
        as p99_depth_m
    from public.sonar_bathymetry_coverage_cells
    where job_id = p_job_id
      and user_id = p_user_id
      and avg_depth_m between 0.2 and 200
  ),
  depth_limit as materialized (
    select least(
      200,
      p99_depth_m + greatest(10, p99_depth_m * 0.5)
    ) as max_depth_m
    from depth_percentile
  ),
  surface as materialized (
    select
      c.grid_x,
      c.grid_y,
      c.avg_depth_m::double precision as depth_m
    from public.sonar_bathymetry_coverage_cells c
    cross join depth_limit l
    where c.job_id = p_job_id
      and c.user_id = p_user_id
      and c.resolution_m = 25
      and c.confidence >= 0.2
      and c.avg_depth_m between 0.2 and 200
      and c.avg_depth_m <= l.max_depth_m
      and c.max_depth_m - c.min_depth_m
        <= greatest(6, c.avg_depth_m * 1.2)
      -- Detail contours already cover this area. Excluding coverage-cell
      -- centres that fall on the 10 metre surface prevents double lines.
      and not exists (
        select 1
        from public.sonar_bathymetry_cells d
        where d.user_id = c.user_id
          and d.job_id = c.job_id
          and d.resolution_m = 10
          and d.geometry && c.centroid
          and st_covers(d.geometry, c.centroid)
      )
  ),
  quads as materialized (
    select
      sw.grid_x,
      sw.grid_y,
      sw.depth_m as d_sw,
      se.depth_m as d_se,
      nw.depth_m as d_nw,
      ne.depth_m as d_ne,
      (sw.grid_x + 0.5)::double precision * 25 as x0,
      (sw.grid_y + 0.5)::double precision * 25 as y0,
      (sw.grid_x + 1.5)::double precision * 25 as x1,
      (sw.grid_y + 1.5)::double precision * 25 as y1
    from surface sw
    join surface se
      on se.grid_x = sw.grid_x + 1 and se.grid_y = sw.grid_y
    join surface nw
      on nw.grid_x = sw.grid_x and nw.grid_y = sw.grid_y + 1
    join surface ne
      on ne.grid_x = sw.grid_x + 1 and ne.grid_y = sw.grid_y + 1
  ),
  triangles as materialized (
    select
      q.grid_x,
      q.grid_y,
      1 as triangle_no,
      q.x0 as ax, q.y0 as ay, q.d_sw as ad,
      q.x1 as bx, q.y0 as by, q.d_se as bd,
      q.x1 as cx, q.y1 as cy, q.d_ne as cd
    from quads q
    union all
    select
      q.grid_x,
      q.grid_y,
      2 as triangle_no,
      q.x0 as ax, q.y0 as ay, q.d_sw as ad,
      q.x1 as bx, q.y1 as by, q.d_ne as bd,
      q.x0 as cx, q.y1 as cy, q.d_nw as cd
    from quads q
  ),
  levels as materialized (
    select
      t.*,
      (level_index * p_interval_m)::double precision as depth_m
    from triangles t
    cross join lateral generate_series(
      ceil(least(t.ad, t.bd, t.cd) / p_interval_m)::integer,
      floor(greatest(t.ad, t.bd, t.cd) / p_interval_m)::integer
    ) as level_index
  ),
  crossings as materialized (
    select
      l.grid_x,
      l.grid_y,
      l.triangle_no,
      l.depth_m,
      edge.edge_no,
      st_setsrid(
        st_makepoint(
          edge.xa + (edge.xb - edge.xa)
            * ((l.depth_m - edge.da) / nullif(edge.db - edge.da, 0)),
          edge.ya + (edge.yb - edge.ya)
            * ((l.depth_m - edge.da) / nullif(edge.db - edge.da, 0))
        ),
        3857
      ) as point
    from levels l
    cross join lateral (
      values
        (1, l.ax, l.ay, l.ad, l.bx, l.by, l.bd),
        (2, l.bx, l.by, l.bd, l.cx, l.cy, l.cd),
        (3, l.cx, l.cy, l.cd, l.ax, l.ay, l.ad)
    ) as edge(edge_no, xa, ya, da, xb, yb, db)
    where edge.da <> edge.db
      and l.depth_m >= least(edge.da, edge.db)
      and l.depth_m < greatest(edge.da, edge.db)
  ),
  triangle_segments as materialized (
    select
      c.grid_x,
      c.grid_y,
      c.triangle_no,
      c.depth_m,
      st_makeline(array_agg(c.point order by c.edge_no)) as geometry
    from crossings c
    group by c.grid_x, c.grid_y, c.triangle_no, c.depth_m
    having count(*) = 2
  ),
  merged as materialized (
    select
      s.depth_m,
      st_linemerge(st_unaryunion(st_collect(s.geometry))) as geometry
    from triangle_segments s
    where st_length(s.geometry) > 0.1
    group by s.depth_m
  ),
  dumped as materialized (
    select
      m.depth_m,
      (st_dump(st_collectionextract(m.geometry, 2))).geom as geometry
    from merged m
  ),
  smoothed as (
    select
      d.depth_m,
      case
        when st_npoints(d.geometry) >= 3 then
          st_chaikinsmoothing(
            st_simplifypreservetopology(d.geometry, 0.8),
            2,
            true
          )
        else d.geometry
      end as geometry
    from dumped d
    where not st_isempty(d.geometry)
      and st_length(d.geometry) >= 12
  )
  insert into public.sonar_bathymetry_coverage_contours (
    user_id,
    job_id,
    depth_m,
    interval_m,
    confidence,
    geometry
  )
  select
    p_user_id,
    p_job_id,
    s.depth_m::real,
    p_interval_m,
    'interpolated',
    st_transform(s.geometry, 4326)
  from smoothed s
  where not st_isempty(s.geometry)
    and st_npoints(s.geometry) >= 2;

  get diagnostics inserted_count = row_count;
  return inserted_count;
end
$$;

create or replace function public.sonar_coverage_contour_vector_tile(
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
  simplification_m double precision;
  contour_tile bytea;
begin
  if p_z < 0 or p_z > 22 or p_x < 0 or p_y < 0 then
    raise exception 'Invalid tile coordinate';
  end if;

  tile_bounds := st_tileenvelope(p_z, p_x, p_y);
  geographic_bounds := st_transform(tile_bounds, 4326);
  simplification_m := case
    when p_z <= 11 then 10
    when p_z <= 13 then 3
    when p_z <= 15 then 1
    else 0.5
  end;

  with contour_features as (
    select
      c.depth_m as depth,
      c.interval_m as interval,
      c.confidence,
      st_asmvtgeom(
        st_simplifypreservetopology(
          st_transform(c.geometry, 3857),
          simplification_m
        ),
        tile_bounds,
        4096,
        64,
        true
      ) as geom
    from public.sonar_bathymetry_coverage_contours c
    join public.sonar_import_jobs j on j.id = c.job_id
    where c.user_id = p_user_id
      and j.status in ('completed', 'completed_with_errors')
      and c.geometry && geographic_bounds
      and (
        p_z >= 14
        or (p_z = 13 and mod(round(c.depth_m)::integer, 2) = 0)
        or (p_z between 11 and 12 and mod(round(c.depth_m)::integer, 5) = 0)
        or (p_z <= 10 and mod(round(c.depth_m)::integer, 10) = 0)
      )
  )
  select coalesce(
    st_asmvt(contour_features, 'coverage_contours', 4096, 'geom'),
    ''::bytea
  )
  into contour_tile
  from contour_features;

  return encode(coalesce(contour_tile, ''::bytea), 'base64');
end
$$;

revoke all on function public.sonar_build_bathymetry_coverage_contours(
  uuid, uuid, real
) from public, anon, authenticated;
revoke all on function public.sonar_coverage_contour_vector_tile(
  uuid, integer, integer, integer
) from public, anon, authenticated;

grant execute on function public.sonar_build_bathymetry_coverage_contours(
  uuid, uuid, real
) to service_role;
grant execute on function public.sonar_coverage_contour_vector_tile(
  uuid, integer, integer, integer
) to service_role;
