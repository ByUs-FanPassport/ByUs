-- ADM-003/004 atomic Celebrity and versioned Quiz CMS commands.

alter table public.celebrities
  add column display_order integer not null default 0 check (display_order >= 0);

alter table public.celebrity_quizzes
  add column ever_published_at timestamptz,
  add column retired_at timestamptz;

create index celebrities_admin_order_idx
  on public.celebrities (archived_at nulls first, display_order, created_at desc);

create function public.require_content_editor(p_actor uuid, p_mutation boolean default false)
returns public.admin_allowlist
language plpgsql security definer set search_path = '' as $$
declare actor public.admin_allowlist%rowtype;
begin
  select * into actor from public.admin_allowlist a
  where a.id = p_actor and a.active
    and (not p_mutation or a.role in ('admin','operator'))
  for update;
  if not found then raise exception 'active authorized content administrator required'; end if;
  return actor;
end $$;

create function public.read_admin_celebrity_cms(p_actor uuid, p_celebrity uuid default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_content_editor(p_actor, false);
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id', c.id, 'slug', c.slug, 'status', c.status, 'imageUrl', c.image_url,
    'imagePosition', c.image_position, 'displayOrder', c.display_order,
    'publishedAt', c.published_at, 'archivedAt', c.archived_at,
    'archiveReason', c.archive_reason, 'updatedAt', c.updated_at,
    'localizations', (select jsonb_object_agg(l.locale, jsonb_build_object('name',l.name,'summary',l.summary,'imageAlt',l.image_alt)) from public.celebrity_localizations l where l.celebrity_id=c.id),
    'themes', coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'slug',t.slug,'nameKo',ko.name,'nameEn',en.name,'position',ct.position) order by ct.position) from public.celebrity_themes ct join public.themes t on t.id=ct.theme_id left join public.theme_localizations ko on ko.theme_id=t.id and ko.locale='ko' left join public.theme_localizations en on en.theme_id=t.id and en.locale='en' where ct.celebrity_id=c.id),'[]'::jsonb),
    'socialLinks', coalesce((select jsonb_agg(jsonb_build_object('platform',s.platform,'url',s.url,'position',s.position,'active',s.active) order by s.position) from public.celebrity_social_links s where s.celebrity_id=c.id),'[]'::jsonb)
  ) order by c.display_order,c.created_at desc) from public.celebrities c where p_celebrity is null or c.id=p_celebrity),'[]'::jsonb);
end $$;

