-- KATSEYE public dataset v1.
--
-- This migration only creates public CMS content. It deliberately does not
-- create fan Passports, quiz attempts, reservations, activities, Stamps,
-- score ledger entries, claims, receipts, or notifications.
--
-- Sources used for the evergreen quiz facts:
--   https://www.katseye.world/story-of-katseye/
--   https://www.katseye.world/releases-archive/debut/
--   https://www.katseye.world/releases-archive/sis-soft-is-strong/
--
-- The image derivatives and their CC BY 4.0 attribution are tracked in:
--   apps/web/public/images/celebrities/katseye/attribution.json

begin;

do $preflight$
declare
  v_katseye_id constant uuid := 'ca75e1e0-0000-4000-8000-000000000001';
  v_quiz_id constant uuid := 'ca75e1e0-0000-4000-8000-000000000002';
begin
  if not exists (
    select 1
    from public.brands
    where id = '42595553-0000-4000-8000-000000000001'
      and slug = 'byus'
      and status = 'published'
      and archived_at is null
  ) then
    raise exception 'KATSEYE dataset requires the published ByUs brand';
  end if;

  if exists (
    select 1
    from public.celebrities
    where (id = v_katseye_id or slug = 'katseye')
      and not (id = v_katseye_id and slug = 'katseye')
  ) then
    raise exception 'KATSEYE celebrity id or slug collision';
  end if;

  if exists (
    select 1
    from public.celebrity_quizzes
    where id = v_quiz_id
      and celebrity_id <> v_katseye_id
  ) then
    raise exception 'KATSEYE quiz id collision';
  end if;

  if exists (
    select 1
    from public.live_events
    where id in (
      'ca75e1e0-0000-4000-8000-000000003001',
      'ca75e1e0-0000-4000-8000-000000003002',
      'ca75e1e0-0000-4000-8000-000000003003'
    )
    or slug in (
      'katseye-debut-watch-party',
      'katseye-touch-watch-party',
      'katseye-gabriela-replay'
    )
  ) then
    raise exception 'KATSEYE LIVE id or slug collision';
  end if;

  if exists (
    select 1
    from public.benefits
    where id in (
      'ca75e1e0-0000-4000-8000-000000004001',
      'ca75e1e0-0000-4000-8000-000000004002',
      'ca75e1e0-0000-4000-8000-000000004003',
      'ca75e1e0-0000-4000-8000-000000004004'
    )
    or slug in (
      'katseye-byus-welcome-note',
      'katseye-video-collection',
      'katseye-attendance-code',
      'katseye-digital-keepsake'
    )
  ) then
    raise exception 'KATSEYE benefit id or slug collision';
  end if;
end
$preflight$;

insert into public.celebrities (
  id,
  slug,
  status,
  image_url,
  image_position,
  published_at,
  display_order,
  fan_count
) values (
  'ca75e1e0-0000-4000-8000-000000000001',
  'katseye',
  'draft',
  '/images/celebrities/katseye/card.webp',
  'center 38%',
  null,
  0,
  0
);

insert into public.celebrity_localizations (
  celebrity_id,
  locale,
  name,
  summary,
  image_alt
) values
  (
    'ca75e1e0-0000-4000-8000-000000000001',
    'ko',
    'KATSEYE',
    'KATSEYE의 음악과 무대를 함께 보고, ByUs Fan Passport에 순간을 기록해 보세요.',
    '무대에서 포즈를 취한 KATSEYE'
  ),
  (
    'ca75e1e0-0000-4000-8000-000000000001',
    'en',
    'KATSEYE',
    'Watch KATSEYE music and performances together, then keep those moments in your ByUs Fan Passport.',
    'KATSEYE posing on stage'
  );

insert into public.celebrity_social_links (
  celebrity_id,
  platform,
  url,
  position,
  active
) values
  (
    'ca75e1e0-0000-4000-8000-000000000001',
    'youtube',
    'https://www.youtube.com/@katseyeworld',
    0,
    true
  ),
  (
    'ca75e1e0-0000-4000-8000-000000000001',
    'instagram',
    'https://www.instagram.com/katseyeworld/',
    1,
    true
  ),
  (
    'ca75e1e0-0000-4000-8000-000000000001',
    'tiktok',
    'https://www.tiktok.com/@katseyeworld',
    2,
    true
  );

insert into public.celebrity_quizzes (
  id,
  celebrity_id,
  version,
  status,
  published_at
) values (
  'ca75e1e0-0000-4000-8000-000000000002',
  'ca75e1e0-0000-4000-8000-000000000001',
  1,
  'draft',
  null
);

insert into public.celebrity_quiz_questions (
  id,
  quiz_id,
  position,
  prompt_ko,
  prompt_en,
  active
) values
  (
    'ca75e1e0-0000-4000-8000-000000000101',
    'ca75e1e0-0000-4000-8000-000000000002',
    1,
    'KATSEYE가 2024년 6월에 발표한 첫 싱글은 무엇인가요?',
    'Which first single did KATSEYE release in June 2024?',
    true
  ),
  (
    'ca75e1e0-0000-4000-8000-000000000102',
    'ca75e1e0-0000-4000-8000-000000000002',
    2,
    'KATSEYE의 첫 번째 EP 제목은 무엇인가요?',
    'What is the title of KATSEYE''s first EP?',
    true
  ),
  (
    'ca75e1e0-0000-4000-8000-000000000103',
    'ca75e1e0-0000-4000-8000-000000000002',
    3,
    'KATSEYE의 결성 과정을 담은 글로벌 오디션 프로젝트는 무엇인가요?',
    'Which global audition project documented KATSEYE''s formation?',
    true
  ),
  (
    'ca75e1e0-0000-4000-8000-000000000104',
    'ca75e1e0-0000-4000-8000-000000000002',
    4,
    '다음 중 EP ‘SIS (Soft Is Strong)’에 수록된 곡은 무엇인가요?',
    'Which song appears on the EP “SIS (Soft Is Strong)”?',
    true
  ),
  (
    'ca75e1e0-0000-4000-8000-000000000105',
    'ca75e1e0-0000-4000-8000-000000000002',
    5,
    'KATSEYE의 첫 싱글이 공개된 시기는 언제인가요?',
    'When was KATSEYE''s first single released?',
    true
  ),
  (
    'ca75e1e0-0000-4000-8000-000000000106',
    'ca75e1e0-0000-4000-8000-000000000002',
    6,
    'KATSEYE가 2025년에 발표한 두 번째 EP의 제목은 무엇인가요?',
    'What is the title of KATSEYE''s second EP released in 2025?',
    true
  );

