# 셀럽 홍보 안내

승인된 `byus.pen` PC `w4vIV`, 모바일 `hHEfm`, 선택창 `uWv4Q`/`J0k40p`를 `/bias/promotion`으로 구현한다. 대상은 모든 셀럽이며 크리에이터 역할로 제한하지 않는다. 이퓨 100일 사례 카드는 제외한다.

## 동작과 경로

- `/bias`는 현재 홍보 안내로 이동한다. 후속 안내가 늘어나면 이 경로를 가이드 홈으로 확장한다.
- `/bias/promotion?celebrity=elina&locale=ko`처럼 공개 핸들을 지정하면 해당 프로필을 선택한다. 미지정 시 본인을 선택하며 같은 탭의 선택을 유지한다. 알 수 없는 핸들은 다른 프로필로 대체하지 않는다.
- 원형 프로필 바로가기는 PC 8개, 모바일 3개다. 전체 검색은 모든 공개 이름·핸들을 대상으로 하며 선택창은 PC 12명, 모바일 9명씩 표시한다.
- 정식 팬페이지 주소와 상시·프로필·스토리·라이브 문구를 복사한다. 성공과 실패를 구분하며 실패 시 화면의 문구를 직접 선택할 수 있다.
- 셀럽 선택은 문구 개인화용이다. 본인 인증이나 계정 연결 권한으로 사용하지 않는다.
- `/bias/instagram`은 기존 `/connect/instagram`으로 이동한다. 기존 인증·OAuth·관리 흐름은 보존한다. 이벤트 문의는 기존 비로그인 팬 활동 상담 창을 사용한다.
- `bias`는 TS/DB 예약 핸들로 추가한다. 기존 레코드는 변경하지 않으며 충돌이 있으면 마이그레이션이 중단된다. 대응 rollback을 보존한다.

## 증가하는 명단

공개 목록은 `display_order, slug` 정렬로 500행씩 누적 조회한다. 이미지 RPC는 전체 slug를 검증·중복 제거한 뒤 200개씩 조회한다. 어느 페이지/청크든 실패하면 부분 명단을 정상 결과로 표시하지 않는다.

## 검증

- `npm run test --workspace @byus/web -- features/bias features/creator/domain/creator-navigation.test.ts server/content server/media/public-image-reader.test.ts`
- `npm run typecheck`, `npm run lint`
- `node scripts/verify-bias-promotion-local.mjs --build`: 실제 Next 빌드 + 로컬 공개 fixture만 사용. PC 1440px, 모바일 390px, KO/EN, 복사 5종, 실패 피드백, 검색·선택·재접속·언어 변경, Escape와 초점 복귀, 1,001명 검색/페이지 이동, 빈 목록/조회 장애를 확인한다. SNS 게시나 문의 전송은 하지 않는다.
- `npm run build --workspace @byus/worker` 후 `npm run security:backend-db`: 최신 main의 177개 마이그레이션과 통합 행동 검증 통과. 새 bias 거부 검사를 기존 검증 스크립트에 포함한다. 별도 bias rollback 검증도 통과했다.
- 리뷰의 1,000행 제한 지적을 수정했고 후속 검토에서 차단 사항 없음. 실제 화면 검증은 로컬 브라우저이며 실기기/운영 인증 증거가 아니다.

검증 로그와 PNG는 `work/bias-*`에 보존한다. 사용자가 구현·main push를 승인했으며 푸시 후 자동 배포 시작을 확인한다.
