create table public.sonar_depth_cell_batches (
  user_id uuid not null references auth.users(id) on delete cascade,
  job_id uuid not null references public.sonar_import_jobs(id) on delete cascade,
  survey_id uuid not null references public.sonar_surveys(id) on delete cascade,
  resolution_m smallint not null check (resolution_m in (10, 25, 50, 100)),
  grid_x bigint not null,
  grid_y bigint not null,
  bucket smallint not null check (bucket between 0 and 31),
  sample_count integer not null check (sample_count > 0),
  depth_sum double precision not null,
  min_depth_m real not null,
  max_depth_m real not null,
  bottom_hardness_sum double precision,
  bottom_hardness_count integer not null default 0,
  vegetation_height_sum double precision,
  vegetation_height_count integer not null default 0,
  vendor_channel_a_sum double precision,
  vendor_channel_a_count integer not null default 0,
  vendor_channel_b_sum double precision,
  vendor_channel_b_count integer not null default 0,
  primary key (
    user_id,
    job_id,
    resolution_m,
    survey_id,
    grid_x,
    grid_y
  )
);

create index sonar_depth_cell_batches_finalize_idx
  on public.sonar_depth_cell_batches (
    user_id,
    job_id,
    resolution_m,
    bucket,
    grid_x,
    grid_y
  );
create index sonar_depth_cell_batches_survey_idx
  on public.sonar_depth_cell_batches (survey_id);