insert into public.celebrity_quiz_options (
  id,
  question_id,
  position,
  label_ko,
  label_en,
  is_correct,
  active
) values
  ('ca75e1e0-0000-4000-8000-000000001101','ca75e1e0-0000-4000-8000-000000000101',1,'Debut','Debut',true,true),
  ('ca75e1e0-0000-4000-8000-000000001102','ca75e1e0-0000-4000-8000-000000000101',2,'Touch','Touch',false,true),
  ('ca75e1e0-0000-4000-8000-000000001103','ca75e1e0-0000-4000-8000-000000000101',3,'Gnarly','Gnarly',false,true),
  ('ca75e1e0-0000-4000-8000-000000001104','ca75e1e0-0000-4000-8000-000000000101',4,'Gabriela','Gabriela',false,true),
  ('ca75e1e0-0000-4000-8000-000000001105','ca75e1e0-0000-4000-8000-000000000102',1,'SIS (Soft Is Strong)','SIS (Soft Is Strong)',true,true),
  ('ca75e1e0-0000-4000-8000-000000001106','ca75e1e0-0000-4000-8000-000000000102',2,'BEAUTIFUL CHAOS','BEAUTIFUL CHAOS',false,true),
  ('ca75e1e0-0000-4000-8000-000000001107','ca75e1e0-0000-4000-8000-000000000102',3,'The Dream Chapter','The Dream Chapter',false,true),
  ('ca75e1e0-0000-4000-8000-000000001108','ca75e1e0-0000-4000-8000-000000000102',4,'First Light','First Light',false,true),
  ('ca75e1e0-0000-4000-8000-000000001109','ca75e1e0-0000-4000-8000-000000000103',1,'The Debut: Dream Academy','The Debut: Dream Academy',true,true),
  ('ca75e1e0-0000-4000-8000-000000001110','ca75e1e0-0000-4000-8000-000000000103',2,'Produce 101','Produce 101',false,true),
  ('ca75e1e0-0000-4000-8000-000000001111','ca75e1e0-0000-4000-8000-000000000103',3,'Girls Planet','Girls Planet',false,true),
  ('ca75e1e0-0000-4000-8000-000000001112','ca75e1e0-0000-4000-8000-000000000103',4,'Star Audition','Star Audition',false,true),
  ('ca75e1e0-0000-4000-8000-000000001113','ca75e1e0-0000-4000-8000-000000000104',1,'Touch','Touch',true,true),
  ('ca75e1e0-0000-4000-8000-000000001114','ca75e1e0-0000-4000-8000-000000000104',2,'Gabriela','Gabriela',false,true),
  ('ca75e1e0-0000-4000-8000-000000001115','ca75e1e0-0000-4000-8000-000000000104',3,'Gnarly','Gnarly',false,true),
  ('ca75e1e0-0000-4000-8000-000000001116','ca75e1e0-0000-4000-8000-000000000104',4,'Internet Girl','Internet Girl',false,true),
  ('ca75e1e0-0000-4000-8000-000000001117','ca75e1e0-0000-4000-8000-000000000105',1,'2024년 6월','June 2024',true,true),
  ('ca75e1e0-0000-4000-8000-000000001118','ca75e1e0-0000-4000-8000-000000000105',2,'2023년 6월','June 2023',false,true),
  ('ca75e1e0-0000-4000-8000-000000001119','ca75e1e0-0000-4000-8000-000000000105',3,'2024년 1월','January 2024',false,true),
  ('ca75e1e0-0000-4000-8000-000000001120','ca75e1e0-0000-4000-8000-000000000105',4,'2025년 6월','June 2025',false,true),
  ('ca75e1e0-0000-4000-8000-000000001121','ca75e1e0-0000-4000-8000-000000000106',1,'BEAUTIFUL CHAOS','BEAUTIFUL CHAOS',true,true),
  ('ca75e1e0-0000-4000-8000-000000001122','ca75e1e0-0000-4000-8000-000000000106',2,'SIS (Soft Is Strong)','SIS (Soft Is Strong)',false,true),
  ('ca75e1e0-0000-4000-8000-000000001123','ca75e1e0-0000-4000-8000-000000000106',3,'Dream Academy','Dream Academy',false,true),
  ('ca75e1e0-0000-4000-8000-000000001124','ca75e1e0-0000-4000-8000-000000000106',4,'Soft Chaos','Soft Chaos',false,true);

update public.celebrity_quizzes
set status = 'published'
where id = 'ca75e1e0-0000-4000-8000-000000000002';

update public.celebrities
set status = 'published'
where id = 'ca75e1e0-0000-4000-8000-000000000001';

insert into public.celebrity_notices (
  id,
  celebrity_id,
  slug,
  publication_status,
  pinned,
  published_at,
  ever_published_at
) values
  (
    'ca75e1e0-0000-4000-8000-000000002001',
    'ca75e1e0-0000-4000-8000-000000000001',
    'katseye-fan-page-guide',
    'published',
    true,
    '2026-07-26T00:00:00Z',
    '2026-07-26T00:00:00Z'
  ),
  (
    'ca75e1e0-0000-4000-8000-000000002002',
    'ca75e1e0-0000-4000-8000-000000000001',
    'katseye-watch-party-guide',
    'published',
    false,
    '2026-07-25T00:00:00Z',
    '2026-07-25T00:00:00Z'
  ),
  (
    'ca75e1e0-0000-4000-8000-000000002003',
    'ca75e1e0-0000-4000-8000-000000000001',
    'katseye-passport-benefit-guide',
    'published',
    false,
    '2026-07-24T00:00:00Z',
    '2026-07-24T00:00:00Z'
  );

