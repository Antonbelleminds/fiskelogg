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
  contour_simplification double precision;
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
  contour_simplification := case
    when p_z <= 10 then 0.00003
    when p_z <= 12 then 0.00001
    else 0.000002
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
        st_transform(
          st_simplify(c.geometry, contour_simplification),
          3857
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
        p_z >= 13
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
    coalesce(depth_tile, ''::bytea)
    || coalesce(contour_tile, ''::bytea)
    || coalesce(track_tile, ''::bytea)
    || coalesce(waypoint_tile, ''::bytea),
    'base64'
  );
end
$$;