create index sonar_depth_cells_terrain_bucket_idx
  on public.sonar_depth_cells (
    user_id,
    job_id,
    resolution_m,
    (((grid_x # grid_y) & 31))
  );

alter table public.sonar_depth_cell_batches enable row level security;
revoke all on table public.sonar_depth_cell_batches
  from public, anon, authenticated;
grant all on table public.sonar_depth_cell_batches to service_role;

create or replace function public.sonar_prepare_depth_cell_batches(
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
  deleted_count bigint;
begin
  if p_resolution_m not in (10, 25, 50, 100) then
    raise exception 'Unsupported depth-cell resolution';
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
    hashtextextended(
      p_job_id::text || ':cells:' || p_resolution_m::text || ':prepare',
      0
    )
  );

  delete from public.sonar_depth_cell_batches
  where job_id = p_job_id
    and user_id = p_user_id
    and resolution_m = p_resolution_m;

  delete from public.sonar_depth_cells
  where job_id = p_job_id
    and user_id = p_user_id
    and resolution_m = p_resolution_m;

  get diagnostics deleted_count = row_count;
  return deleted_count;
end
$$;

create or replace function public.sonar_accumulate_depth_cells_survey(
  p_job_id uuid,
  p_user_id uuid,
  p_survey_id uuid,
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
    select 1
    from public.sonar_surveys s
    where s.id = p_survey_id
      and s.job_id = p_job_id
      and s.user_id = p_user_id
  ) then
    raise exception 'Sonar survey not found';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      p_job_id::text
        || ':cells:'
        || p_resolution_m::text
        || ':survey:'
        || p_survey_id::text,
      0
    )
  );

  with projected as materialized (
    select
      floor(
        st_x(st_transform(p.position, 3857)) / p_resolution_m
      )::bigint as grid_x,
      floor(
        st_y(st_transform(p.position, 3857)) / p_resolution_m
      )::bigint as grid_y,
      p.depth_m,
      p.bottom_hardness,
      p.vegetation_height_m,
      p.vendor_channel_a,
      p.vendor_channel_b
    from public.sonar_survey_points p
    where p.job_id = p_job_id
      and p.user_id = p_user_id
      and p.survey_id = p_survey_id
  ),
  aggregated as (
    select
      grid_x,
      grid_y,
      count(*)::integer as sample_count,
      sum(depth_m::double precision) as depth_sum,
      min(depth_m)::real as min_depth_m,
      max(depth_m)::real as max_depth_m,
      sum(bottom_hardness::double precision)
        filter (where bottom_hardness is not null) as bottom_hardness_sum,
      count(bottom_hardness)::integer as bottom_hardness_count,
      sum(vegetation_height_m::double precision)
        filter (where vegetation_height_m is not null) as vegetation_height_sum,
      count(vegetation_height_m)::integer as vegetation_height_count,
      sum(vendor_channel_a::double precision)
        filter (where vendor_channel_a >= 0) as vendor_channel_a_sum,
      (
        count(vendor_channel_a) filter (where vendor_channel_a >= 0)
      )::integer as vendor_channel_a_count,
      sum(vendor_channel_b::double precision)
        filter (where vendor_channel_b >= 0) as vendor_channel_b_sum,
      (
        count(vendor_channel_b) filter (where vendor_channel_b >= 0)
      )::integer as vendor_channel_b_count
    from projected
    group by grid_x, grid_y
  )
  insert into public.sonar_depth_cell_batches (
    user_id,
    job_id,
    survey_id,
    resolution_m,
    grid_x,
    grid_y,
    bucket,
    sample_count,
    depth_sum,
    min_depth_m,
    max_depth_m,
    bottom_hardness_sum,
    bottom_hardness_count,
    vegetation_height_sum,
    vegetation_height_count,
    vendor_channel_a_sum,
    vendor_channel_a_count,
    vendor_channel_b_sum,
    vendor_channel_b_count
  )
  select
    p_user_id,
    p_job_id,
    p_survey_id,
    p_resolution_m,
    a.grid_x,
    a.grid_y,
    ((a.grid_x # a.grid_y) & 31)::smallint,
    a.sample_count,
    a.depth_sum,
    a.min_depth_m,
    a.max_depth_m,
    a.bottom_hardness_sum,
    a.bottom_hardness_count,
    a.vegetation_height_sum,
    a.vegetation_height_count,
    a.vendor_channel_a_sum,
    a.vendor_channel_a_count,
    a.vendor_channel_b_sum,
    a.vendor_channel_b_count
  from aggregated a
  on conflict (
    user_id,
    job_id,
    resolution_m,
    survey_id,
    grid_x,
    grid_y
  )
  do update set
    bucket = excluded.bucket,
    sample_count = excluded.sample_count,
    depth_sum = excluded.depth_sum,
    min_depth_m = excluded.min_depth_m,
    max_depth_m = excluded.max_depth_m,
    bottom_hardness_sum = excluded.bottom_hardness_sum,
    bottom_hardness_count = excluded.bottom_hardness_count,
    vegetation_height_sum = excluded.vegetation_height_sum,
    vegetation_height_count = excluded.vegetation_height_count,
    vendor_channel_a_sum = excluded.vendor_channel_a_sum,
    vendor_channel_a_count = excluded.vendor_channel_a_count,
    vendor_channel_b_sum = excluded.vendor_channel_b_sum,
    vendor_channel_b_count = excluded.vendor_channel_b_count;

  get diagnostics inserted_count = row_count;
  return inserted_count;
end
$$;

create or replace function public.sonar_finalize_depth_cells_batch(
  p_job_id uuid,
  p_user_id uuid,
  p_resolution_m smallint,
  p_bucket smallint
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
  if p_bucket not between 0 and 31 then
    raise exception 'Invalid depth-cell bucket';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      p_job_id::text
        || ':cells:'
        || p_resolution_m::text
        || ':bucket:'
        || p_bucket::text,
      0
    )
  );

  with aggregated as materialized (
    select
      b.grid_x,
      b.grid_y,
      sum(b.sample_count)::integer as sample_count,
      (
        sum(b.depth_sum) / nullif(sum(b.sample_count), 0)
      )::real as avg_depth_m,
      min(b.min_depth_m)::real as min_depth_m,
      max(b.max_depth_m)::real as max_depth_m,
      (
        sum(b.bottom_hardness_sum)
        / nullif(sum(b.bottom_hardness_count), 0)
      )::real as avg_bottom_hardness,
      (
        sum(b.vegetation_height_sum)
        / nullif(sum(b.vegetation_height_count), 0)
      )::real as avg_vegetation_height_m,
      (
        sum(b.vendor_channel_a_sum)
        / nullif(sum(b.vendor_channel_a_count), 0)
      )::real as avg_vendor_channel_a,
      (
        sum(b.vendor_channel_b_sum)
        / nullif(sum(b.vendor_channel_b_count), 0)
      )::real as avg_vendor_channel_b
    from public.sonar_depth_cell_batches b
    where b.job_id = p_job_id
      and b.user_id = p_user_id
      and b.resolution_m = p_resolution_m
      and b.bucket = p_bucket
    group by b.grid_x, b.grid_y
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
  from aggregated a
  on conflict (user_id, job_id, resolution_m, grid_x, grid_y)
  do update set
    sample_count = excluded.sample_count,
    avg_depth_m = excluded.avg_depth_m,
    min_depth_m = excluded.min_depth_m,
    max_depth_m = excluded.max_depth_m,
    avg_bottom_hardness = excluded.avg_bottom_hardness,
    avg_vegetation_height_m = excluded.avg_vegetation_height_m,
    avg_vendor_channel_a = excluded.avg_vendor_channel_a,
    avg_vendor_channel_b = excluded.avg_vendor_channel_b,
    slope_deg = null,
    aspect_deg = null,
    hillshade = null,
    centroid = excluded.centroid,
    geometry = excluded.geometry;

  get diagnostics inserted_count = row_count;
  return inserted_count;
end
$$;

create or replace function public.sonar_finalize_depth_terrain_batch(
  p_job_id uuid,
  p_user_id uuid,
  p_resolution_m smallint,
  p_bucket smallint
)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  changed_count bigint;
begin
  if p_resolution_m not in (10, 25, 50, 100) then
    raise exception 'Unsupported depth-cell resolution';
  end if;
  if p_bucket not between 0 and 31 then
    raise exception 'Invalid depth-cell bucket';
  end if;

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
      and ((c.grid_x # c.grid_y) & 31) = p_bucket
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

  get diagnostics changed_count = row_count;
  return changed_count;
end
$$;

create or replace function public.sonar_clear_depth_cell_survey_batch(
  p_job_id uuid,
  p_user_id uuid,
  p_survey_id uuid,
  p_resolution_m smallint
)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  deleted_count bigint;
begin
  delete from public.sonar_depth_cell_batches
  where job_id = p_job_id
    and user_id = p_user_id
    and survey_id = p_survey_id
    and resolution_m = p_resolution_m;

  get diagnostics deleted_count = row_count;
  return deleted_count;
end
$$;

revoke all on function public.sonar_prepare_depth_cell_batches(
  uuid,
  uuid,
  smallint
) from public, anon, authenticated;
revoke all on function public.sonar_accumulate_depth_cells_survey(
  uuid,
  uuid,
  uuid,
  smallint
) from public, anon, authenticated;
revoke all on function public.sonar_finalize_depth_cells_batch(
  uuid,
  uuid,
  smallint,
  smallint
) from public, anon, authenticated;
revoke all on function public.sonar_finalize_depth_terrain_batch(
  uuid,
  uuid,
  smallint,
  smallint
) from public, anon, authenticated;
revoke all on function public.sonar_clear_depth_cell_survey_batch(
  uuid,
  uuid,
  uuid,
  smallint
) from public, anon, authenticated;

grant execute on function public.sonar_prepare_depth_cell_batches(
  uuid,
  uuid,
  smallint
) to service_role;
grant execute on function public.sonar_accumulate_depth_cells_survey(
  uuid,
  uuid,
  uuid,
  smallint
) to service_role;
grant execute on function public.sonar_finalize_depth_cells_batch(
  uuid,
  uuid,
  smallint,
  smallint
) to service_role;
grant execute on function public.sonar_finalize_depth_terrain_batch(
  uuid,
  uuid,
  smallint,
  smallint
) to service_role;
grant execute on function public.sonar_clear_depth_cell_survey_batch(
  uuid,
  uuid,
  uuid,
  smallint
) to service_role;