insert into public.celebrity_notice_localizations (
  notice_id,
  locale,
  title,
  body_json
) values
  (
    'ca75e1e0-0000-4000-8000-000000002001',
    'ko',
    'KATSEYE 팬페이지 이용 안내',
    '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"이 페이지는 ByUs가 운영하는 팬 활동 공간입니다. 팬 인증, LIVE 예약, 설문 참여로 얻은 기록은 본인의 Fan Passport에 쌓입니다."}]},{"type":"paragraph","content":[{"type":"text","text":"ByUs가 제공하는 안내와 혜택은 아티스트 또는 소속사의 공식 발표나 공식 상품이 아닙니다."}]}]}'::jsonb
  ),
  (
    'ca75e1e0-0000-4000-8000-000000002001',
    'en',
    'How to use the KATSEYE fan page',
    '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"This fan activity space is operated by ByUs. Records earned through fan verification, LIVE reservations, and surveys are added to your own Fan Passport."}]},{"type":"paragraph","content":[{"type":"text","text":"ByUs guides and benefits are not official announcements or merchandise from the artist or label."}]}]}'::jsonb
  ),
  (
    'ca75e1e0-0000-4000-8000-000000002002',
    'ko',
    'ByUs Watch Party와 다시보기 안내',
    '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"예정된 ByUs Watch Party를 예약하면 시작 전에 다시 확인할 수 있어요. 종료된 모임은 공개된 공식 영상으로 이어지는 다시보기 링크를 제공합니다."}]},{"type":"paragraph","content":[{"type":"text","text":"가상 LIVE NOW 상태는 만들지 않으며, 실제 일정과 다시보기 상태를 구분해 표시합니다."}]}]}'::jsonb
  ),
  (
    'ca75e1e0-0000-4000-8000-000000002002',
    'en',
    'ByUs Watch Parties and replays',
    '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Reserve an upcoming ByUs Watch Party to find it again before it begins. Completed sessions link to a publicly available official video."}]},{"type":"paragraph","content":[{"type":"text","text":"We do not create a fictional LIVE NOW state; scheduled events and replays are clearly separated."}]}]}'::jsonb
  ),
  (
    'ca75e1e0-0000-4000-8000-000000002003',
    'ko',
    'Fan Passport와 ByUs 혜택 안내',
    '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"팬 인증을 통과하면 KATSEYE Fan Passport가 발급되고 Knowledge Stamp와 Fan Score 1점을 받아요."}]},{"type":"paragraph","content":[{"type":"text","text":"이후 ByUs 활동으로 Score와 Stamp를 모으면 조건에 맞는 ByUs 제작 디지털 혜택을 직접 수령할 수 있습니다."}]}]}'::jsonb
  ),
  (
    'ca75e1e0-0000-4000-8000-000000002003',
    'en',
    'Fan Passport and ByUs benefits',
    '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Pass fan verification to receive a KATSEYE Fan Passport, a Knowledge Stamp, and 1 Fan Score point."}]},{"type":"paragraph","content":[{"type":"text","text":"Continue with ByUs activities to collect Score and Stamps, then claim eligible ByUs-made digital benefits."}]}]}'::jsonb
  );

insert into public.live_events (
  id,
  slug,
  celebrity_id,
  brand_id,
  publication_status,
  content_status,
  starts_at,
  ends_at,
  reservation_opens_at,
  reservation_closes_at,
  youtube_url,
  approved_hero_url,
  fan_code_hash,
  published_at
) values
  (
    'ca75e1e0-0000-4000-8000-000000003001',
    'katseye-debut-watch-party',
    'ca75e1e0-0000-4000-8000-000000000001',
    '42595553-0000-4000-8000-000000000001',
    'draft',
    'scheduled',
    '2026-08-22T11:00:00Z',
    '2026-08-22T12:00:00Z',
    '2026-07-26T00:00:00Z',
    '2026-08-22T10:30:00Z',
    'https://www.youtube.com/watch?v=bYg6aMDQ_TA',
    '/images/celebrities/katseye/live-upcoming-1.webp',
    '$2b$12$77MuPwvYt25ndp9VmMiWSOiOZh.EUETS.mt5E1qQUWYahydW07QtK',
    null
  ),
  (
    'ca75e1e0-0000-4000-8000-000000003002',
    'katseye-touch-watch-party',
    'ca75e1e0-0000-4000-8000-000000000001',
    '42595553-0000-4000-8000-000000000001',
    'draft',
    'scheduled',
    '2026-09-12T11:00:00Z',
    '2026-09-12T12:00:00Z',
    '2026-07-26T00:00:00Z',
    '2026-09-12T10:30:00Z',
    'https://www.youtube.com/watch?v=l9CZykYZkOQ',
    '/images/celebrities/katseye/live-upcoming-2.webp',
    '$2b$12$4Vic0fnoRWc5kYNC2RF0t.Ztwb/oWZMQxBJFcixt76Vkwv5eihsZ2',
    null
  ),
  (
    'ca75e1e0-0000-4000-8000-000000003003',
    'katseye-gabriela-replay',
    'ca75e1e0-0000-4000-8000-000000000001',
    '42595553-0000-4000-8000-000000000001',
    'draft',
    'scheduled',
    '2026-06-27T11:00:00Z',
    '2026-06-27T12:00:00Z',
    '2026-06-01T00:00:00Z',
    '2026-06-27T10:30:00Z',
    'https://www.youtube.com/watch?v=CjnB56tSCQI',
    '/images/celebrities/katseye/live-replay.webp',
    '$2b$12$2PrG9/LjLsx7FiFCJhz5ie1.KXhqVVRbgRKCiEnLJHD7tf/Se23F2',
    null
  );

insert into public.live_event_localizations (
  live_event_id,
  locale,
  title,
  summary,
  hero_alt
) values
  (
    'ca75e1e0-0000-4000-8000-000000003001','ko',
    'ByUs Watch Party: KATSEYE ‘Debut’',
    '공개된 ‘Debut’ 영상을 팬들과 함께 보는 ByUs 온라인 Watch Party입니다.',
    '무대에서 공연하는 KATSEYE'
  ),
  (
    'ca75e1e0-0000-4000-8000-000000003001','en',
    'ByUs Watch Party: KATSEYE “Debut”',
    'A ByUs online Watch Party for fans to watch the publicly available “Debut” video together.',
    'KATSEYE performing on stage'
  ),
  (
    'ca75e1e0-0000-4000-8000-000000003002','ko',
    'ByUs Watch Party: KATSEYE ‘Touch’',
    '공개된 ‘Touch’ 영상을 팬들과 함께 보는 ByUs 온라인 Watch Party입니다.',
    '팬들 앞에서 공연하는 KATSEYE'
  ),
  (
    'ca75e1e0-0000-4000-8000-000000003002','en',
    'ByUs Watch Party: KATSEYE “Touch”',
    'A ByUs online Watch Party for fans to watch the publicly available “Touch” video together.',
    'KATSEYE performing for fans'
  ),
  (
    'ca75e1e0-0000-4000-8000-000000003003','ko',
    'KATSEYE ‘Gabriela’ 다시보기',
    'ByUs Watch Party가 종료되었어요. 공개된 ‘Gabriela’ 영상으로 다시 감상해 보세요.',
    '무대 조명 아래 공연하는 KATSEYE'
  ),
  (
    'ca75e1e0-0000-4000-8000-000000003003','en',
    'KATSEYE “Gabriela” replay',
    'The ByUs Watch Party has ended. Rewatch the publicly available “Gabriela” video.',
    'KATSEYE performing under stage lights'
  );

update public.live_events
set publication_status = 'published'
where id in (
  'ca75e1e0-0000-4000-8000-000000003001',
  'ca75e1e0-0000-4000-8000-000000003002',
  'ca75e1e0-0000-4000-8000-000000003003'
);

