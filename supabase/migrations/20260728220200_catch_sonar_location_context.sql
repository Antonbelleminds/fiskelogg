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
  nearest_surface as (
    select
      b.avg_depth_m,
      b.min_depth_m,
      b.max_depth_m,
      b.slope_deg,
      b.aspect_deg,
      b.hillshade,
      b.confidence,
      b.source_cell_count,
      st_distance(
        b.geometry::geography,
        click.position::geography
      )::real as distance_m
    from public.sonar_bathymetry_cells b
    join public.sonar_import_jobs j on j.id = b.job_id
    cross join click
    where b.user_id = p_user_id
      and j.status in ('completed', 'completed_with_errors')
      and b.geometry && st_expand(click.position, 0.002)
      and st_dwithin(
        b.geometry::geography,
        click.position::geography,
        100
      )
    order by
      st_distance(b.geometry::geography, click.position::geography),
      b.confidence desc
    limit 1
  ),
  nearest_signal as (
    select
      c.avg_depth_m,
      c.min_depth_m,
      c.max_depth_m,
      c.slope_deg,
      c.avg_bottom_hardness,
      c.avg_vegetation_height_m,
      c.avg_vendor_channel_a,
      c.avg_vendor_channel_b,
      c.sample_count,
      st_distance(
        c.centroid::geography,
        click.position::geography
      )::real as distance_m
    from public.sonar_depth_cells c
    join public.sonar_import_jobs j on j.id = c.job_id
    cross join click
    where c.user_id = p_user_id
      and c.resolution_m = 10
      and j.status in ('completed', 'completed_with_errors')
      and c.geometry && st_expand(click.position, 0.002)
      and st_dwithin(
        c.centroid::geography,
        click.position::geography,
        100
      )
    order by
      st_distance(c.centroid::geography, click.position::geography),
      c.sample_count desc
    limit 1
  ),
  nearest_point as (
    select
      p.observed_at,
      p.water_temp_c,
      p.speed_ms,
      p.heading_deg,
      st_distance(
        p.position::geography,
        click.position::geography
      )::real as distance_m
    from public.sonar_survey_points p
    join public.sonar_import_jobs j on j.id = p.job_id
    cross join click
    where p.user_id = p_user_id
      and j.status in ('completed', 'completed_with_errors')
      and p.position && st_expand(click.position, 0.002)
      and st_dwithin(
        p.position::geography,
        click.position::geography,
        100
      )
    order by st_distance(
      p.position::geography,
      click.position::geography
    )
    limit 1
  ),
  nearest_depth_edge as (
    select
      c.slope_deg,
      st_distance(
        c.centroid::geography,
        click.position::geography
      )::real as distance_m
    from public.sonar_depth_cells c
    join public.sonar_import_jobs j on j.id = c.job_id
    cross join click
    where c.user_id = p_user_id
      and c.resolution_m = 10
      and c.slope_deg >= 5
      and j.status in ('completed', 'completed_with_errors')
      and c.geometry && st_expand(click.position, 0.004)
      and st_dwithin(
        c.centroid::geography,
        click.position::geography,
        150
      )
    order by st_distance(
      c.centroid::geography,
      click.position::geography
    )
    limit 1
  ),
  nearest_vegetation as (
    select
      st_distance(
        c.centroid::geography,
        click.position::geography
      )::real as distance_m
    from public.sonar_depth_cells c
    join public.sonar_import_jobs j on j.id = c.job_id
    cross join click
    where c.user_id = p_user_id
      and c.resolution_m = 10
      and c.avg_vendor_channel_b >= 1.7
      and j.status in ('completed', 'completed_with_errors')
      and c.geometry && st_expand(click.position, 0.004)
      and st_dwithin(
        c.centroid::geography,
        click.position::geography,
        150
      )
    order by st_distance(
      c.centroid::geography,
      click.position::geography
    )
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
          and st_dwithin(
            cp.position::geography,
            click.position::geography,
            25
          )
      )::integer as catch_count,
      avg(cp.weight_kg) filter (
        where cp.position is not null
          and st_dwithin(
            cp.position::geography,
            click.position::geography,
            25
          )
      )::real as avg_weight_kg,
      max(cp.weight_kg) filter (
        where cp.position is not null
          and st_dwithin(
            cp.position::geography,
            click.position::geography,
            25
          )
      )::real as max_weight_kg,
      min(st_distance(
        cp.position::geography,
        click.position::geography
      )) filter (
        where cp.position is not null
      )::real as nearest_catch_m
    from catch_positions cp
    cross join click
  )
  select jsonb_build_object(
    'found',
      (select count(*) > 0 from nearest_surface)
      or (select count(*) > 0 from nearest_signal),
    'depthM', coalesce(
      (select avg_depth_m from nearest_surface),
      (select avg_depth_m from nearest_signal)
    ),
    'minDepthM', coalesce(
      (select min_depth_m from nearest_surface),
      (select min_depth_m from nearest_signal)
    ),
    'maxDepthM', coalesce(
      (select max_depth_m from nearest_surface),
      (select max_depth_m from nearest_signal)
    ),
    'slopeDeg', coalesce(
      (select slope_deg from nearest_surface),
      (select slope_deg from nearest_signal)
    ),
    'aspectDeg', (select aspect_deg from nearest_surface),
    'hillshade', (select hillshade from nearest_surface),
    'coverageConfidence', (select confidence from nearest_surface),
    'surfaceSamples', (select source_cell_count from nearest_surface),
    'cellDistanceM', coalesce(
      (select distance_m from nearest_surface),
      (select distance_m from nearest_signal)
    ),
    'signalDistanceM', (select distance_m from nearest_signal),
    'bottomHardness', (select avg_bottom_hardness from nearest_signal),
    'vegetationHeightM',
      (select avg_vegetation_height_m from nearest_signal),
    'vendorChannelA', (select avg_vendor_channel_a from nearest_signal),
    'vendorChannelB', (select avg_vendor_channel_b from nearest_signal),
    'samples', (select sample_count from nearest_signal),
    'observedAt', (select observed_at from nearest_point),
    'waterTempC', (select water_temp_c from nearest_point),
    'boatSpeedMs', (select speed_ms from nearest_point),
    'headingDeg', (select heading_deg from nearest_point),
    'distanceToDepthEdgeM',
      (select distance_m from nearest_depth_edge),
    'depthEdgeSlopeDeg',
      (select slope_deg from nearest_depth_edge),
    'depthEdgeStatus',
      case
        when not (
          (select count(*) > 0 from nearest_surface)
          or (select count(*) > 0 from nearest_signal)
        ) then 'unknown'
        when coalesce(
          (select slope_deg from nearest_surface),
          (select slope_deg from nearest_signal),
          0
        ) >= 5
          or coalesce(
            (select distance_m from nearest_depth_edge),
            999
          ) <= 15
          then 'on_edge'
        when coalesce(
          (select distance_m from nearest_depth_edge),
          999
        ) <= 50
          then 'near_edge'
        else 'flat'
      end,
    'distanceToVegetationM',
      (select distance_m from nearest_vegetation),
    'hardnessClass',
      case
        when (select avg_vendor_channel_a from nearest_signal) is null
          then 'unknown'
        when (select avg_vendor_channel_a from nearest_signal) < 4.5
          then 'low'
        when (select avg_vendor_channel_a from nearest_signal) < 9.7
          then 'medium'
        else 'high'
      end,
    'vegetationClass',
      case
        when (select avg_vendor_channel_b from nearest_signal) is null
          then 'unknown'
        when (select avg_vendor_channel_b from nearest_signal) < 0.5
          then 'low'
        when (select avg_vendor_channel_b from nearest_signal) < 1.7
          then 'medium'
        else 'high'
      end,
    'catchCount', coalesce((select catch_count from catch_stats), 0),
    'avgWeightKg', (select avg_weight_kg from catch_stats),
    'maxWeightKg', (select max_weight_kg from catch_stats),
    'nearestCatchM', (select nearest_catch_m from catch_stats),
    'bottomClassification',
      case
        when (select avg_bottom_hardness from nearest_signal) is null
          then 'Ej klassificerad'
        else 'Leverantörssignal'
      end
  );
$$;

revoke all on function public.sonar_inspect_point(
  uuid,
  double precision,
  double precision
) from public, anon, authenticated;

grant execute on function public.sonar_inspect_point(
  uuid,
  double precision,
  double precision
) to service_role;