create function public.save_admin_celebrity(
  p_actor uuid, p_correlation uuid, p_celebrity uuid, p_payload jsonb
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare target uuid := coalesce(p_celebrity, extensions.gen_random_uuid()); before_row jsonb; result jsonb; theme_item jsonb; social_item jsonb; theme_id uuid;
begin
  perform public.require_content_editor(p_actor,true);
  if p_correlation is null then raise exception 'correlation id is required'; end if;
  if p_celebrity is not null then
    perform 1 from public.celebrities c where id=p_celebrity and archived_at is null for update;
    if not found then raise exception 'content not found'; end if;
    before_row := public.read_admin_celebrity_cms(p_actor,p_celebrity)->0;
  end if;
  if coalesce(p_payload->>'slug','') !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then raise exception 'invalid celebrity slug'; end if;
  if p_celebrity is null then
    insert into public.celebrities(id,slug,image_url,image_position,display_order) values(target,p_payload->>'slug',p_payload->>'imageUrl',coalesce(nullif(p_payload->>'imagePosition',''),'center'),coalesce((p_payload->>'displayOrder')::int,0));
  else
    update public.celebrities set slug=p_payload->>'slug',image_url=p_payload->>'imageUrl',image_position=coalesce(nullif(p_payload->>'imagePosition',''),'center'),display_order=coalesce((p_payload->>'displayOrder')::int,0) where id=target;
  end if;
  insert into public.celebrity_localizations(celebrity_id,locale,name,summary,image_alt)
  select target, x.locale::public.content_locale, x.value->>'name',x.value->>'summary',x.value->>'imageAlt' from jsonb_each(p_payload->'localizations') x(locale,value)
  on conflict(celebrity_id,locale) do update set name=excluded.name,summary=excluded.summary,image_alt=excluded.image_alt;
  delete from public.celebrity_social_links where celebrity_id=target;
  for social_item in select value from jsonb_array_elements(coalesce(p_payload->'socialLinks','[]')) loop
    insert into public.celebrity_social_links(celebrity_id,platform,url,position,active) values(target,(social_item->>'platform')::public.social_platform,social_item->>'url',(social_item->>'position')::smallint,coalesce((social_item->>'active')::boolean,true));
  end loop;
  delete from public.celebrity_themes where celebrity_id=target;
  for theme_item in select value from jsonb_array_elements(coalesce(p_payload->'themes','[]')) loop
    select id into theme_id from public.themes where slug=theme_item->>'slug' for update;
    if theme_id is null then
      insert into public.themes(slug) values(theme_item->>'slug') returning id into theme_id;
      insert into public.theme_localizations(theme_id,locale,name) values(theme_id,'ko',theme_item->>'nameKo'),(theme_id,'en',theme_item->>'nameEn');
      update public.themes set status='published' where id=theme_id;
    else
      insert into public.theme_localizations(theme_id,locale,name) values(theme_id,'ko',theme_item->>'nameKo'),(theme_id,'en',theme_item->>'nameEn')
      on conflict(theme_id,locale) do update set name=excluded.name;
      if exists(select 1 from public.themes where id=theme_id and status='draft') then update public.themes set status='published' where id=theme_id; end if;
    end if;
    insert into public.celebrity_themes(celebrity_id,theme_id,position) values(target,theme_id,(theme_item->>'position')::smallint);
  end loop;
  select (public.read_admin_celebrity_cms(p_actor,target)->0) into result;
  insert into public.audit_logs(actor_admin_allowlist_id,action,entity_type,entity_id,before_after_summary,correlation_id)
  values(p_actor,case when p_celebrity is null then 'celebrity.created' else 'celebrity.updated' end,'celebrity',target::text,jsonb_build_object('before',before_row,'after',result),p_correlation);
  return result;
end $$;

create function public.set_admin_celebrity_publication(p_actor uuid,p_correlation uuid,p_celebrity uuid,p_publish boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare before_row jsonb; result jsonb;
begin
  perform public.require_content_editor(p_actor,true);
  perform 1 from public.celebrities c where id=p_celebrity and archived_at is null for update;
  before_row := public.read_admin_celebrity_cms(p_actor,p_celebrity)->0;
  if before_row is null then raise exception 'content not found'; end if;
  if p_publish then
    if (select count(*) from public.celebrity_quizzes q where q.celebrity_id=p_celebrity and q.status='published') <> 1 then raise exception 'celebrity publication requires exactly one published quiz'; end if;
    if exists(select 1 from public.celebrity_quizzes q where q.celebrity_id=p_celebrity and q.status='published' and ((select count(*) from public.celebrity_quiz_questions x where x.quiz_id=q.id and x.active)<3 or exists(select 1 from public.celebrity_quiz_questions x where x.quiz_id=q.id and x.active and ((select count(*) from public.celebrity_quiz_options o where o.question_id=x.id and o.active)<>4 or (select count(*) from public.celebrity_quiz_options o where o.question_id=x.id and o.active and o.is_correct)<>1)))) then raise exception 'celebrity publication requires a complete published quiz'; end if;
  end if;
  update public.celebrities set status=case when p_publish then 'published'::public.content_status else 'draft'::public.content_status end where id=p_celebrity;
  select (public.read_admin_celebrity_cms(p_actor,p_celebrity)->0) into result;
  insert into public.audit_logs(actor_admin_allowlist_id,action,entity_type,entity_id,before_after_summary,correlation_id) values(p_actor,case when p_publish then 'celebrity.published' else 'celebrity.unpublished' end,'celebrity',p_celebrity::text,jsonb_build_object('before',before_row,'after',result),p_correlation);
  return result;
end $$;

create function public.read_admin_quiz_cms(p_actor uuid,p_celebrity uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform public.require_content_editor(p_actor,false);
 return coalesce((select jsonb_agg(jsonb_build_object('id',q.id,'version',q.version,'status',q.status,'publishedAt',q.published_at,'everPublishedAt',q.ever_published_at,'retiredAt',q.retired_at,'updatedAt',q.updated_at,'questions',coalesce((select jsonb_agg(jsonb_build_object('id',z.id,'position',z.position,'promptKo',z.prompt_ko,'promptEn',z.prompt_en,'active',z.active,'options',coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'position',o.position,'labelKo',o.label_ko,'labelEn',o.label_en,'isCorrect',o.is_correct,'active',o.active) order by o.position) from public.celebrity_quiz_options o where o.question_id=z.id),'[]'::jsonb)) order by z.position) from public.celebrity_quiz_questions z where z.quiz_id=q.id),'[]'::jsonb)) order by q.version desc) from public.celebrity_quizzes q where q.celebrity_id=p_celebrity),'[]'::jsonb);
end $$;

