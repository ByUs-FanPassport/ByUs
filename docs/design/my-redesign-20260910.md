# MY 개편 — 슬라이드 58 기준

## 승인 범위와 출처
- 사용자는 현재 MY를 Pen에 옮긴 뒤, Google Slides 실제58페이지(화면번호46)를 반영해 예쁘게 Pen에서 먼저 만들고 운영 페이지에 반영하도록 명시적으로 승인했다.
- 출처: https://docs.google.com/presentation/d/18WPDWS_nkWrkylcqVHh5Spzp6OiFoaW9fmM37ZsXEB4/edit#slide=id.g3fa48f4c78c_0_1
- 요구: 최애별 회원등급(명예/휘장)과 이벤트 응모권(혜택)을 주요 정보로 표시. 현재 상태·다음 목표·미션을 직관적으로 보여주고 관련 행동 페이지로 한번에 이동.
- 원본 Pen Eaoi9 보존. 새 디자인 PC1440/모바일390 제작 → UI 구현 → 테스트/시각/행동 확인 → 커밋·푸시·운영 배포·로그인 실화면 확인.

## 디자인 계약
- 기존 ByUs White/Pretendard/핑크 포인트/공유 헤더·푸터 유지. 사용자 아바타는 실제 기존 캐릭터, 셀럽은 실제 이미지, 휘장은 사용자 프로필과 구분.
- 헤더: 아바타·닉네임·알림·설정. 임의 최고등급을 대표 선택으로 부르지 않는다. 이번에는 대표 선택 저장 기능을 신설하지 않으며 최애별 실제 휘장을 성장 패널에 표시한다.
- 내 최애 선택: 사진·이름을 갖춘 선택 버튼, 작은 현재 등급/응모권 요약. 하나의 선택 상태가 등급·티켓·미션·혜택을 함께 제어한다. 선택 자체는 대표 휘장 설정이 아니다.
- 핵심 두 패널: 나의 팬등급(메달, 현재 등급, 실제 팬점수/다음 등급 기준, 진행바, 남은 점수, 패스포트 기록 링크) / 이벤트 응모권(선택 셀럽 이름, 큰 잔액, 진행중 래플 경품 미리보기와 상세 링크).
- 응모권 잔액에 임의 목표치나 당첨확률 진행바를 붙이지 않는다. 래플은 추첨임을 표시. 소진은 등급 하락과 별개.
- 다음 행동: 서버에서 조회한 인증/미션 중 available이며 현재 사용자 승인완료/검토중이 아닌 항목을 우선. 소유 Passport의 quiz는 제외. 실제 reward 표시, manual은 승인후 지급. 없을 때는 새 미션 없음 + 해당 셀럽 LIVE 일정으로 안내.
- 기존 예약 LIVE, 최근활동, 받은혜택과 컬렉션/설정 링크 유지하되 핵심 패널 아래로 배치. 모바일은 같은 순서 한열, 버튼44px이상, 가로넘침없음.

## 구현 범위
- 기존 strict MY summary 및 DB 정책 유지. 새 DB 스키마나 점수/티켓 지급변경 없음.
- 등급은 summary.passport.tier가 권위. next tier는 FAN_TIERS 순서, next threshold=score+remainingToNextTier, 최고등급은 완료상태. 점수로 attained tier를 재판정하지 않는다.
- 선택 셀럽만 public raffles/certifications, owned certification history를 기존 hook+schema로 읽는다. 쿼리는 abort/선택키/소유자키로 격리. 프리뷰는 최대1개, 원래 목록/상세로 직접 이동.
- 기존 MyBenefitProgress를 선택된 Passport와 연동하고 eligibility/선정상태/점수외조건을 보존. reward empty/loading/error는 구분.
- first_reaction_only는 등급을 꾸며내지 않고 팬 인증/패스포트 시작으로 연결.
- Header 자동 최고등급 badge는 제거하여 선택한 대표 휘장으로 잘못 표현하지 않는다. 프로필 수정/알림/설정은 그대로.
- 파일 소유: 주 에이전트 Pen/문서/통합/검증; 구현 에이전트 features/my UI/domain/tests, 필요 e2e fixture만. 별도 worktree codex/my-redesign-20260910 (a8fc08c 기반), 기존 next-env 변경 보존.

## 검증
- 시작 baseline MY8파일39테스트 PASS.
- 등급 경계/최고등급/first reaction/최애전환, 계정전환과 stale요청, tickets별 잔액, raffle status와일정, history완료/검토/반려, 오류/빈상태, 한영 카피·링크의 실제 연결 검증.
- scoped Vitest → typecheck/lint/build → PC/모바일 렌더·키보드·셀렉터·목표/미션/래플 링크 확인. 거래/응모/프로필변경은 실제 QA에서 제출하지 않음.
- 깨끗한 배포소스로 Vercel Ready+byus.kr 별칭/실제 로그인MY 확인. Preview/fixture 결과와 실계정 결과 구분.

## 진행
- [x] 슬라이드58 본문과실제 화면 확인
- [x] 현재MY원본 Pen저장 및시작 상태/데이터계약 확인
- [x] Pen PC/모바일 디자인 및렌더확인 — z13Lhc / d2JCW7 저장, PNG 직접 확인
- [x] 계획 독립 검토 — 아래 래플/미션 선별 보완 반영
- [x] 구현·단위검증 — MY46테스트·타입·전체lint·운영빌드 통과
- [x] 렌더/동작검증 및결과리뷰 — 한영14렌더·키보드/링크·axe·독립 리뷰 완료
- [x] 커밋·푸시 — 4910aff main 반영
- [ ] 운영배포·로그인 실화면 확인 — Vercel 기존CLI Viewer, 브라우저Owner 기기인증 버튼 비활성으로 중단. 상세 보고서 참조.

## 독립 검토 반영
- 래플: status=open, benefitId 존재, 실제 시작/종료 시각 유효 조건을 모두 만족. 가까운 마감 우선, 동률은 안정된 ID 정렬. 없으면 현재 열려 있는 래플 없음으로 표현.
- 인증 이력: (kind, missionId)별 submittedAt 최신 한 건만 판정하고 동률은 안정된 키 사용. pending/approved 제외, rejected는 public available일 때만 재도전. Passport 보유자의 quiz 제외. public+owned 둘 다 준비되어야 추천하고 조회 실패를 빈 상태로 바꾸지 않는다.
- 필수 사례: 래플 상태 혼합/null benefitId/시간 경계, rejected→pending / rejected→approved / rejected only, 최애와 계정 전환 지연응답.
- 디자인 PNG: preview/my-redesign-20260910/z13Lhc.png (PC), d2JCW7.png (Mobile). 실제 Jewel_KAT 데이터 중 엘리나 선택 상태. 기준 너비1120/패널gap24/padding24, 모바일350/padding20, border #E8E7EC/radius20, 진행바/선택 강조 #E52D81, 작은 강조 글자와 흰 글자 CTA #D51F73 (흰색 대비4.91:1). 실제 앱 공통 모바일 내비게이션은 유지.
