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
    st_chaikinsmoothing(
      st_simplify(d.geometry, 0.000002),
      2,
      true
    )
  from dumped_lines d
  where not st_isempty(d.geometry)
    and st_npoints(d.geometry) >= 2;

  get diagnostics inserted_count = row_count;
  return inserted_count;
end
$$;
