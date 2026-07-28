create or replace function public.sonar_enrich_motion_survey(
  p_job_id uuid,
  p_user_id uuid,
  p_survey_id uuid
)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  changed_count bigint;
begin
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
      p_job_id::text || ':motion:' || p_survey_id::text,
      0
    )
  );

  with ordered as (
    select
      p.user_id,
      p.id,
      p.position,
      p.observed_at,
      lag(p.position) over (
        order by p.observed_at, p.record_index
      ) as previous_position,
      lag(p.observed_at) over (
        order by p.observed_at, p.record_index
      ) as previous_at
    from public.sonar_survey_points p
    where p.job_id = p_job_id
      and p.user_id = p_user_id
      and p.survey_id = p_survey_id
  ),
  motion as (
    select
      o.user_id,
      o.id,
      extract(epoch from (o.observed_at - o.previous_at)) as seconds_delta,
      st_distance(
        o.previous_position::geography,
        o.position::geography
      ) as distance_delta,
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

revoke all on function public.sonar_enrich_motion_survey(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.sonar_enrich_motion_survey(uuid, uuid, uuid)
  to service_role;
