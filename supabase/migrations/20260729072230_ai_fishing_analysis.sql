-- Cached, private AI analyses. The browser never reads this table directly;
-- authenticated API routes use the service role after verifying the user.
create table public.ai_fishing_analyses (
  user_id uuid primary key references auth.users(id) on delete cascade,
  source_hash text not null check (source_hash ~ '^[0-9a-f]{64}$'),
  model text not null,
  analysis jsonb not null check (jsonb_typeof(analysis) = 'object'),
  input_summary jsonb not null check (jsonb_typeof(input_summary) = 'object'),
  generated_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.ai_fishing_analyses enable row level security;
alter table public.ai_fishing_analyses force row level security;

revoke all on table public.ai_fishing_analyses
from public, anon, authenticated;

grant select, insert, update, delete on table public.ai_fishing_analyses
to service_role;

-- Aggregate the million-point sonar data inside Postgres. Only the service-role
-- API route may execute this function, and the caller supplies the already
-- authenticated user's id.
create or replace function public.sonar_ai_analysis_context(p_user_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with survey_summary as (
    select
      count(*)::integer as survey_count,
      coalesce(sum(s.point_count), 0)::bigint as point_count,
      min(s.started_at) as first_survey_at,
      max(s.ended_at) as last_survey_at,
      min(s.min_depth_m)::real as min_depth_m,
      max(s.max_depth_m)::real as max_depth_m
    from public.sonar_surveys s
    join public.sonar_import_jobs j on j.id = s.job_id
    where s.user_id = p_user_id
      and s.point_count > 0
      and j.status in ('completed', 'completed_with_errors')
  ),
  cell_summary as (
    select
      count(*)::bigint as cell_count,
      coalesce(sum(c.sample_count), 0)::bigint as sample_count,
      (
        sum(c.avg_depth_m::double precision * c.sample_count)
        / nullif(sum(c.sample_count), 0)
      )::real as avg_depth_m,
      min(c.min_depth_m)::real as min_depth_m,
      max(c.max_depth_m)::real as max_depth_m,
      coalesce(sum(c.sample_count) filter (where c.avg_depth_m < 2), 0)::bigint as depth_0_2,
      coalesce(sum(c.sample_count) filter (where c.avg_depth_m >= 2 and c.avg_depth_m < 5), 0)::bigint as depth_2_5,
      coalesce(sum(c.sample_count) filter (where c.avg_depth_m >= 5 and c.avg_depth_m < 10), 0)::bigint as depth_5_10,
      coalesce(sum(c.sample_count) filter (where c.avg_depth_m >= 10 and c.avg_depth_m < 20), 0)::bigint as depth_10_20,
      coalesce(sum(c.sample_count) filter (where c.avg_depth_m >= 20), 0)::bigint as depth_20_plus,
      coalesce(sum(c.sample_count) filter (where coalesce(c.slope_deg, 0) < 5), 0)::bigint as slope_flat,
      coalesce(sum(c.sample_count) filter (where c.slope_deg >= 5 and c.slope_deg < 15), 0)::bigint as slope_edge,
      coalesce(sum(c.sample_count) filter (where c.slope_deg >= 15), 0)::bigint as slope_steep,
      coalesce(sum(c.sample_count) filter (where c.avg_vendor_channel_a < 4.5), 0)::bigint as hardness_low,
      coalesce(sum(c.sample_count) filter (where c.avg_vendor_channel_a >= 4.5 and c.avg_vendor_channel_a < 9.7), 0)::bigint as hardness_medium,
      coalesce(sum(c.sample_count) filter (where c.avg_vendor_channel_a >= 9.7), 0)::bigint as hardness_high,
      coalesce(sum(c.sample_count) filter (where c.avg_vendor_channel_a is not null), 0)::bigint as hardness_samples,
      coalesce(sum(c.sample_count) filter (where c.avg_vendor_channel_b < 0.5), 0)::bigint as vegetation_low,
      coalesce(sum(c.sample_count) filter (where c.avg_vendor_channel_b >= 0.5 and c.avg_vendor_channel_b < 1.7), 0)::bigint as vegetation_medium,
      coalesce(sum(c.sample_count) filter (where c.avg_vendor_channel_b >= 1.7), 0)::bigint as vegetation_high,
      coalesce(sum(c.sample_count) filter (where c.avg_vendor_channel_b is not null), 0)::bigint as vegetation_samples
    from public.sonar_depth_cells c
    join public.sonar_import_jobs j on j.id = c.job_id
    where c.user_id = p_user_id
      and c.resolution_m = 10
      and j.status in ('completed', 'completed_with_errors')
  ),
  match_summary as (
    select
      count(*)::integer as matched_catches,
      avg(e.depth_m)::real as avg_catch_depth_m,
      min(e.depth_m)::real as min_catch_depth_m,
      max(e.depth_m)::real as max_catch_depth_m,
      avg(e.slope_deg)::real as avg_catch_slope_deg,
      avg(e.bottom_hardness)::real as avg_catch_bottom_hardness,
      avg(e.water_temp_c)::real as avg_catch_water_temp_c,
      avg(e.match_distance_m)::real as avg_match_distance_m
    from public.catch_sonar_enrichments e
    where e.user_id = p_user_id
  )
  select jsonb_build_object(
    'surveyCount', s.survey_count,
    'pointCount', s.point_count,
    'firstSurveyAt', s.first_survey_at,
    'lastSurveyAt', s.last_survey_at,
    'minDepthM', coalesce(c.min_depth_m, s.min_depth_m),
    'maxDepthM', coalesce(c.max_depth_m, s.max_depth_m),
    'cellCount', c.cell_count,
    'sampleCount', c.sample_count,
    'avgDepthM', c.avg_depth_m,
    'depthBands', jsonb_build_array(
      jsonb_build_object('label', '0–2 m', 'samples', c.depth_0_2),
      jsonb_build_object('label', '2–5 m', 'samples', c.depth_2_5),
      jsonb_build_object('label', '5–10 m', 'samples', c.depth_5_10),
      jsonb_build_object('label', '10–20 m', 'samples', c.depth_10_20),
      jsonb_build_object('label', '20+ m', 'samples', c.depth_20_plus)
    ),
    'slopeBands', jsonb_build_array(
      jsonb_build_object('label', 'Flackt (<5°)', 'samples', c.slope_flat),
      jsonb_build_object('label', 'Djupkant (5–15°)', 'samples', c.slope_edge),
      jsonb_build_object('label', 'Brant (15°+)', 'samples', c.slope_steep)
    ),
    'hardnessBands', jsonb_build_array(
      jsonb_build_object('label', 'Mjuk signal', 'samples', c.hardness_low),
      jsonb_build_object('label', 'Mellan', 'samples', c.hardness_medium),
      jsonb_build_object('label', 'Hård signal', 'samples', c.hardness_high)
    ),
    'hardnessSamples', c.hardness_samples,
    'vegetationBands', jsonb_build_array(
      jsonb_build_object('label', 'Låg signal', 'samples', c.vegetation_low),
      jsonb_build_object('label', 'Mellan', 'samples', c.vegetation_medium),
      jsonb_build_object('label', 'Tät signal', 'samples', c.vegetation_high)
    ),
    'vegetationSamples', c.vegetation_samples,
    'matchedCatches', m.matched_catches,
    'matchedCatchDepth', jsonb_build_object(
      'averageM', m.avg_catch_depth_m,
      'minM', m.min_catch_depth_m,
      'maxM', m.max_catch_depth_m
    ),
    'avgCatchSlopeDeg', m.avg_catch_slope_deg,
    'avgCatchBottomHardness', m.avg_catch_bottom_hardness,
    'avgCatchWaterTempC', m.avg_catch_water_temp_c,
    'avgMatchDistanceM', m.avg_match_distance_m
  )
  from survey_summary s
  cross join cell_summary c
  cross join match_summary m;
$$;

revoke all on function public.sonar_ai_analysis_context(uuid)
from public, anon, authenticated;

grant execute on function public.sonar_ai_analysis_context(uuid)
to service_role;
