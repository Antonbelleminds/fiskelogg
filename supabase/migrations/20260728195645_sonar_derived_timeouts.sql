-- The derived GIS functions only read one user's completed import and write
-- job-scoped result rows. Give those isolated operations enough time for
-- million-point datasets without changing the API-wide statement timeout.
alter function public.sonar_build_depth_cells(uuid, uuid, smallint)
  set statement_timeout = '5min';
alter function public.sonar_build_tracks(uuid, uuid)
  set statement_timeout = '5min';
alter function public.sonar_build_contours(uuid, uuid, real)
  set statement_timeout = '5min';
alter function public.sonar_match_catches(uuid, uuid)
  set statement_timeout = '5min';
