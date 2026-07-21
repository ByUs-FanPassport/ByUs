-- Immutable production seed for the first KARA fan-verification quiz.
-- Facts were checked against the following primary official sources:
-- https://rbwjapan.jp/artist/kara.php
-- https://www.universal-music.co.jp/kara/biography/
-- https://www.universal-music.co.jp/kara/products/umck-5286/
-- https://www.universal-music.co.jp/kara/products/uice-9021/
-- https://www.universal-music.co.jp/kara/news/2022-12-06-2/
-- https://www.universal-music.co.jp/kara/products/umck-9670/
--
-- Reapplication is accepted only when every owned seed row is byte-for-byte
-- equivalent to this version. Existing KARA content is never overwritten.

do $$
declare
  seed_celebrity_id constant uuid := '4b415241-0000-4000-8000-000000000001';
  seed_quiz_id constant uuid := '4b415241-0000-4000-8000-000000000002';
  existing_celebrity public.celebrities%rowtype;
  existing_published_quiz_id uuid;
  question_count integer;
  option_count integer;
  correct_count integer;
  option_position_count integer;
  correct_positions smallint[];
begin
  select * into existing_celebrity
  from public.celebrities
  where slug = 'kara';

  if not found then
    if exists (select 1 from public.celebrities where id = seed_celebrity_id) then
      raise exception 'KARA_SEED_CELEBRITY_CONFLICT: stable celebrity id is already occupied';
    end if;

    insert into public.celebrities (id, slug, status, image_url, image_position)
    values (
      seed_celebrity_id,
      'kara',
      'draft',
      '/images/guest-home/kara-card.jpg',
      'center 46%'
    );

    insert into public.celebrity_localizations (
      celebrity_id, locale, name, summary, image_alt
    ) values
      (
        seed_celebrity_id,
        'ko',
        'KARA',
        'KARA와 함께할 다음 LIVE를 확인하고 Fan Passport 여정을 시작해 보세요.',
        '파란색 무대 의상을 입은 KARA 멤버들'
      ),
      (
        seed_celebrity_id,
        'en',
        'KARA',
        'Discover KARA’s next LIVE and begin your Fan Passport journey.',
        'KARA members wearing blue stage outfits'
      );

    update public.celebrities
    set status = 'published'
    where id = seed_celebrity_id;

    set constraints all immediate;
    set constraints all deferred;
  elsif existing_celebrity.id <> seed_celebrity_id
     or existing_celebrity.status <> 'published'
     or existing_celebrity.image_url <> '/images/guest-home/kara-card.jpg'
     or existing_celebrity.image_position <> 'center 46%'
     or (select count(*) from public.celebrity_localizations localization
         where localization.celebrity_id = seed_celebrity_id) <> 2
     or not exists (
       select 1 from public.celebrity_localizations localization
       where localization.celebrity_id = seed_celebrity_id
         and localization.locale = 'ko'
         and localization.name = 'KARA'
         and localization.summary = 'KARA와 함께할 다음 LIVE를 확인하고 Fan Passport 여정을 시작해 보세요.'
         and localization.image_alt = '파란색 무대 의상을 입은 KARA 멤버들'
     )
     or not exists (
       select 1 from public.celebrity_localizations localization
       where localization.celebrity_id = seed_celebrity_id
         and localization.locale = 'en'
         and localization.name = 'KARA'
         and localization.summary = 'Discover KARA’s next LIVE and begin your Fan Passport journey.'
         and localization.image_alt = 'KARA members wearing blue stage outfits'
     ) then
    raise exception 'KARA_SEED_CELEBRITY_CONFLICT: existing kara content does not exactly match the immutable seed';
  end if;

  select quiz.id into existing_published_quiz_id
  from public.celebrity_quizzes quiz
  where quiz.celebrity_id = seed_celebrity_id
    and quiz.status = 'published';

  if existing_published_quiz_id is not null
     and existing_published_quiz_id <> seed_quiz_id then
    raise exception 'KARA_SEED_PUBLISHED_QUIZ_CONFLICT: a different published KARA quiz already exists';
  end if;

  if existing_published_quiz_id is null then
    if exists (
      select 1 from public.celebrity_quizzes quiz
      where quiz.id = seed_quiz_id
         or (quiz.celebrity_id = seed_celebrity_id and quiz.version = 1)
    ) then
      raise exception 'KARA_SEED_CONTENT_MISMATCH: stable quiz identity or KARA version 1 is already occupied';
    end if;

    insert into public.celebrity_quizzes (id, celebrity_id, version, status)
    values (seed_quiz_id, seed_celebrity_id, 1, 'draft');

    insert into public.celebrity_quiz_questions (
      id, quiz_id, position, prompt_ko, prompt_en, active
    ) values
      ('4b415241-0000-4000-8000-000000000101', seed_quiz_id, 1,
       'KARA는 몇 년에 데뷔했을까요?', 'What year did KARA debut?', true),
      ('4b415241-0000-4000-8000-000000000102', seed_quiz_id, 2,
       'KARA의 일본 데뷔 싱글은 무엇일까요?', 'Which song was KARA’s Japanese debut single?', true),
      ('4b415241-0000-4000-8000-000000000103', seed_quiz_id, 3,
       'KARA의 첫 일본어 정규 앨범 제목은 무엇일까요?', 'What is the title of KARA’s first full-length Japanese-language album?', true),
      ('4b415241-0000-4000-8000-000000000104', seed_quiz_id, 4,
       'KARA가 데뷔 15주년을 기념해 발표한 앨범은 무엇일까요?', 'Which album did KARA release to celebrate their 15th anniversary?', true),
      ('4b415241-0000-4000-8000-000000000105', seed_quiz_id, 5,
       '앨범 《MOVE AGAIN》의 타이틀곡은 무엇일까요?', 'What is the title track of the album “MOVE AGAIN”?', true),
      ('4b415241-0000-4000-8000-000000000106', seed_quiz_id, 6,
       '다음 중 KARA의 세 번째 한국 정규 앨범은 무엇일까요?', 'Which of these is KARA’s third Korean studio album?', true);

    insert into public.celebrity_quiz_options (
      id, question_id, position, label_ko, label_en, is_correct, active
    ) values
      ('4b415241-0000-4000-8000-000000001101', '4b415241-0000-4000-8000-000000000101', 1, '2005년', '2005', false, true),
      ('4b415241-0000-4000-8000-000000001102', '4b415241-0000-4000-8000-000000000101', 2, '2006년', '2006', false, true),
      ('4b415241-0000-4000-8000-000000001103', '4b415241-0000-4000-8000-000000000101', 3, '2007년', '2007', true, true),
      ('4b415241-0000-4000-8000-000000001104', '4b415241-0000-4000-8000-000000000101', 4, '2008년', '2008', false, true),
      ('4b415241-0000-4000-8000-000000001201', '4b415241-0000-4000-8000-000000000102', 1, '미스터', 'Mister', true, true),
      ('4b415241-0000-4000-8000-000000001202', '4b415241-0000-4000-8000-000000000102', 2, '점핑', 'Jumping', false, true),
      ('4b415241-0000-4000-8000-000000001203', '4b415241-0000-4000-8000-000000000102', 3, '제트코스터 러브', 'Jet Coaster Love', false, true),
      ('4b415241-0000-4000-8000-000000001204', '4b415241-0000-4000-8000-000000000102', 4, '고고 서머!', 'Go Go Summer!', false, true),
      ('4b415241-0000-4000-8000-000000001301', '4b415241-0000-4000-8000-000000000103', 1, '걸즈 토크', 'Girl’s Talk', true, true),
      ('4b415241-0000-4000-8000-000000001302', '4b415241-0000-4000-8000-000000000103', 2, '슈퍼 걸', 'Super Girl', false, true),
      ('4b415241-0000-4000-8000-000000001303', '4b415241-0000-4000-8000-000000000103', 3, '걸즈 포에버', 'Girls Forever', false, true),
      ('4b415241-0000-4000-8000-000000001304', '4b415241-0000-4000-8000-000000000103', 4, '걸즈 스토리', 'Girl’s Story', false, true),
      ('4b415241-0000-4000-8000-000000001401', '4b415241-0000-4000-8000-000000000104', 1, 'MOVE AGAIN', 'Move Again', true, true),
      ('4b415241-0000-4000-8000-000000001402', '4b415241-0000-4000-8000-000000000104', 2, 'Full Bloom', 'Full Bloom', false, true),
      ('4b415241-0000-4000-8000-000000001403', '4b415241-0000-4000-8000-000000000104', 3, 'STEP', 'Step', false, true),
      ('4b415241-0000-4000-8000-000000001404', '4b415241-0000-4000-8000-000000000104', 4, 'Revolution', 'Revolution', false, true),
      ('4b415241-0000-4000-8000-000000001501', '4b415241-0000-4000-8000-000000000105', 1, 'WHEN I MOVE', 'When I Move', true, true),
      ('4b415241-0000-4000-8000-000000001502', '4b415241-0000-4000-8000-000000000105', 2, 'STEP', 'Step', false, true),
      ('4b415241-0000-4000-8000-000000001503', '4b415241-0000-4000-8000-000000000105', 3, 'PANDORA', 'Pandora', false, true),
      ('4b415241-0000-4000-8000-000000001504', '4b415241-0000-4000-8000-000000000105', 4, 'Mamma Mia', 'Mamma Mia', false, true),
      ('4b415241-0000-4000-8000-000000001601', '4b415241-0000-4000-8000-000000000106', 1, 'STEP', 'Step', true, true),
      ('4b415241-0000-4000-8000-000000001602', '4b415241-0000-4000-8000-000000000106', 2, 'PANDORA', 'Pandora', false, true),
      ('4b415241-0000-4000-8000-000000001603', '4b415241-0000-4000-8000-000000000106', 3, 'Lupin', 'Lupin', false, true),
      ('4b415241-0000-4000-8000-000000001604', '4b415241-0000-4000-8000-000000000106', 4, 'Pretty Girl', 'Pretty Girl', false, true);

    update public.celebrity_quizzes
    set status = 'published'
    where id = seed_quiz_id;

    set constraints all immediate;
    set constraints all deferred;
  end if;

  if not exists (
    select 1 from public.celebrity_quizzes quiz
    where quiz.id = seed_quiz_id
      and quiz.celebrity_id = seed_celebrity_id
      and quiz.version = 1
      and quiz.status = 'published'
      and quiz.published_at is not null
  ) then
    raise exception 'KARA_SEED_CONTENT_MISMATCH: quiz header does not exactly match version 1';
  end if;

  if exists (
    with expected(id, position, prompt_ko, prompt_en, active) as (values
      ('4b415241-0000-4000-8000-000000000101'::uuid, 1::smallint, 'KARA는 몇 년에 데뷔했을까요?', 'What year did KARA debut?', true),
      ('4b415241-0000-4000-8000-000000000102'::uuid, 2::smallint, 'KARA의 일본 데뷔 싱글은 무엇일까요?', 'Which song was KARA’s Japanese debut single?', true),
      ('4b415241-0000-4000-8000-000000000103'::uuid, 3::smallint, 'KARA의 첫 일본어 정규 앨범 제목은 무엇일까요?', 'What is the title of KARA’s first full-length Japanese-language album?', true),
      ('4b415241-0000-4000-8000-000000000104'::uuid, 4::smallint, 'KARA가 데뷔 15주년을 기념해 발표한 앨범은 무엇일까요?', 'Which album did KARA release to celebrate their 15th anniversary?', true),
      ('4b415241-0000-4000-8000-000000000105'::uuid, 5::smallint, '앨범 《MOVE AGAIN》의 타이틀곡은 무엇일까요?', 'What is the title track of the album “MOVE AGAIN”?', true),
      ('4b415241-0000-4000-8000-000000000106'::uuid, 6::smallint, '다음 중 KARA의 세 번째 한국 정규 앨범은 무엇일까요?', 'Which of these is KARA’s third Korean studio album?', true)
    ), actual as (
      select question.id, question.position, question.prompt_ko, question.prompt_en, question.active
      from public.celebrity_quiz_questions question
      where question.quiz_id = seed_quiz_id
    )
    (select * from expected except select * from actual)
    union all
    (select * from actual except select * from expected)
  ) then
    raise exception 'KARA_SEED_CONTENT_MISMATCH: question rows differ from the immutable seed';
  end if;

  if exists (
    with expected(id, question_id, position, label_ko, label_en, is_correct, active) as (values
      ('4b415241-0000-4000-8000-000000001101'::uuid, '4b415241-0000-4000-8000-000000000101'::uuid, 1::smallint, '2005년', '2005', false, true),
      ('4b415241-0000-4000-8000-000000001102'::uuid, '4b415241-0000-4000-8000-000000000101'::uuid, 2::smallint, '2006년', '2006', false, true),
      ('4b415241-0000-4000-8000-000000001103'::uuid, '4b415241-0000-4000-8000-000000000101'::uuid, 3::smallint, '2007년', '2007', true, true),
      ('4b415241-0000-4000-8000-000000001104'::uuid, '4b415241-0000-4000-8000-000000000101'::uuid, 4::smallint, '2008년', '2008', false, true),
      ('4b415241-0000-4000-8000-000000001201'::uuid, '4b415241-0000-4000-8000-000000000102'::uuid, 1::smallint, '미스터', 'Mister', true, true),
      ('4b415241-0000-4000-8000-000000001202'::uuid, '4b415241-0000-4000-8000-000000000102'::uuid, 2::smallint, '점핑', 'Jumping', false, true),
      ('4b415241-0000-4000-8000-000000001203'::uuid, '4b415241-0000-4000-8000-000000000102'::uuid, 3::smallint, '제트코스터 러브', 'Jet Coaster Love', false, true),
      ('4b415241-0000-4000-8000-000000001204'::uuid, '4b415241-0000-4000-8000-000000000102'::uuid, 4::smallint, '고고 서머!', 'Go Go Summer!', false, true),
      ('4b415241-0000-4000-8000-000000001301'::uuid, '4b415241-0000-4000-8000-000000000103'::uuid, 1::smallint, '걸즈 토크', 'Girl’s Talk', true, true),
      ('4b415241-0000-4000-8000-000000001302'::uuid, '4b415241-0000-4000-8000-000000000103'::uuid, 2::smallint, '슈퍼 걸', 'Super Girl', false, true),
      ('4b415241-0000-4000-8000-000000001303'::uuid, '4b415241-0000-4000-8000-000000000103'::uuid, 3::smallint, '걸즈 포에버', 'Girls Forever', false, true),
      ('4b415241-0000-4000-8000-000000001304'::uuid, '4b415241-0000-4000-8000-000000000103'::uuid, 4::smallint, '걸즈 스토리', 'Girl’s Story', false, true),
      ('4b415241-0000-4000-8000-000000001401'::uuid, '4b415241-0000-4000-8000-000000000104'::uuid, 1::smallint, 'MOVE AGAIN', 'Move Again', true, true),
      ('4b415241-0000-4000-8000-000000001402'::uuid, '4b415241-0000-4000-8000-000000000104'::uuid, 2::smallint, 'Full Bloom', 'Full Bloom', false, true),
      ('4b415241-0000-4000-8000-000000001403'::uuid, '4b415241-0000-4000-8000-000000000104'::uuid, 3::smallint, 'STEP', 'Step', false, true),
      ('4b415241-0000-4000-8000-000000001404'::uuid, '4b415241-0000-4000-8000-000000000104'::uuid, 4::smallint, 'Revolution', 'Revolution', false, true),
      ('4b415241-0000-4000-8000-000000001501'::uuid, '4b415241-0000-4000-8000-000000000105'::uuid, 1::smallint, 'WHEN I MOVE', 'When I Move', true, true),
      ('4b415241-0000-4000-8000-000000001502'::uuid, '4b415241-0000-4000-8000-000000000105'::uuid, 2::smallint, 'STEP', 'Step', false, true),
      ('4b415241-0000-4000-8000-000000001503'::uuid, '4b415241-0000-4000-8000-000000000105'::uuid, 3::smallint, 'PANDORA', 'Pandora', false, true),
      ('4b415241-0000-4000-8000-000000001504'::uuid, '4b415241-0000-4000-8000-000000000105'::uuid, 4::smallint, 'Mamma Mia', 'Mamma Mia', false, true),
      ('4b415241-0000-4000-8000-000000001601'::uuid, '4b415241-0000-4000-8000-000000000106'::uuid, 1::smallint, 'STEP', 'Step', true, true),
      ('4b415241-0000-4000-8000-000000001602'::uuid, '4b415241-0000-4000-8000-000000000106'::uuid, 2::smallint, 'PANDORA', 'Pandora', false, true),
      ('4b415241-0000-4000-8000-000000001603'::uuid, '4b415241-0000-4000-8000-000000000106'::uuid, 3::smallint, 'Lupin', 'Lupin', false, true),
      ('4b415241-0000-4000-8000-000000001604'::uuid, '4b415241-0000-4000-8000-000000000106'::uuid, 4::smallint, 'Pretty Girl', 'Pretty Girl', false, true)
    ), actual as (
      select option.id, option.question_id, option.position, option.label_ko, option.label_en, option.is_correct, option.active
      from public.celebrity_quiz_options option
      join public.celebrity_quiz_questions question on question.id = option.question_id
      where question.quiz_id = seed_quiz_id
    )
    (select * from expected except select * from actual)
    union all
    (select * from actual except select * from expected)
  ) then
    raise exception 'KARA_SEED_CONTENT_MISMATCH: option rows differ from the immutable seed';
  end if;

  select count(*) into question_count
  from public.celebrity_quiz_questions question
  where question.quiz_id = seed_quiz_id and question.active;

  select count(*), count(*) filter (where option.is_correct)
  into option_count, correct_count
  from public.celebrity_quiz_options option
  join public.celebrity_quiz_questions question on question.id = option.question_id
  where question.quiz_id = seed_quiz_id and option.active;

  select min(positions_per_question) into option_position_count
  from (
    select count(distinct option.position)::integer as positions_per_question
    from public.celebrity_quiz_questions question
    join public.celebrity_quiz_options option on option.question_id = question.id and option.active
    where question.quiz_id = seed_quiz_id and question.active
    group by question.id
  ) counts;

  select array_agg(correct_option.position order by question.position)
  into correct_positions
  from public.celebrity_quiz_questions question
  join public.celebrity_quiz_options correct_option
    on correct_option.question_id = question.id
   and correct_option.active
   and correct_option.is_correct
  where question.quiz_id = seed_quiz_id and question.active;

  if question_count <> 6
     or option_count <> 24
     or correct_count <> 6
     or option_position_count <> 4
     or correct_positions <> array[3, 1, 1, 1, 1, 1]::smallint[] then
    raise exception 'KARA_SEED_CONTENT_MISMATCH: quiz cardinality, option order, or answer key is invalid';
  end if;
end;
$$;