create function public.save_admin_quiz_version(p_actor uuid,p_correlation uuid,p_celebrity uuid,p_quiz uuid,p_questions jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare target uuid:=p_quiz; question jsonb; option_item jsonb; question_id uuid; result jsonb; before_row jsonb;
begin
 perform public.require_content_editor(p_actor,true);
 perform 1 from public.celebrities where id=p_celebrity and archived_at is null for update;
 if not found then raise exception 'content not found'; end if;
 if target is null then insert into public.celebrity_quizzes(celebrity_id,version) select p_celebrity,coalesce(max(version),0)+1 from public.celebrity_quizzes where celebrity_id=p_celebrity returning id into target;
 else if not exists(select 1 from public.celebrity_quizzes where id=target and celebrity_id=p_celebrity and status='draft' for update) then raise exception 'only draft quiz versions can be edited'; end if; before_row:=public.read_admin_quiz_cms(p_actor,p_celebrity); delete from public.celebrity_quiz_questions where quiz_id=target; end if;
 for question in select value from jsonb_array_elements(p_questions) loop
   insert into public.celebrity_quiz_questions(quiz_id,position,prompt_ko,prompt_en,active) values(target,(question->>'position')::smallint,question->>'promptKo',question->>'promptEn',coalesce((question->>'active')::boolean,true)) returning id into question_id;
   if jsonb_array_length(question->'options') <> 4 then raise exception 'each quiz question requires exactly four options'; end if;
   for option_item in select value from jsonb_array_elements(question->'options') loop insert into public.celebrity_quiz_options(question_id,position,label_ko,label_en,is_correct,active) values(question_id,(option_item->>'position')::smallint,option_item->>'labelKo',option_item->>'labelEn',(option_item->>'isCorrect')::boolean,(option_item->>'active')::boolean); end loop;
 end loop;
 result:=public.read_admin_quiz_cms(p_actor,p_celebrity);
 insert into public.audit_logs(actor_admin_allowlist_id,action,entity_type,entity_id,before_after_summary,correlation_id) values(p_actor,'quiz.version.saved','celebrity_quiz',target::text,jsonb_build_object('before',before_row,'after',result),p_correlation);
 return result;
end $$;

create function public.clone_admin_quiz_version(p_actor uuid,p_correlation uuid,p_celebrity uuid,p_quiz uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare source public.celebrity_quizzes%rowtype; target uuid; q record; new_q uuid; before_row jsonb; after_row jsonb;
begin
 perform public.require_content_editor(p_actor,true); select * into source from public.celebrity_quizzes where id=p_quiz and celebrity_id=p_celebrity; if not found then raise exception 'quiz not found'; end if; perform 1 from public.celebrities where id=p_celebrity for update; select * into source from public.celebrity_quizzes where id=p_quiz and celebrity_id=p_celebrity for update; before_row:=public.read_admin_quiz_cms(p_actor,p_celebrity);
 insert into public.celebrity_quizzes(celebrity_id,version) select source.celebrity_id,max(version)+1 from public.celebrity_quizzes where celebrity_id=source.celebrity_id returning id into target;
 for q in select * from public.celebrity_quiz_questions where quiz_id=p_quiz order by position loop insert into public.celebrity_quiz_questions(quiz_id,position,prompt_ko,prompt_en,active) values(target,q.position,q.prompt_ko,q.prompt_en,q.active) returning id into new_q; insert into public.celebrity_quiz_options(question_id,position,label_ko,label_en,is_correct,active) select new_q,position,label_ko,label_en,is_correct,active from public.celebrity_quiz_options where question_id=q.id; end loop;
 after_row:=public.read_admin_quiz_cms(p_actor,source.celebrity_id);
 insert into public.audit_logs(actor_admin_allowlist_id,action,entity_type,entity_id,before_after_summary,correlation_id) values(p_actor,'quiz.version.cloned','celebrity_quiz',target::text,jsonb_build_object('before',before_row,'after',after_row,'sourceQuizId',p_quiz),p_correlation);
 return after_row;
end $$;

create function public.publish_admin_quiz_version(p_actor uuid,p_correlation uuid,p_celebrity uuid,p_quiz uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare target public.celebrity_quizzes%rowtype; before_row jsonb; after_row jsonb;
begin
 perform public.require_content_editor(p_actor,true); select * into target from public.celebrity_quizzes where id=p_quiz and celebrity_id=p_celebrity and status='draft' and ever_published_at is null; if not found then raise exception 'draft quiz not found'; end if; perform 1 from public.celebrities where id=p_celebrity for update; select * into target from public.celebrity_quizzes where id=p_quiz and celebrity_id=p_celebrity and status='draft' and ever_published_at is null for update; if not found then raise exception 'draft quiz not found'; end if; before_row:=public.read_admin_quiz_cms(p_actor,p_celebrity);
 if (select count(*) from public.celebrity_quiz_questions where quiz_id=p_quiz and active)<3 then raise exception 'published quiz requires at least three active questions'; end if;
 if exists(select 1 from public.celebrity_quiz_questions q where q.quiz_id=p_quiz and q.active and ((select count(*) from public.celebrity_quiz_options o where o.question_id=q.id and o.active)<>4 or (select count(*) from public.celebrity_quiz_options o where o.question_id=q.id and o.active and o.is_correct)<>1)) then raise exception 'active questions require exactly four options and one correct answer'; end if;
 update public.celebrity_quizzes set status='draft' where celebrity_id=target.celebrity_id and status='published';
 update public.celebrity_quizzes set status='published' where id=p_quiz;
 after_row:=public.read_admin_quiz_cms(p_actor,target.celebrity_id);
 insert into public.audit_logs(actor_admin_allowlist_id,action,entity_type,entity_id,before_after_summary,correlation_id) values(p_actor,'quiz.version.published','celebrity_quiz',p_quiz::text,jsonb_build_object('before',before_row,'after',after_row,'version',target.version),p_correlation);
 return after_row;
end $$;

revoke all on function public.require_content_editor(uuid,boolean), public.read_admin_celebrity_cms(uuid,uuid), public.save_admin_celebrity(uuid,uuid,uuid,jsonb), public.set_admin_celebrity_publication(uuid,uuid,uuid,boolean), public.read_admin_quiz_cms(uuid,uuid), public.save_admin_quiz_version(uuid,uuid,uuid,uuid,jsonb), public.clone_admin_quiz_version(uuid,uuid,uuid,uuid), public.publish_admin_quiz_version(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.read_admin_celebrity_cms(uuid,uuid), public.save_admin_celebrity(uuid,uuid,uuid,jsonb), public.set_admin_celebrity_publication(uuid,uuid,uuid,boolean), public.read_admin_quiz_cms(uuid,uuid), public.save_admin_quiz_version(uuid,uuid,uuid,uuid,jsonb), public.clone_admin_quiz_version(uuid,uuid,uuid,uuid), public.publish_admin_quiz_version(uuid,uuid,uuid,uuid) to service_role;

-- Publication state may be withdrawn or superseded, but the published version's
-- bank remains immutable. Attempts keep their own immutable snapshots.
create or replace function public.enforce_published_quiz_immutability()
returns trigger language plpgsql set search_path='' as $$
declare old_parent_status public.content_status; new_parent_status public.content_status;
begin
  if tg_table_name='celebrity_quizzes' then
    if old.ever_published_at is not null and not (
      tg_op='UPDATE' and old.status='published' and new.status='draft'
      and new.id=old.id and new.celebrity_id=old.celebrity_id and new.version=old.version
      and new.created_at=old.created_at and new.ever_published_at=old.ever_published_at
      and new.retired_at is not distinct from old.retired_at
    ) then raise exception 'published quiz versions are immutable; create a new version'; end if;
  elsif tg_table_name='celebrity_quiz_questions' then
    if tg_op<>'INSERT' then select status into old_parent_status from public.celebrity_quizzes where id=old.quiz_id; end if;
    if tg_op<>'DELETE' then select status into new_parent_status from public.celebrity_quizzes where id=new.quiz_id; end if;
    if exists(select 1 from public.celebrity_quizzes where id=coalesce(old.quiz_id,new.quiz_id) and ever_published_at is not null) or old_parent_status='published' or new_parent_status='published' then raise exception 'published quiz versions are immutable; create a new version'; end if;
  else
    if tg_op<>'INSERT' then select quiz.status into old_parent_status from public.celebrity_quiz_questions question join public.celebrity_quizzes quiz on quiz.id=question.quiz_id where question.id=old.question_id; end if;
    if tg_op<>'DELETE' then select quiz.status into new_parent_status from public.celebrity_quiz_questions question join public.celebrity_quizzes quiz on quiz.id=question.quiz_id where question.id=new.question_id; end if;
    if exists(select 1 from public.celebrity_quiz_questions question join public.celebrity_quizzes quiz on quiz.id=question.quiz_id where question.id in (case when tg_op<>'INSERT' then old.question_id end,case when tg_op<>'DELETE' then new.question_id end) and quiz.ever_published_at is not null) or old_parent_status='published' or new_parent_status='published' then raise exception 'published quiz versions are immutable; create a new version'; end if;
  end if;
  if tg_op='DELETE' then return old; end if; return new;
end $$;

create or replace function public.prepare_quiz_publication()
returns trigger language plpgsql set search_path='' as $$
begin
 if new.status='published' and old.status='draft' then new.published_at:=now(); new.ever_published_at:=coalesce(old.ever_published_at,now()); new.retired_at:=null;
 elsif new.status='draft' then new.published_at:=null; if old.status='published' then new.retired_at:=now(); end if; end if;
 return new;
end $$;

update public.celebrity_quizzes
set ever_published_at=published_at
where published_at is not null and ever_published_at is null;
