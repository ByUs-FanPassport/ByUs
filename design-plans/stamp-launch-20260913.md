# 신규 스탬프 7종 — 구현 및 검증 체크포인트

원본: [ByUs Mastersheet / Stamp](https://docs.google.com/spreadsheets/d/1KV_omPNIOpomiKF4oTrIqtoYQP1Xkfkv0HXQ-mtd6G8/edit#gid=1685842069)

2026-09-13 확인. 사용자 승인 범위: 구현 난도순 우선순위, 실제 화면 벤치마킹, Imagen 도장 애셋, 구현, 로컬 검증, 커밋/푸시/배포. 7종의 실제 구현이 완료된 기록이 아니다.

## 현재 근거와 우선순위

작업 시작 HEAD `cd65ac4`; 구현 기반은 최신 main `47636f7`, 작업 브랜치 `codex/stamp-launch-20260913`. 후속 main의 Instagram 수정은 배포 전 통합한다.

| 순서 | 종류 | 재사용 가능한 구현 | 추가로 필요한 범위 |
| --- | --- | --- | --- |
| 1 | 첫 댓글 | `post_celebrity_notice_comment`, `celebrity_notice_comments`, 댓글 UUID 중복 방지 | 최초 댓글 보상, 원자적 지급, 최애별 1회 기준 |
| 2 | 공유하기 | `components/notice/notice-share.tsx`의 Web Share / 링크 복사 | 패스포트 공유, 실제 지급 기준. 공유 API 호출/복사는 SNS 게시 완료의 증거가 아님 |
| 3 | 출첵 | 최애 캘린더, 기존 LIVE 참석의 원자적 지급 패턴 | LIVE 참석과 분리된 일일 출석 API 및 날짜별 중복 방지 |
| 4 | 가입기념 | Privy session sync 및 지갑 생성 | 계정 1회 스탬프 저장/표시. 현재 스탬프는 최애·패스포트 필수 |
| 5 | 친구초대 | 기존 사용자 식별 | 코드 생성·입력·귀속, 자기초대 차단, 양쪽 원자적 보상, 중복/동시성 방지 |
| 6 | 구독인증 | 크리에이터 Instagram 계정 연결만 존재 | 팬의 YouTube/Instagram 구독 증명 수집·검증. 크리에이터 OAuth는 팬 구독 증거가 아님 |
| 7 | 틱톡 후원 | 외부 LIVE URL/콘텐츠 | 팬과 실제 후원 거래를 연결할 인증 근거, 재사용/중복 지급 방지 |

첫 댓글 최애별 1회, 일일 출첵 최애별 한국시간 1일 1회는 작업 가정이며 운영 확정 정책으로 기록하지 않는다. 가입기념은 원본의 가입+지갑 생성 조건을 유지한다.

## 공통 구조

- `apps/web/features/passport/domain/passport-read-model.ts`: knowledge/reservation/attendance/survey 4종 enum·메타데이터·summary.
- `supabase/migrations/20260721053000_g3_stamp_activity_generalization.sql`: activity/source 소유권, stamp/activity type 일치, 발급 payload 검증.
- `supabase/migrations/20260721054500_g4_passport_stamp_read_models.sql`: 소유자 전용 collection/detail RPC.
- `apps/web/features/passport/ui/passport-stamp-artwork.tsx`: 현재 Lucide/CSS 도장. Imagen 원본 자산 렌더링 경로 추가 필요.
- `apps/worker/src/domain.ts`: blockchain job type도 4종으로 제한. 웹만 확장하고 worker를 그대로 배포하면 안 됨.
- `first_reaction_stamps`는 독립 발급된 반응 기록을 패스포트에 연결하는 기존 예외로, 신규 스탬프용 발급 완료 우회로 사용하지 않는다.

## 디자인 및 애셋

- UI Skills 공식 registry `jakubkrehel/better-ui` 사용. 기존 DESIGN.md의 흰 배경, Pretendard, 중립 구조, 단일 주요 분홍/보라 CTA, 44px 타깃, reduced-motion 유지.
- 수집 도장, 획득 상태, 구체적인 다음 행동을 함께 보여주되 미획득 항목을 획득 기록처럼 표시하지 않는다.
- 도장은 신규 7종 의미가 구분되는 동일 계열의 Imagen 자산으로 제작. 기존 4종 변경은 필수가 아니며 별도 범위 확장을 피한다.
- 공식 레퍼런스는 Starbucks Rewards와 Duolingo의 실제 화면을 포함한 공식 소개 이미지 4장. 주 에이전트가 이미지를 대조해 벤치마킹 메모의 과장된 관찰을 교정함. 결과 경로: `artifacts/stamp-launch-20260913/benchmark/`.

## 현재 선행 조건

1. 사용자 “그냥 기본 이미젠으로 해줘”에 따라 기본 OpenAI image_gen 사용. 7종 생성 완료, 투명 512px PNG를 `apps/web/public/images/community-stamps/`에 저장. 원본·프롬프트는 artifacts와 provenance.json에 기록.
2. 사용자 확정: 구독/후원은 **외부 자동 인증 연동을 준비한 뒤 공개**. 수동 심사로 대체하지 않으며, 자동 인증 완료 전에는 지급 기능을 공개하지 않는다. 기존 5종 구현과 분리하되 이 2종의 자동 인증 준비도 전체 목표에 남긴다.
3. 공유의 원본 'SNS 공유 완료'를 단순 링크 복사로 낮추지 않음. 지원 가능한 증거에 맞는 정책 필요.

자동 인증 준비의 공식 원문 확인(2026-09-13):
- [YouTube subscriptions.list](https://developers.google.com/youtube/v3/docs/subscriptions/list)는 인증된 사용자의 `mine=true` 구독 목록과 `forChannelId` 필터를 제공한다. ByUs의 현재 Google 로그인만으로 해당 API 권한이 있다고 가정하지 않는다.
- [TikTok 공개 Webhook Events](https://developers.tiktok.com/docs/en/webhooks-events)에는 인증 해제, 영상 업로드 실패/게시 완료, portability 다운로드 준비가 기재되어 있다. 이 문서에서는 LIVE 후원 이벤트를 확인하지 못했다. 별도 파트너 연동 가능성까지 불가능하다고 단정하지 않는다.
- Instagram 팬 팔로우 자동 확인은 이 체크포인트에서 공식 원문 확인 미완료.

## 완료 체크

- [x] 원본 목록과 코드의 4종 제한 대조, 난도순 우선순위
- [x] 공식 화면 이미지 4장 및 출처를 확인한 벤치마킹
- [x] Imagen 7종 원본·최적화본·출처/프롬프트 기록
- [x] 공통 발급 및 소유자 조회·worker 일관성
- [ ] 각 7종 사용자 경로와 지급 조건
- [ ] 허용되지 않은 소유권, 중복·동시 요청, 재시도, 외부 미검증 지급 방지 검증
- [ ] 대상 unit/route/SQL 검증과 필수 typecheck/lint/build
- [ ] 로컬 KO/EN 모바일/데스크톱 실제 렌더 및 필요한 동작, 키보드/reduced-motion/오류 상태 확인
- [ ] 승인 범위 커밋/푸시 및 해당 커밋의 자동 배포 시작 확인. 직접 배포 명령을 쓰면 최종 성공/실패 확인

## 구현 중간 검증 (2026-09-13)

- 별도 `community_stamps` ledger: 계정 welcome/invite, 최애 first_comment/daily_checkin. 댓글 두 경로 및 지갑/session sync recovery, 초대 양쪽 원자지급, KST 일일 중복 방지. 구독/후원/공유는 증거 준비 전 서버 deny.
- Worker 새 `community_stamp` capability opt-in, 기존 ERC1155 발급·복구. 전체 529 tests/typecheck/build PASS.
- Web owner-only route/domain 19 tests PASS; 기존 MY/Passport 50 tests PASS. MY/Passport 수집목록 및 캘린더 출석 통합.
- DB clean158 migrations+신규 behavior 및 기존 전체 backend security PASS. 교차검토로 invitee redeemed boolean, tokenId string projection, 자정 source/issuedAt 정합성을 수정하고 clean replay+behavior 재통과.
- Web typecheck/lint/build PASS. 이후 출석 중복 클릭 guard와 테스트 수정의 영향 검증 중. localhost 실제 production component/CSS + synthetic auth/API에서 KO/EN360/1440 렌더, 모달 Escape, 복사 미지급, axe PASS. 근거 `test-results/community-stamps-local/`. 실제 계정/온체인/운영 증거 아님.
- 운영 DB 마지막 migration `20260912152008` 확인. 운영 변경/배포는 아직 하지 않음.
- 공유 기준 질문 pending: 기기 공유창 완료반환 지급 vs 실제 SNS 게시 인증. 답변 전 공개·지급 없음.