insert into public.benefits (
  id,
  slug,
  celebrity_id,
  publication_status,
  delivery_type,
  claim_opens_at,
  claim_closes_at,
  stock_limit,
  per_user_limit,
  minimum_score,
  minimum_level,
  required_stamp_type,
  required_activity_type,
  published_at,
  allocation_mode
) values
  (
    'ca75e1e0-0000-4000-8000-000000004001',
    'katseye-byus-welcome-note',
    'ca75e1e0-0000-4000-8000-000000000001',
    'draft','text',
    '2026-07-26T00:00:00Z','2027-12-31T15:00:00Z',
    null,1,0,'Bronze',null,null,
    null,'direct_claim'
  ),
  (
    'ca75e1e0-0000-4000-8000-000000004002',
    'katseye-video-collection',
    'ca75e1e0-0000-4000-8000-000000000001',
    'draft','external_link',
    '2026-07-26T00:00:00Z','2027-12-31T15:00:00Z',
    null,1,5,'Silver',null,null,
    null,'direct_claim'
  ),
  (
    'ca75e1e0-0000-4000-8000-000000004003',
    'katseye-attendance-code',
    'ca75e1e0-0000-4000-8000-000000000001',
    'draft','shared_code',
    '2026-07-26T00:00:00Z','2027-12-31T15:00:00Z',
    null,1,8,'Silver','attendance','attendance',
    null,'direct_claim'
  ),
  (
    'ca75e1e0-0000-4000-8000-000000004004',
    'katseye-digital-keepsake',
    'ca75e1e0-0000-4000-8000-000000000001',
    'draft','unique_code',
    '2026-07-26T00:00:00Z','2027-12-31T15:00:00Z',
    12,1,10,'Gold','survey','survey',
    null,'direct_claim'
  );

insert into public.benefit_localizations (
  benefit_id,
  locale,
  title,
  summary,
  eligibility_label,
  delivery_label
) values
  (
    'ca75e1e0-0000-4000-8000-000000004001','ko',
    'ByUs 팬 인증 웰컴 노트',
    'KATSEYE 팬 인증을 마친 팬에게 전하는 ByUs의 디지털 웰컴 메시지입니다.',
    'KATSEYE Fan Passport 보유',
    'ByUs 디지털 메시지'
  ),
  (
    'ca75e1e0-0000-4000-8000-000000004001','en',
    'ByUs fan verification welcome note',
    'A digital welcome message from ByUs for fans who complete KATSEYE fan verification.',
    'Own a KATSEYE Fan Passport',
    'ByUs digital message'
  ),
  (
    'ca75e1e0-0000-4000-8000-000000004002','ko',
    'KATSEYE 영상 모아보기',
    'ByUs가 정리한 KATSEYE 공개 영상 모음으로 이동합니다.',
    'Fan Score 5점 · Silver 이상',
    'KATSEYE 공개 영상 링크'
  ),
  (
    'ca75e1e0-0000-4000-8000-000000004002','en',
    'KATSEYE video collection',
    'Open a KATSEYE public video collection curated by ByUs.',
    'Fan Score 5 · Silver or higher',
    'KATSEYE public video link'
  ),
  (
    'ca75e1e0-0000-4000-8000-000000004003','ko',
    'ByUs Watch Party 기념 코드',
    'Watch Party 출석 기록을 남긴 팬을 위한 ByUs 기념 코드입니다. 금전 가치나 공식 상품 교환 기능은 없습니다.',
    'Fan Score 8점 · Silver 이상 · Attendance Stamp',
    'ByUs 공통 기념 코드'
  ),
  (
    'ca75e1e0-0000-4000-8000-000000004003','en',
    'ByUs Watch Party keepsake code',
    'A ByUs keepsake code for fans with a Watch Party attendance record. It has no monetary value and cannot be exchanged for official merchandise.',
    'Fan Score 8 · Silver or higher · Attendance Stamp',
    'Shared ByUs keepsake code'
  ),
  (
    'ca75e1e0-0000-4000-8000-000000004004','ko',
    'ByUs 디지털 기록 번호',
    '설문까지 마친 팬에게 한 번만 배정되는 ByUs 디지털 기록 번호입니다. 공식 KATSEYE 상품이나 쿠폰이 아닙니다.',
    'Fan Score 10점 · Gold 이상 · Survey Stamp',
    '1인 1회 고유 기록 번호'
  ),
  (
    'ca75e1e0-0000-4000-8000-000000004004','en',
    'ByUs digital keepsake number',
    'A one-time ByUs digital keepsake number for fans who complete a survey. It is not official KATSEYE merchandise or a coupon.',
    'Fan Score 10 · Gold or higher · Survey Stamp',
    'One unique keepsake number per fan'
  );

insert into public.benefit_delivery_vault (
  benefit_id,
  delivery_type,
  secret_value
) values
  (
    'ca75e1e0-0000-4000-8000-000000004001',
    'text',
    'KATSEYE와 함께할 다음 순간도 ByUs Fan Passport에 차곡차곡 기록해 보세요.'
  ),
  (
    'ca75e1e0-0000-4000-8000-000000004002',
    'external_link',
    'https://www.youtube.com/watch?v=bYg6aMDQ_TA'
  ),
  (
    'ca75e1e0-0000-4000-8000-000000004003',
    'shared_code',
    'BYUS-EYE-2026'
  );

insert into public.benefit_unique_codes (
  id,
  benefit_id,
  code_value
) values
  ('ca75e1e0-0000-4000-8000-000000005001','ca75e1e0-0000-4000-8000-000000004004','BYUS-KAT-001'),
  ('ca75e1e0-0000-4000-8000-000000005002','ca75e1e0-0000-4000-8000-000000004004','BYUS-KAT-002'),
  ('ca75e1e0-0000-4000-8000-000000005003','ca75e1e0-0000-4000-8000-000000004004','BYUS-KAT-003'),
  ('ca75e1e0-0000-4000-8000-000000005004','ca75e1e0-0000-4000-8000-000000004004','BYUS-KAT-004'),
  ('ca75e1e0-0000-4000-8000-000000005005','ca75e1e0-0000-4000-8000-000000004004','BYUS-KAT-005'),
  ('ca75e1e0-0000-4000-8000-000000005006','ca75e1e0-0000-4000-8000-000000004004','BYUS-KAT-006'),
  ('ca75e1e0-0000-4000-8000-000000005007','ca75e1e0-0000-4000-8000-000000004004','BYUS-KAT-007'),
  ('ca75e1e0-0000-4000-8000-000000005008','ca75e1e0-0000-4000-8000-000000004004','BYUS-KAT-008'),
  ('ca75e1e0-0000-4000-8000-000000005009','ca75e1e0-0000-4000-8000-000000004004','BYUS-KAT-009'),
  ('ca75e1e0-0000-4000-8000-000000005010','ca75e1e0-0000-4000-8000-000000004004','BYUS-KAT-010'),
  ('ca75e1e0-0000-4000-8000-000000005011','ca75e1e0-0000-4000-8000-000000004004','BYUS-KAT-011'),
  ('ca75e1e0-0000-4000-8000-000000005012','ca75e1e0-0000-4000-8000-000000004004','BYUS-KAT-012');

update public.benefits
set publication_status = 'published'
where id in (
  'ca75e1e0-0000-4000-8000-000000004001',
  'ca75e1e0-0000-4000-8000-000000004002',
  'ca75e1e0-0000-4000-8000-000000004003',
  'ca75e1e0-0000-4000-8000-000000004004'
);

