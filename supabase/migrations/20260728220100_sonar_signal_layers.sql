create or replace function public.sonar_signal_vector_tile(
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
  signal_tile bytea;
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

  with signal_features as (
    select
      c.avg_depth_m as depth,
      c.sample_count as samples,
      c.avg_vendor_channel_a as hardness_signal,
      c.avg_vendor_channel_b as vegetation_signal,
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
      and (
        c.avg_vendor_channel_a is not null
        or c.avg_vendor_channel_b is not null
      )
  )
  select coalesce(
    st_asmvt(signal_features, 'signals', 4096, 'geom'),
    ''::bytea
  )
  into signal_tile
  from signal_features;

  return encode(coalesce(signal_tile, ''::bytea), 'base64');
end
$$;

revoke all on function public.sonar_signal_vector_tile(
  uuid,
  integer,
  integer,
  integer
) from public, anon, authenticated;

grant execute on function public.sonar_signal_vector_tile(
  uuid,
  integer,
  integer,
  integer
) to service_role;
