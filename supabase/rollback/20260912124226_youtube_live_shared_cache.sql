drop function if exists public.youtube_finish_live_api(text,uuid,jsonb);
drop function if exists public.youtube_claim_live_api(text,text);
drop table if exists public.youtube_live_api_attempts;
drop table if exists public.youtube_live_api_cache;
