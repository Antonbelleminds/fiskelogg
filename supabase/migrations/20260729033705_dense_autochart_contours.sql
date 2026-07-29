create or replace function public.sonar_build_contours(
  p_job_id uuid,
  p_user_id uuid,
  p_interval_m real default 0.5
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
  if p_interval_m < 0.25 or p_interval_m > 20 then
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
      and b.confidence >= 0.35
      and b.avg_depth_m between 0.2 and 200
      and b.max_depth_m - b.min_depth_m
        <= greatest(4, b.avg_depth_m * 1.5)

    union all

    select
      c.avg_depth_m,
      c.geometry
    from public.sonar_depth_cells c
    where c.job_id = p_job_id
      and c.user_id = p_user_id
      and c.resolution_m = 25
      and c.sample_count >= 2
      and c.avg_depth_m between 0.2 and 200
      and c.max_depth_m - c.min_depth_m
        <= greatest(4, c.avg_depth_m * 1.5)
      and not exists (
        select 1
        from public.sonar_bathymetry_cells b
        where b.job_id = p_job_id
          and b.user_id = p_user_id
      )
  ),
  depth_bands as materialized (
    select
      round(
        (floor(c.avg_depth_m / p_interval_m) * p_interval_m)::numeric,
        2
      )::real as depth_m,
      st_unaryunion(st_collect(c.geometry)) as geometry
    from surface_cells c
    group by round(
      (floor(c.avg_depth_m / p_interval_m) * p_interval_m)::numeric,
      2
    )
  ),
  dumped_lines as (
    select
      b.depth_m,
      (st_dump(
        st_collectionextract(st_boundary(b.geometry), 2)
      )).geom as geometry
    from depth_bands b
  ),
  smoothed_lines as (
    select
      d.depth_m,
      st_chaikinsmoothing(
        st_simplify(
          st_removerepeatedpoints(d.geometry, 0.0000005),
          0.000001
        ),
        3,
        true
      ) as geometry
    from dumped_lines d
    where not st_isempty(d.geometry)
      and st_npoints(d.geometry) >= 2
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
    s.depth_m,
    p_interval_m,
    s.geometry
  from smoothed_lines s
  where not st_isempty(s.geometry)
    and st_npoints(s.geometry) >= 2;

  get diagnostics inserted_count = row_count;
  return inserted_count;
end
$$;
