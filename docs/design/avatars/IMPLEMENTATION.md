# 프로필 이미지 구현 및 검증 — 2026-09-06

## 구현

- 별·하트·요정·유령 × 크림·핑크·라벤더 12종. 계정별 최초 균등 랜덤 배정을 DB에 영구 보관한다. 가입 단계는 추가하지 않는다.
- 설정에서 캐릭터 선택과 JPEG·PNG·WebP(4MiB 이하) 업로드, 위치·확대 편집, 삭제를 지원한다. MY에서 같은 상태를 사용한다.
- 서버에서 EXIF 방향 보정 후 지정 영역을 512×512 WebP로 변환한다. 비공개 fan-avatars 버킷에서 본인 인증을 거쳐 Blob으로 표시한다.
- 최초 캐릭터와 현재 선택을 분리한다. 사진 삭제는 최초 캐릭터로 복귀하며 Google 재가져오기를 차단한다.
- Google OAuth grant는 메모리에 최대 60초만 보관한다. 로그인 동기화 뒤 서버에서 연결 계정 subject를 대조하고 기본 상태인 계정에만 사진을 적용한다.
- 변경 버전 비교와 불변 파일 경로를 사용한다. 계정 변경 시 요청·이미지를 정리하고, 저장 실패 시 편집 내용을 보존한다.

## 검증 결과

- 관련 단위·컴포넌트 테스트 13개 파일, 106개 테스트 통과.
- TypeScript, 변경된 TS/TSX ESLint, git diff --check 통과.
- 깨끗한 DB에 전체 기존 마이그레이션 124개 순서대로 적용 후 avatar_contract.sql 통과. 12개 동시 최초 배정 요청과 같은 버전의 동시 변경 검증 통과.
- Chromium 모바일(390×844), 데스크톱(1440×844), WebKit 모바일(390×844)에서 실제 설정·MY 컴포넌트를 테스트 응답과 연결해 검증했다. 캐릭터 선택/취소, EXIF 사진 편집, 확대, 저장 실패 후 재시도, 삭제 후 최초 캐릭터 복귀, 가로 넘침 없음과 페이지 오류 없음 확인.
- UI 테스트 응답은 업로드 파일을 그대로 반환한다. 최종 서버 크롭의 픽셀 정확도·EXIF 보정은 별도 서버 테스트로 검증했다. 위 렌더링 검증은 실제 인증 API 검증을 뜻하지 않는다.
- 12종을 32·64·128px 원형으로 비교해 가독성과 잘림을 확인했다. 원본과 WebP 목록은 README.md와 catalog.png 참조.

## 적용 범위 및 남은 외부 조건

- 개발 Supabase xcppyedwusirqnfpbtit에 아바타 마이그레이션 20260906130000만 적용했다. 테이블 및 버킷 생성, 비공개 설정, 4MiB 제한, WebP 제한, 익명 조회/브라우저 역할 RPC 차단을 실제 조회로 확인했다.
- 개발 Privy cmrtb8b7z002w0cjsyo5it6g6의 Google 사용은 활성화되어 있으나 자체 OAuth client ID/secret은 비어 있고 OAuth 토큰 반환은 꺼져 있다. ByUs용 Google Cloud 프로젝트/인증 정보가 있어야 실제 Google 사진 자동 가져오기를 검증할 수 있다. 사용자에게 프로젝트 식별 정보를 요청한 상태다.
- 운영 설정·운영 DB·배포·푸시는 진행하지 않았다. 구현 및 검증 결과는 사용자 요청에 따라 커밋에 포함한다.

## 근거

- `artifacts/avatar-verification-20260906/database.log`
- `artifacts/avatar-verification-20260906/verify-concurrency.sh`
- `artifacts/avatar-verification-20260906/verify-dev.sql`
- `artifacts/avatar-verification-20260906/visual-check.mjs`
- 동일 폴더의 `chromium-mobile-*`, `chromium-desktop-*`, `webkit-mobile-*` 스크린샷

## 실제 개발 계정 검증

허용된 localhost:5173에서 Google 로그인 완료 후 실제 개발 계정으로 설정 화면을 열었다. 최초 크림 별에서 핑크 별로 변경하고 다시 편집 창을 열어 선택 유지 확인. EXIF 6 방향 정보가 있는 테스트 JPEG 업로드와 저장 성공 후 사진 삭제 컨트롤 표시를 확인하고 삭제했다.

삭제 후 개발 DB 조회 결과는 최초/현재 캐릭터 모두 `star-cream`, 출처 `removed`, revision 4, 사진 경로 없음이었다. `fan-avatars`의 남은 사진 객체도 0개여서 업로드 후 삭제 정리를 확인했다. 브라우저 자동화 연결 오류 때문에 실제 계정의 마지막 새로고침·MY 화면 캡처는 완료하지 못했다. MY의 모바일·데스크톱 표시는 앞서 기록한 테스트 응답 기반 검증에 한정한다. Google 로그인 성공이 Google 사진 자동 가져오기 성공을 의미하지는 않는다.
