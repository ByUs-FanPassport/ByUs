\set ON_ERROR_STOP on

create function pg_temp.cms_questions(p_fourth_active boolean default true)
returns jsonb language sql immutable as $$
  select jsonb_agg(jsonb_build_object(
    'position', q, 'promptKo', '질문 '||q, 'promptEn', 'Question '||q, 'active', true,
    'options', (select jsonb_agg(jsonb_build_object(
      'position', o, 'labelKo', '보기 '||o, 'labelEn', 'Option '||o,
      'isCorrect', o=1, 'active', case when o=4 then p_fourth_active else true end
    ) order by o) from generate_series(1,4) o)
  ) order by q) from generate_series(1,3) q
$$;

do $$
declare
  actor uuid := '83000000-0000-4000-8000-000000000001';
  celebrity_a uuid := '83000000-0000-4000-8000-000000000002';
  celebrity_b uuid := '83000000-0000-4000-8000-000000000003';
  correlation uuid := '83000000-0000-4000-8000-000000000004';
  quiz_v1 uuid; quiz_v2 uuid; quiz_v3 uuid; old_question uuid;
  rejected boolean;
begin
  insert into public.admin_allowlist(id,email,role,active) values(actor,'cms-verifier@byus.dev','admin',true);
  insert into public.celebrities(id,slug,image_url) values
    (celebrity_a,'cms-proof-a','/proof-a.jpg'),(celebrity_b,'cms-proof-b','/proof-b.jpg');
  insert into public.celebrity_localizations(celebrity_id,locale,name,summary,image_alt) values
    (celebrity_a,'ko','검증 A','검증 소개','검증 A'),(celebrity_a,'en','Proof A','Proof summary','Proof A'),
    (celebrity_b,'ko','검증 B','검증 소개','검증 B'),(celebrity_b,'en','Proof B','Proof summary','Proof B');

  rejected:=false;
  begin perform public.set_admin_celebrity_publication(actor,correlation,celebrity_a,true);
  exception when others then rejected:=sqlerrm like '%exactly one published quiz%'; end;
  if not rejected then raise exception 'celebrity without quiz was not rejected'; end if;

  perform public.save_admin_quiz_version(actor,correlation,celebrity_a,null,pg_temp.cms_questions(false));
  select id into quiz_v1 from public.celebrity_quizzes where celebrity_id=celebrity_a and version=1;
  if not exists(select 1 from public.celebrity_quiz_options o join public.celebrity_quiz_questions q on q.id=o.question_id where q.quiz_id=quiz_v1 and o.position=4 and not o.active) then raise exception 'option active/order was not persisted'; end if;
  perform public.save_admin_quiz_version(actor,correlation,celebrity_a,quiz_v1,pg_temp.cms_questions(true));
  perform public.publish_admin_quiz_version(actor,correlation,celebrity_a,quiz_v1);
  perform public.set_admin_celebrity_publication(actor,correlation,celebrity_a,true);
  if (select status from public.celebrities where id=celebrity_a)<>'published' then raise exception 'complete celebrity did not publish'; end if;

  rejected:=false;
  begin perform public.clone_admin_quiz_version(actor,correlation,celebrity_b,quiz_v1);
  exception when others then rejected:=sqlerrm like '%quiz not found%'; end;
  if not rejected then raise exception 'cross-celebrity clone was not rejected'; end if;

  perform public.clone_admin_quiz_version(actor,correlation,celebrity_a,quiz_v1);
  select id into quiz_v2 from public.celebrity_quizzes where celebrity_id=celebrity_a and version=2;
  rejected:=false;
  begin perform public.publish_admin_quiz_version(actor,correlation,celebrity_b,quiz_v2);
  exception when others then rejected:=sqlerrm like '%draft quiz not found%'; end;
  if not rejected then raise exception 'cross-celebrity publish was not rejected'; end if;
  perform public.publish_admin_quiz_version(actor,correlation,celebrity_a,quiz_v2);

  select id into old_question from public.celebrity_quiz_questions where quiz_id=quiz_v1 order by position limit 1;
  rejected:=false;
  begin update public.celebrity_quiz_questions set prompt_ko='변조' where id=old_question;
  exception when others then rejected:=sqlerrm like '%published quiz versions are immutable%'; end;
  if not rejected then raise exception 'retired published graph was mutable'; end if;

  perform public.clone_admin_quiz_version(actor,correlation,celebrity_a,quiz_v2);
  select id into quiz_v3 from public.celebrity_quizzes where celebrity_id=celebrity_a and version=3;
  if quiz_v3 is null then raise exception 'serialized next version was not allocated'; end if;

  raise notice 'CMS_DEV_PROOF cross_clone=rejected cross_publish=rejected retired_graph=rejected no_quiz_publish=rejected complete_publish=accepted option_active_order=persisted versions=1,2,3';
end $$;

select jsonb_build_object(
  'crossClone','rejected','crossPublish','rejected','retiredGraphMutation','rejected',
  'publishWithoutQuiz','rejected','publishWithValidQuiz','accepted',
  'optionActiveOrder','persisted','allocatedVersions',jsonb_build_array(1,2,3)
) as cms_dev_proof;