-- Produce deterministic snapshots for stored-row drift detection and for the
-- all-or-nothing KARA/NUALEAF archive preservation guard.
create function public.katseye_public_rows_snapshot(p_rows jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'count', jsonb_array_length(p_rows),
    'sha256', encode(extensions.digest(p_rows::text, 'sha256'), 'hex')
  );
$$;

create function public.read_katseye_public_dataset_v1_snapshot()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'celebrity', (
      select to_jsonb(row_value)
        - array['created_at','updated_at','published_at','ever_published_at']::text[]
      from public.celebrities row_value
      where row_value.id = 'ca75e1e0-0000-4000-8000-000000000001'
    ),
    'celebrityLocalizations', coalesce((
      select jsonb_agg(
        to_jsonb(row_value) - array['created_at','updated_at']::text[]
        order by row_value.locale
      )
      from public.celebrity_localizations row_value
      where row_value.celebrity_id = 'ca75e1e0-0000-4000-8000-000000000001'
    ), '[]'::jsonb),
    'celebritySocialLinks', coalesce((
      select jsonb_agg(
        to_jsonb(row_value) - array['created_at','updated_at']::text[]
        order by row_value.position, row_value.platform
      )
      from public.celebrity_social_links row_value
      where row_value.celebrity_id = 'ca75e1e0-0000-4000-8000-000000000001'
    ), '[]'::jsonb),
    'quiz', (
      select to_jsonb(row_value)
        - array['created_at','updated_at','published_at']::text[]
      from public.celebrity_quizzes row_value
      where row_value.id = 'ca75e1e0-0000-4000-8000-000000000002'
    ),
    'quizQuestions', coalesce((
      select jsonb_agg(
        to_jsonb(row_value) - array['created_at','updated_at']::text[]
        order by row_value.position, row_value.id
      )
      from public.celebrity_quiz_questions row_value
      where row_value.quiz_id = 'ca75e1e0-0000-4000-8000-000000000002'
    ), '[]'::jsonb),
    'quizOptions', coalesce((
      select jsonb_agg(
        to_jsonb(row_value) - array['created_at','updated_at']::text[]
        order by row_value.question_id, row_value.position, row_value.id
      )
      from public.celebrity_quiz_options row_value
      where row_value.question_id in (
        select question.id
        from public.celebrity_quiz_questions question
        where question.quiz_id = 'ca75e1e0-0000-4000-8000-000000000002'
      )
    ), '[]'::jsonb),
    'notices', coalesce((
      select jsonb_agg(
        to_jsonb(row_value) - array['created_at','updated_at']::text[]
        order by row_value.id
      )
      from public.celebrity_notices row_value
      where row_value.celebrity_id = 'ca75e1e0-0000-4000-8000-000000000001'
    ), '[]'::jsonb),
    'noticeLocalizations', coalesce((
      select jsonb_agg(
        to_jsonb(row_value) - array['created_at','updated_at']::text[]
        order by row_value.notice_id, row_value.locale
      )
      from public.celebrity_notice_localizations row_value
      where row_value.notice_id in (
        select notice.id
        from public.celebrity_notices notice
        where notice.celebrity_id = 'ca75e1e0-0000-4000-8000-000000000001'
      )
    ), '[]'::jsonb),
    'liveEvents', coalesce((
      select jsonb_agg(
        to_jsonb(row_value)
          - array['created_at','updated_at','published_at','ever_published_at']::text[]
        order by row_value.id
      )
      from public.live_events row_value
      where row_value.celebrity_id = 'ca75e1e0-0000-4000-8000-000000000001'
    ), '[]'::jsonb),
    'liveEventLocalizations', coalesce((
      select jsonb_agg(
        to_jsonb(row_value) - array['created_at','updated_at']::text[]
        order by row_value.live_event_id, row_value.locale
      )
      from public.live_event_localizations row_value
      where row_value.live_event_id in (
        select live.id
        from public.live_events live
        where live.celebrity_id = 'ca75e1e0-0000-4000-8000-000000000001'
      )
    ), '[]'::jsonb),
    'benefits', coalesce((
      select jsonb_agg(
        to_jsonb(row_value)
          - array['created_at','updated_at','published_at','ever_published_at']::text[]
        order by row_value.id
      )
      from public.benefits row_value
      where row_value.celebrity_id = 'ca75e1e0-0000-4000-8000-000000000001'
    ), '[]'::jsonb),
    'benefitLocalizations', coalesce((
      select jsonb_agg(
        to_jsonb(row_value) - array['created_at','updated_at']::text[]
        order by row_value.benefit_id, row_value.locale
      )
      from public.benefit_localizations row_value
      where row_value.benefit_id in (
        select benefit.id
        from public.benefits benefit
        where benefit.celebrity_id = 'ca75e1e0-0000-4000-8000-000000000001'
      )
    ), '[]'::jsonb),
    'benefitUniqueCodes', coalesce((
      select jsonb_agg(
        to_jsonb(row_value) - 'created_at'
        order by row_value.benefit_id, row_value.code_value, row_value.id
      )
      from public.benefit_unique_codes row_value
      where row_value.benefit_id in (
        select benefit.id
        from public.benefits benefit
        where benefit.celebrity_id = 'ca75e1e0-0000-4000-8000-000000000001'
      )
    ), '[]'::jsonb)
  );
$$;

create table public.public_dataset_integrity_manifests (
  dataset_key text primary key,
  migration_name text not null,
  stored_snapshot_sha256 text not null
    check (stored_snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now()
);

insert into public.public_dataset_integrity_manifests (
  dataset_key,
  migration_name,
  stored_snapshot_sha256
)
select
  'katseye-public-v1',
  '20260726020000_katseye_public_dataset_v1.sql',
  encode(
    extensions.digest(
      public.read_katseye_public_dataset_v1_snapshot()::text,
      'sha256'
    ),
    'hex'
  );

create function public.read_katseye_public_dataset_v1_integrity()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'expectedHash', manifest.stored_snapshot_sha256,
    'actualHash', encode(
      extensions.digest(
        public.read_katseye_public_dataset_v1_snapshot()::text,
        'sha256'
      ),
      'hex'
    )
  )
  from public.public_dataset_integrity_manifests manifest
  where manifest.dataset_key = 'katseye-public-v1'
    and manifest.migration_name =
      '20260726020000_katseye_public_dataset_v1.sql';
$$;

