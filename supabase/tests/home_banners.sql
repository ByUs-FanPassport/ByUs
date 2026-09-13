-- Disposable local PostgreSQL integration contract. Every fixture is rolled back.
begin;

do $$
declare actor uuid:=extensions.gen_random_uuid(); allow_id uuid:=extensions.gen_random_uuid(); viewer uuid:=extensions.gen_random_uuid(); viewer_allow uuid:=extensions.gen_random_uuid(); inactive uuid:=extensions.gen_random_uuid(); inactive_allow uuid:=extensions.gen_random_uuid(); operator_id uuid:=extensions.gen_random_uuid(); operator_allow uuid:=extensions.gen_random_uuid(); creator uuid; template public.live_events; asset uuid:=extensions.gen_random_uuid(); i integer; live_id uuid;
begin
 insert into public.app_users(id,privy_user_id,verified_email,status) values
 (actor,'did:privy:home-banner-'||actor,'home-banner@example.invalid','active'),
 (viewer,'did:privy:home-banner-viewer-'||viewer,'home-banner-viewer@example.invalid','active'),
 (inactive,'did:privy:home-banner-inactive-'||inactive,'home-banner-inactive@example.invalid','active'),
 (operator_id,'did:privy:home-banner-operator-'||operator_id,'home-banner-operator@example.invalid','active');
 insert into public.admin_allowlist(id,email,role,active) values
 (allow_id,'home-banner@example.invalid','admin',true),(viewer_allow,'home-banner-viewer@example.invalid','viewer',true),
 (inactive_allow,'home-banner-inactive@example.invalid','admin',false),(operator_allow,'home-banner-operator@example.invalid','operator',true);
 select * into template from public.live_events where publication_status='published' limit 1;
 if template.id is null then raise exception 'home banner test requires seeded published LIVE fixture'; end if;
 creator:=template.celebrity_id;
 if not exists(select 1 from public.celebrity_localizations where celebrity_id=creator and locale='ko')
   or not exists(select 1 from public.celebrity_localizations where celebrity_id=creator and locale='en') then raise exception 'home banner test requires seeded celebrity localizations'; end if;
 insert into public.public_image_assets(id,content_sha256,storage_path,url,width,height,mime_type,byte_size,created_by_app_user_id,created_by_admin_allowlist_id)
 values(asset,repeat('a',64),'public-image-assets/'||repeat('a',64)||'.webp','https://example.invalid/storage/v1/object/public/cms-assets/public-image-assets/'||repeat('a',64)||'.webp',1440,640,'image/webp',100,actor,allow_id);
 for i in 1..4 loop
   live_id:=extensions.gen_random_uuid();
   insert into public.live_events(id,slug,celebrity_id,brand_id,publication_status,content_status,starts_at,ends_at,reservation_opens_at,reservation_closes_at,youtube_url,approved_hero_url,fan_code_hash,published_at)
   values(live_id,'home-banner-live-'||i||'-'||replace(live_id::text,'-',''),creator,template.brand_id,'published','scheduled',now()+(i||' days')::interval,now()+(i||' days')::interval+interval '1 hour',now()-interval '1 day',now()+(i||' days')::interval-interval '1 hour',template.youtube_url,template.approved_hero_url,template.fan_code_hash,now());
   insert into public.live_event_localizations(live_event_id,locale,title,summary,hero_alt)
   values(live_id,'ko','정기 라이브 '||i,'예정 라이브','라이브 이미지'),(live_id,'en','Regular live '||i,'Upcoming live','Live image');
 end loop;
 perform set_config('byus.home_banner.actor',actor::text,true); perform set_config('byus.home_banner.allow',allow_id::text,true);
 perform set_config('byus.home_banner.creator',creator::text,true); perform set_config('byus.home_banner.asset',asset::text,true);
 perform set_config('byus.home_banner.viewer',viewer::text,true); perform set_config('byus.home_banner.viewer_allow',viewer_allow::text,true);
 perform set_config('byus.home_banner.inactive',inactive::text,true); perform set_config('byus.home_banner.inactive_allow',inactive_allow::text,true);
 perform set_config('byus.home_banner.operator',operator_id::text,true); perform set_config('byus.home_banner.operator_allow',operator_allow::text,true);
end $$;

set local role service_role;

