-- Match the observation input contract: missing metadata remains unknown, while
-- verified evidence still requires an official URL and the original text.
alter table public.recurring_live_observations
  alter column source_url drop not null,
  alter column source_account drop not null,
  alter column original_text drop not null,
  alter column evidence_path drop not null,
  drop constraint recurring_live_observations_source_url_check;

alter table public.recurring_live_observations
  add constraint recurring_live_observations_source_url_check check (
    source_url is null or (
      source_url=pg_catalog.btrim(source_url) and length(source_url) between 8 and 2048
      and source_url ~ '^https://(?:www\.)?(?:youtube\.com|youtu\.be|instagram\.com|tiktok\.com|chzzk\.naver\.com)/[^[:space:]#]+$'
      and source_url !~ '[\\[:cntrl:]]'
    )
  ),
  add constraint recurring_live_observations_verified_evidence check (
    verification<>'verified' or (source_url is not null and original_text is not null)
  );