create function public.katseye_owned_rows_snapshot(p_celebrity_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'quizAttempts', public.katseye_public_rows_snapshot(coalesce((
      select jsonb_agg(to_jsonb(row_value) order by row_value.id)
      from public.quiz_attempts row_value
      where row_value.celebrity_id = p_celebrity_id
    ), '[]'::jsonb)),
    'quizAttemptQuestions', public.katseye_public_rows_snapshot(coalesce((
      select jsonb_agg(to_jsonb(row_value) order by row_value.attempt_id, row_value.position, row_value.id)
      from public.quiz_attempt_questions row_value
      where row_value.attempt_id in (
        select attempt.id from public.quiz_attempts attempt
        where attempt.celebrity_id = p_celebrity_id
      )
    ), '[]'::jsonb)),
    'quizAttemptOptions', public.katseye_public_rows_snapshot(coalesce((
      select jsonb_agg(to_jsonb(row_value) order by row_value.attempt_question_id, row_value.position, row_value.id)
      from public.quiz_attempt_options row_value
      where row_value.attempt_question_id in (
        select question.id
        from public.quiz_attempt_questions question
        join public.quiz_attempts attempt on attempt.id = question.attempt_id
        where attempt.celebrity_id = p_celebrity_id
      )
    ), '[]'::jsonb)),
    'quizAttemptAnswers', public.katseye_public_rows_snapshot(coalesce((
      select jsonb_agg(to_jsonb(row_value) order by row_value.attempt_id, row_value.attempt_question_id)
      from public.quiz_attempt_answers row_value
      where row_value.attempt_id in (
        select attempt.id from public.quiz_attempts attempt
        where attempt.celebrity_id = p_celebrity_id
      )
    ), '[]'::jsonb)),
    'quizPasses', public.katseye_public_rows_snapshot(coalesce((
      select jsonb_agg(to_jsonb(row_value) order by row_value.id)
      from public.quiz_passes row_value
      where row_value.celebrity_id = p_celebrity_id
    ), '[]'::jsonb)),
    'fanPassports', public.katseye_public_rows_snapshot(coalesce((
      select jsonb_agg(to_jsonb(row_value) order by row_value.id)
      from public.fan_passports row_value
      where row_value.celebrity_id = p_celebrity_id
    ), '[]'::jsonb)),
    'liveReservations', public.katseye_public_rows_snapshot(coalesce((
      select jsonb_agg(to_jsonb(row_value) order by row_value.id)
      from public.live_reservations row_value
      where row_value.celebrity_id = p_celebrity_id
    ), '[]'::jsonb)),
    'liveAttendances', public.katseye_public_rows_snapshot(coalesce((
      select jsonb_agg(to_jsonb(row_value) order by row_value.id)
      from public.live_attendances row_value
      where row_value.celebrity_id = p_celebrity_id
    ), '[]'::jsonb)),
    'liveSurveyResponses', public.katseye_public_rows_snapshot(coalesce((
      select jsonb_agg(to_jsonb(row_value) order by row_value.id)
      from public.live_survey_responses row_value
      where row_value.celebrity_id = p_celebrity_id
    ), '[]'::jsonb)),
    'liveSurveyAnswers', public.katseye_public_rows_snapshot(coalesce((
      select jsonb_agg(to_jsonb(row_value) order by row_value.response_id, row_value.question_id)
      from public.live_survey_answers row_value
      where row_value.response_id in (
        select response.id from public.live_survey_responses response
        where response.celebrity_id = p_celebrity_id
      )
    ), '[]'::jsonb)),
    'liveSurveyIdempotency', public.katseye_public_rows_snapshot(coalesce((
      select jsonb_agg(to_jsonb(row_value) order by row_value.idempotency_key)
      from public.live_survey_idempotency row_value
      where row_value.live_event_id in (
        select live.id from public.live_events live
        where live.celebrity_id = p_celebrity_id
      )
    ), '[]'::jsonb)),
    'fanActivities', public.katseye_public_rows_snapshot(coalesce((
      select jsonb_agg(to_jsonb(row_value) order by row_value.id)
      from public.fan_activities row_value
      where row_value.celebrity_id = p_celebrity_id
    ), '[]'::jsonb)),
    'stamps', public.katseye_public_rows_snapshot(coalesce((
      select jsonb_agg(to_jsonb(row_value) order by row_value.id)
      from public.stamps row_value
      where row_value.celebrity_id = p_celebrity_id
    ), '[]'::jsonb)),
    'fanScoreLedger', public.katseye_public_rows_snapshot(coalesce((
      select jsonb_agg(to_jsonb(row_value) order by row_value.id)
      from public.fan_score_ledger row_value
      where row_value.celebrity_id = p_celebrity_id
    ), '[]'::jsonb)),
    'fanScoreAdjustments', public.katseye_public_rows_snapshot(coalesce((
      select jsonb_agg(to_jsonb(row_value) order by row_value.id)
      from public.fan_score_adjustments row_value
      where row_value.celebrity_id = p_celebrity_id
    ), '[]'::jsonb)),
    'benefitClaims', public.katseye_public_rows_snapshot(coalesce((
      select jsonb_agg(to_jsonb(row_value) order by row_value.id)
      from public.benefit_claims row_value
      where row_value.celebrity_id = p_celebrity_id
    ), '[]'::jsonb)),
    'benefitClaimAudits', public.katseye_public_rows_snapshot(coalesce((
      select jsonb_agg(to_jsonb(row_value) order by row_value.id)
      from public.benefit_claim_audits row_value
      where row_value.benefit_claim_id in (
        select claim.id from public.benefit_claims claim
        where claim.celebrity_id = p_celebrity_id
      )
    ), '[]'::jsonb)),
    'benefitApplications', public.katseye_public_rows_snapshot(coalesce((
      select jsonb_agg(to_jsonb(row_value) order by row_value.id)
      from public.benefit_applications row_value
      where row_value.celebrity_id = p_celebrity_id
    ), '[]'::jsonb)),
    'benefitClaimUsageEvents', public.katseye_public_rows_snapshot(coalesce((
      select jsonb_agg(to_jsonb(row_value) order by row_value.id)
      from public.benefit_claim_usage_events row_value
      where row_value.benefit_claim_id in (
        select claim.id from public.benefit_claims claim
        where claim.celebrity_id = p_celebrity_id
      )
    ), '[]'::jsonb)),
    'fanLevelEvents', public.katseye_public_rows_snapshot(coalesce((
      select jsonb_agg(to_jsonb(row_value) order by row_value.id)
      from public.fan_level_events row_value
      where row_value.celebrity_id = p_celebrity_id
    ), '[]'::jsonb)),
    'benefitEligibilityChanges', public.katseye_public_rows_snapshot(coalesce((
      select jsonb_agg(to_jsonb(row_value) order by row_value.id)
      from public.benefit_eligibility_changes row_value
      where row_value.celebrity_id = p_celebrity_id
    ), '[]'::jsonb)),
    'fanNotifications', public.katseye_public_rows_snapshot(coalesce((
      select jsonb_agg(to_jsonb(row_value) order by row_value.id)
      from public.fan_notifications row_value
      where row_value.celebrity_id = p_celebrity_id
         or row_value.live_event_id in (
           select live.id from public.live_events live
           where live.celebrity_id = p_celebrity_id
         )
         or row_value.benefit_id in (
           select benefit.id from public.benefits benefit
           where benefit.celebrity_id = p_celebrity_id
         )
    ), '[]'::jsonb)),
    'notificationDeliveryOutbox', public.katseye_public_rows_snapshot(coalesce((
      select jsonb_agg(to_jsonb(row_value) order by row_value.id)
      from public.notification_delivery_outbox row_value
      where row_value.notification_id in (
        select notification.id
        from public.fan_notifications notification
        where notification.celebrity_id = p_celebrity_id
           or notification.live_event_id in (
             select live.id from public.live_events live
             where live.celebrity_id = p_celebrity_id
           )
           or notification.benefit_id in (
             select benefit.id from public.benefits benefit
             where benefit.celebrity_id = p_celebrity_id
           )
      )
    ), '[]'::jsonb))
  );