do $$
declare actor uuid:=current_setting('byus.home_banner.actor')::uuid; allow_id uuid:=current_setting('byus.home_banner.allow')::uuid; creator uuid:=current_setting('byus.home_banner.creator')::uuid; asset uuid:=current_setting('byus.home_banner.asset')::uuid;
  viewer uuid:=current_setting('byus.home_banner.viewer')::uuid; viewer_allow uuid:=current_setting('byus.home_banner.viewer_allow')::uuid;
  inactive uuid:=current_setting('byus.home_banner.inactive')::uuid; inactive_allow uuid:=current_setting('byus.home_banner.inactive_allow')::uuid;
  operator_id uuid:=current_setting('byus.home_banner.operator')::uuid; operator_allow uuid:=current_setting('byus.home_banner.operator_allow')::uuid;
  operator_draft jsonb; complete jsonb; second_copy jsonb; incomplete jsonb; draft jsonb; second jsonb; public_rows jsonb; manager jsonb; caught boolean; live_before integer;
begin
 if has_table_privilege('service_role','public.home_banners','SELECT') or has_table_privilege('service_role','public.home_banner_localizations','SELECT')
   or has_function_privilege('anon','public.read_published_home_banners(public.content_locale)','EXECUTE')
   or has_function_privilege('authenticated','public.read_published_home_banners(public.content_locale)','EXECUTE')
   or not has_function_privilege('service_role','public.read_published_home_banners(public.content_locale)','EXECUTE') then raise exception 'home banner privilege boundary failed'; end if;
 select count(*) into live_before from public.live_events where slug like 'home-banner-live-%';
 if live_before<>4 then raise exception 'four calendar LIVE fixtures missing'; end if;
 if (select count(*) from public.get_live_calendar_month(null,'ko',now(),now()+interval '10 days',now()) where slug like 'home-banner-live-%')<>4 then raise exception 'four LIVE fixtures absent from calendar RPC'; end if;

 complete:=jsonb_build_object('ko',jsonb_build_object('title','정기 방송','description','매주','ctaLabel','일정 보기','href','/calendar?view=month#live','alt','정기 방송 배너','desktopAssetId',asset,'mobileAssetId',null),
   'en',jsonb_build_object('title','Weekly live','description','Every week','ctaLabel','View schedule','href','https://www.youtube.com/@celebrity','alt','Weekly live banner','desktopAssetId',asset,'mobileAssetId',null));
 second_copy:=jsonb_set(jsonb_set(complete,'{ko,title}','"공지"'::jsonb),'{en,title}','"Announcement"'::jsonb);
 incomplete:=jsonb_build_object('ko',jsonb_build_object('title','','description','','ctaLabel','','href','','alt','','desktopAssetId',null,'mobileAssetId',null),
   'en',jsonb_build_object('title','','description','','ctaLabel','','href','','alt','','desktopAssetId',null,'mobileAssetId',null));
 caught:=false; begin perform public.save_admin_home_banner(actor,allow_id,pg_catalog.gen_random_uuid(),null,null,'announcement',null,incomplete); exception when others then if sqlerrm like '%revision conflict%' then caught:=true; else raise; end if; end;
 if not caught then raise exception 'NULL create revision bypassed'; end if;
 caught:=false; begin perform public.save_admin_home_banner(viewer,viewer_allow,pg_catalog.gen_random_uuid(),null,0,'announcement',null,incomplete); exception when others then if sqlerrm like '%read-only%' then caught:=true; else raise; end if; end;
 if not caught then raise exception 'viewer mutation accepted'; end if;
 caught:=false; begin perform public.get_admin_home_banner_manager(inactive,inactive_allow); exception when others then if sqlerrm like '%active admin required%' then caught:=true; else raise; end if; end;
 if not caught then raise exception 'inactive admin read accepted'; end if;
 operator_draft:=public.save_admin_home_banner(operator_id,operator_allow,pg_catalog.gen_random_uuid(),null,0,'announcement',null,incomplete);
 caught:=false; begin perform public.set_admin_home_banner_publication(operator_id,operator_allow,pg_catalog.gen_random_uuid(),(operator_draft->>'id')::uuid,1,'published'); exception when others then if sqlerrm like '%publication incomplete%' then caught:=true; else raise; end if; end;
 if not caught then raise exception 'incomplete KO/EN publication accepted'; end if;
  draft:=public.save_admin_home_banner(actor,allow_id,pg_catalog.gen_random_uuid(),null,0,'regular_live',creator,complete);
 if (draft->>'revision')::integer<>1 then raise exception 'create revision failed'; end if;
 perform public.set_admin_home_banner_publication(actor,allow_id,pg_catalog.gen_random_uuid(),(draft->>'id')::uuid,1,'published');
 public_rows:=public.read_published_home_banners('ko');
 if jsonb_array_length(public_rows)<>1 or public_rows->0->>'title'<>'정기 방송' or public_rows->0->'mobileImage'<>'null'::jsonb then raise exception 'localized public projection failed'; end if;
 if (select count(*) from public.live_events where slug like 'home-banner-live-%')<>4 then raise exception 'banner publication changed LIVE calendar rows'; end if;
 caught:=false; begin perform public.save_admin_home_banner(actor,allow_id,pg_catalog.gen_random_uuid(),(draft->>'id')::uuid,2,'regular_live',creator,incomplete); exception when others then if sqlerrm like '%publication incomplete%' then caught:=true; else raise; end if; end;
 if not caught or (select (value->>'revision')::integer from jsonb_array_elements(public.get_admin_home_banner_manager(actor,allow_id)->'items') where value->>'id'=draft->>'id')<>2 or jsonb_array_length(public.read_published_home_banners('ko'))<>1 then raise exception 'published incomplete save was not rolled back'; end if;

 second:=public.save_admin_home_banner(actor,allow_id,pg_catalog.gen_random_uuid(),null,0,'regular_live',creator,complete);
 caught:=false; begin perform public.set_admin_home_banner_publication(actor,allow_id,pg_catalog.gen_random_uuid(),(second->>'id')::uuid,1,'published'); exception when unique_violation then caught:=true; end;
 if not caught then raise exception 'duplicate published regular LIVE banner allowed'; end if;
 second:=public.save_admin_home_banner(actor,allow_id,pg_catalog.gen_random_uuid(),(second->>'id')::uuid,1,'announcement',null,second_copy);
 perform public.set_admin_home_banner_publication(actor,allow_id,pg_catalog.gen_random_uuid(),(second->>'id')::uuid,2,'published');
 public_rows:=public.read_published_home_banners('en');
 if jsonb_array_length(public_rows)<>2 or public_rows->0->>'id'<>draft->>'id' or public_rows->0->>'title'<>'Weekly live' or public_rows->1->>'title'<>'Announcement' or public_rows->0->>'href'<>'https://www.youtube.com/@celebrity' then raise exception 'English locale or public ordering failed'; end if;

 caught:=false; begin perform public.save_admin_home_banner(actor,allow_id,pg_catalog.gen_random_uuid(),(draft->>'id')::uuid,1,'regular_live',creator,complete); exception when others then if sqlerrm like '%revision conflict%' then caught:=true; else raise; end if; end;
 if not caught then raise exception 'stale revision accepted'; end if;

 caught:=false; begin perform public.save_admin_home_banner(actor,allow_id,pg_catalog.gen_random_uuid(),null,0,'announcement',null,jsonb_set(complete,'{ko,desktopAssetId}',to_jsonb(pg_catalog.gen_random_uuid()))); exception when foreign_key_violation then caught:=true; end;
 if not caught then raise exception 'raw missing asset FK accepted'; end if;
 caught:=false; begin perform public.save_admin_home_banner(actor,allow_id,pg_catalog.gen_random_uuid(),null,0,'announcement',null,jsonb_set(complete,'{en,href}','"https://user:pass@example.com/watch"'::jsonb)); exception when check_violation then caught:=true; end;
 if not caught then raise exception 'HTTPS authority credentials accepted'; end if;

 perform public.set_admin_home_banner_publication(actor,allow_id,pg_catalog.gen_random_uuid(),(draft->>'id')::uuid,2,'draft');
 if jsonb_array_length(public.read_published_home_banners('ko'))<>1 or public.read_published_home_banners('ko')->0->>'id'<>second->>'id' then raise exception 'unpublished banner leaked or published peer disappeared'; end if;
 manager:=public.get_admin_home_banner_manager(actor,allow_id);
 if jsonb_array_length(manager->'items')<>3 or jsonb_array_length(manager->'celebrities')<1 then raise exception 'manager projection incomplete'; end if;

 caught:=false; begin perform public.reorder_admin_home_banners(actor,allow_id,pg_catalog.gen_random_uuid(),jsonb_build_array(jsonb_build_object('id',draft->>'id','expectedRevision',3))); exception when others then if sqlerrm like '%full reorder%' then caught:=true; else raise; end if; end;
 if not caught then raise exception 'partial reorder accepted'; end if;
 perform public.reorder_admin_home_banners(actor,allow_id,pg_catalog.gen_random_uuid(),jsonb_build_array(
   jsonb_build_object('id',second->>'id','expectedRevision',3),jsonb_build_object('id',draft->>'id','expectedRevision',3),
   jsonb_build_object('id',operator_draft->>'id','expectedRevision',1)));
 manager:=public.get_admin_home_banner_manager(actor,allow_id);
 if manager->'items'->0->>'id'<>second->>'id' then raise exception 'atomic ordering failed'; end if;
 if (select count(*) from public.audit_logs where entity_type='home_banner')<5 then raise exception 'home banner audit missing'; end if;
end $$;

rollback;