$$;

-- Archive all public KARA children before their parents. One RPC invocation is
-- one PostgreSQL statement/transaction: any actor, dependency, revision, or
-- preservation failure rolls the entire archive back.
create function public.archive_kara_public_dataset_v1(
  p_actor_app_user_id uuid,
  p_actor_admin_allowlist_id uuid,
  p_correlation_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kara_id constant uuid := '4b415241-0000-4000-8000-000000000001';
  v_nualeaf_id constant uuid := '4e55414c-4541-4600-8000-000000000001';
  v_before jsonb;
  v_after jsonb;
  v_kara public.celebrities%rowtype;
  v_nualeaf public.brands%rowtype;
  v_live record;
  v_survey record;
  v_notice record;
  v_benefit record;
  v_quiz record;
  v_surveys integer := 0;
  v_notices integer := 0;
  v_benefits integer := 0;
  v_lives integer := 0;
  v_quizzes integer := 0;
  v_nualeaf_archived boolean := false;
  v_kara_archived boolean := false;
begin
  if p_correlation_id is null then
    raise exception 'KATSEYE archive correlation id is required';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 10 then
    raise exception 'KATSEYE archive reason is required';
  end if;

  perform public.assert_active_admin(
    p_actor_app_user_id,
    p_actor_admin_allowlist_id,
    true
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('katseye:archive:kara-nualeaf:v1', 0)
  );

  select *
  into v_kara
  from public.celebrities
  where id = v_kara_id and slug = 'kara'
  for update;
  if not found then
    raise exception 'KARA stable celebrity not found';
  end if;

  if exists (
    select 1 from public.brands
    where (id = v_nualeaf_id or slug = 'nualeaf')
      and not (id = v_nualeaf_id and slug = 'nualeaf')
  ) then
    raise exception 'NUALEAF stable brand mismatch';
  end if;

  v_before := public.katseye_owned_rows_snapshot(v_kara_id);

  for v_live in
    select id
    from public.live_events
    where celebrity_id = v_kara_id
    order by id
    for update
  loop
    for v_survey in
      select id, live_event_id, lifecycle_status, revision
      from public.live_surveys
      where live_event_id = v_live.id
        and lifecycle_status <> 'archived'
      order by id
      for update
    loop
      if v_survey.lifecycle_status = 'published' then
        perform public.admin_write_live_survey(
          p_actor_app_user_id,
          p_actor_admin_allowlist_id,
          v_survey.live_event_id,
          'close',
          jsonb_build_object(
            'surveyId', v_survey.id,
            'expectedRevision', v_survey.revision
          ),
          p_correlation_id
        );
        select id, live_event_id, lifecycle_status, revision
        into v_survey
        from public.live_surveys
        where id = v_survey.id;
      end if;
      if v_survey.lifecycle_status in ('draft', 'closed') then
        perform public.admin_write_live_survey(
          p_actor_app_user_id,
          p_actor_admin_allowlist_id,
          v_survey.live_event_id,
          'archive',
          jsonb_build_object(
            'surveyId', v_survey.id,
            'expectedRevision', v_survey.revision
          ),
          p_correlation_id
        );
        v_surveys := v_surveys + 1;
      end if;
    end loop;
  end loop;

  for v_notice in
    select id, revision
    from public.celebrity_notices
    where celebrity_id = v_kara_id and archived_at is null
    order by id
    for update
  loop
    perform public.set_admin_celebrity_notice_state(
      p_actor_app_user_id,
      p_actor_admin_allowlist_id,
      p_correlation_id,
      v_notice.id,
      v_notice.revision,
      'archive',
      p_reason
    );
    v_notices := v_notices + 1;
  end loop;

  for v_benefit in
    select id, revision
    from public.benefits
    where celebrity_id = v_kara_id and archived_at is null
    order by id
    for update
  loop
    perform public.set_admin_benefit_state(
      p_actor_app_user_id,
      p_actor_admin_allowlist_id,
      p_correlation_id,
      v_benefit.id,
      v_benefit.revision,
      'archive',
      p_reason
    );
    v_benefits := v_benefits + 1;
  end loop;

  for v_quiz in
    select id
    from public.celebrity_quizzes
    where celebrity_id = v_kara_id and status = 'published'
    order by id
    for update
  loop
    update public.celebrity_quizzes
    set status = 'draft'
    where id = v_quiz.id and status = 'published';
    insert into public.audit_logs (
      actor_app_user_id,
      actor_admin_allowlist_id,
      action,
      entity_type,
      entity_id,
      correlation_id,
      before_after_summary
    ) values (
      p_actor_app_user_id,
      p_actor_admin_allowlist_id,
      'quiz.version.retired_for_public_archive',
      'celebrity_quiz',
      v_quiz.id::text,
      p_correlation_id,
      jsonb_build_object(
        'beforeStatus', 'published',
        'afterStatus', 'draft',
        'reason', p_reason
      )
    );
    v_quizzes := v_quizzes + 1;
  end loop;

  for v_live in
    select id
    from public.live_events
    where celebrity_id = v_kara_id and archived_at is null
    order by id
    for update
  loop
    perform public.archive_admin_content(
      'live_event',
      v_live.id,
      p_actor_admin_allowlist_id,
      p_reason,
      p_correlation_id
    );
    v_lives := v_lives + 1;
  end loop;

  select *
  into v_nualeaf
  from public.brands
  where id = v_nualeaf_id and slug = 'nualeaf'
  for update;
  if found and v_nualeaf.archived_at is null then
    if exists (
      select 1 from public.live_events
      where brand_id = v_nualeaf_id and archived_at is null
    ) then
      raise exception 'NUALEAF has active LIVE dependencies';
    end if;
    perform public.archive_admin_content(
      'brand',
      v_nualeaf_id,
      p_actor_admin_allowlist_id,
      p_reason,
      p_correlation_id
    );
    v_nualeaf_archived := true;
  end if;

  if v_kara.archived_at is null then
    perform public.archive_admin_content(
      'celebrity',
      v_kara_id,
      p_actor_admin_allowlist_id,
      p_reason,
      p_correlation_id
    );
    v_kara_archived := true;
  end if;

  v_after := public.katseye_owned_rows_snapshot(v_kara_id);
  if v_after is distinct from v_before then
    raise exception 'KARA_OWNERSHIP_MUTATED';
  end if;

  return jsonb_build_object(
    'ok', true,
    'command', 'archive',
    'datasetKey', 'katseye-public-v1',
    'correlationId', p_correlation_id,
    'archived', jsonb_build_object(
      'surveys', v_surveys,
      'notices', v_notices,
      'benefits', v_benefits,
      'lives', v_lives,
      'quizzes', v_quizzes,
      'nualeaf', v_nualeaf_archived,
      'kara', v_kara_archived
    ),
    'preservedKaraOwnership', v_after
  );
end;
$$;

revoke all on function public.katseye_public_rows_snapshot(jsonb)
  from public, anon, authenticated;
revoke all on function public.read_katseye_public_dataset_v1_snapshot()
  from public, anon, authenticated;
revoke all on function public.read_katseye_public_dataset_v1_integrity()
  from public, anon, authenticated;
revoke all on function public.katseye_owned_rows_snapshot(uuid)
  from public, anon, authenticated;
revoke all on function public.archive_kara_public_dataset_v1(uuid, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.read_katseye_public_dataset_v1_snapshot()
  to service_role;
grant execute on function public.read_katseye_public_dataset_v1_integrity()
  to service_role;
grant execute on function public.archive_kara_public_dataset_v1(uuid, uuid, uuid, text)
  to service_role;
revoke all on table public.public_dataset_integrity_manifests
  from public, anon, authenticated, service_role;
alter table public.public_dataset_integrity_manifests enable row level security;
alter table public.public_dataset_integrity_manifests force row level security;

-- Prove this migration cannot create personal fan-owned records.
do $verify$
declare
  v_celebrity_id constant uuid := 'ca75e1e0-0000-4000-8000-000000000001';
begin
  if (
    select manifest.stored_snapshot_sha256
    from public.public_dataset_integrity_manifests manifest
    where manifest.dataset_key = 'katseye-public-v1'
  ) is distinct from encode(
    extensions.digest(
      public.read_katseye_public_dataset_v1_snapshot()::text,
      'sha256'
    ),
    'hex'
  ) then
    raise exception 'KATSEYE stored dataset snapshot mismatch';
  end if;
  if (select count(*) from public.celebrity_quiz_questions where quiz_id = 'ca75e1e0-0000-4000-8000-000000000002') <> 6 then
    raise exception 'KATSEYE dataset requires exactly 6 quiz questions';
  end if;
  if exists (
    select 1
    from public.celebrity_quiz_questions question
    where question.quiz_id = 'ca75e1e0-0000-4000-8000-000000000002'
      and (
        (select count(*) from public.celebrity_quiz_options option where option.question_id = question.id and option.active) <> 4
        or (select count(*) from public.celebrity_quiz_options option where option.question_id = question.id and option.active and option.is_correct) <> 1
      )
  ) then
    raise exception 'KATSEYE quiz questions require four options and one correct answer';
  end if;
  if (select count(*) from public.celebrity_notices where celebrity_id = v_celebrity_id and publication_status = 'published') <> 3 then
    raise exception 'KATSEYE dataset requires exactly 3 published notices';
  end if;
  if (select count(*) from public.live_events where celebrity_id = v_celebrity_id and publication_status = 'published') <> 3 then
    raise exception 'KATSEYE dataset requires exactly 3 published LIVE rows';
  end if;
  if (select count(*) from public.benefits where celebrity_id = v_celebrity_id and publication_status = 'published') <> 4 then
    raise exception 'KATSEYE dataset requires exactly 4 published benefits';
  end if;
  if (select count(*) from public.fan_passports where celebrity_id = v_celebrity_id) <> 0
     or (select count(*) from public.quiz_attempts where celebrity_id = v_celebrity_id) <> 0
     or (select count(*) from public.live_reservations where celebrity_id = v_celebrity_id) <> 0
     or (select count(*) from public.live_attendances where celebrity_id = v_celebrity_id) <> 0
     or (select count(*) from public.live_survey_responses where celebrity_id = v_celebrity_id) <> 0
     or (select count(*) from public.fan_activities where celebrity_id = v_celebrity_id) <> 0
     or (select count(*) from public.stamps where celebrity_id = v_celebrity_id) <> 0
     or (select count(*) from public.fan_score_ledger where celebrity_id = v_celebrity_id) <> 0
     or (select count(*) from public.fan_score_adjustments where celebrity_id = v_celebrity_id) <> 0
     or (select count(*) from public.benefit_claims where celebrity_id = v_celebrity_id) <> 0
     or (select count(*) from public.benefit_applications where celebrity_id = v_celebrity_id) <> 0
     or (
       select count(*)
       from public.live_survey_answers answer
       where answer.response_id in (
         select response.id
         from public.live_survey_responses response
         where response.celebrity_id = v_celebrity_id
       )
     ) <> 0
     or (
       select count(*)
       from public.live_survey_idempotency idempotency
       where idempotency.live_event_id in (
         select live.id
         from public.live_events live
         where live.celebrity_id = v_celebrity_id
       )
     ) <> 0
     or (
       select count(*)
       from public.benefit_claim_audits audit
       where audit.benefit_claim_id in (
         select claim.id
         from public.benefit_claims claim
         where claim.celebrity_id = v_celebrity_id
       )
     ) <> 0
     or (
       select count(*)
       from public.benefit_claim_usage_events usage
       where usage.benefit_claim_id in (
         select claim.id
         from public.benefit_claims claim
         where claim.celebrity_id = v_celebrity_id
       )
     ) <> 0
     or (
       select count(*)
       from public.fan_notifications notification
       where notification.celebrity_id = v_celebrity_id
          or notification.live_event_id in (
            select live.id from public.live_events live
            where live.celebrity_id = v_celebrity_id
          )
          or notification.benefit_id in (
            select benefit.id from public.benefits benefit
            where benefit.celebrity_id = v_celebrity_id
          )
     ) <> 0
     or (
       select count(*)
       from public.notification_delivery_outbox delivery
       where delivery.notification_id in (
         select notification.id
         from public.fan_notifications notification
         where notification.celebrity_id = v_celebrity_id
            or notification.live_event_id in (
              select live.id from public.live_events live
              where live.celebrity_id = v_celebrity_id
            )
            or notification.benefit_id in (
              select benefit.id from public.benefits benefit
              where benefit.celebrity_id = v_celebrity_id
            )
       )
     ) <> 0 then
    raise exception 'KATSEYE public dataset must not create fan-owned records';
  end if;
end
$verify$;

notify pgrst, 'reload schema';

commit;
