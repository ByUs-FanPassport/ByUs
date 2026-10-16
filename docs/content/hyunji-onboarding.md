# 현지 팬페이지

2026-10-16 확인. 공개 경로는 `/hyunji`, 이름은 현지 / Hyunji, 대표 역할은 크리에이터다. Instagram만 등록하며, 확인되지 않은 경력·LIVE 일정·팬덤명·상품·보상 정책은 추가하지 않는다.

## 공개 출처

- 계정: [@hyunjiiee](https://www.instagram.com/hyunjiiee/). 프로필 이름은 `현 지`다. 팔로워 수를 kyaa 팬 수로 옮기지 않는다.
- 사진 1: [햇빛 속 인물 사진](https://www.instagram.com/hyunjiiee/p/Dbim6SJHbWp/)
- 사진 2: [창가 사진](https://www.instagram.com/hyunjiiee/p/DW1Rhddge_k/). 대표 이미지와 프로필에 사용한다.
- 사진 3: [이어폰을 낀 사진](https://www.instagram.com/hyunjiiee/p/DSUbIacAWnm/)
- 사진 4: [손에 턱을 괸 사진](https://www.instagram.com/hyunjiiee/p/DZVHNeNAVRV/)
- 사진 5: [장미 앞 사진](https://www.instagram.com/hyunjiiee/p/DZIFtbyAWtK/)
- 사진 6: [꽃다발과 함께 찍은 사진](https://www.instagram.com/hyunjiiee/p/DUixYKiAW-_/)
- 사진 7: [옆모습 사진](https://www.instagram.com/hyunjiiee/p/DTdRtmAgQBu/)
- 사진 8: [흰 꽃다발 사진](https://www.instagram.com/hyunjiiee/p/DFxtkRJS3rw/). 확인일 기준 고정 게시물의 첫 사진이다.

원본을 보존하고 WebP로 압축했다. 인물 생성·얼굴 보정·배경 합성은 하지 않았다. 원본, 해시·출처 목록, 웹 이미지와 역할 설정은 원본 checkout의 `outputs/hyunji-assets/`에 있다.

## 등록과 표시

`scripts/prepare-hyunji.mjs`는 기존 CMS 명령으로 프로필, 이미지 역할, 퀴즈 3문항과 공개 사진첩을 등록한다. 기본 실행은 읽기 전용 사전 검사다. `HYUNJI_ASSET_ROOT`로 자산 폴더, `HYUNJI_ADMIN_APP_USER_ID`와 `HYUNJI_ADMIN_ALLOWLIST_ID`로 기존 운영자를 지정한다. `--apply`는 Dev에, `--production --apply`는 운영에 반영한다.

- 프로필: 사진 2의 `(120, 240, 1200, 1200)` 영역을 900px 정사각형으로 저장한다. 얼굴과 머리 전체를 보존한다.
- 모바일·데스크톱 대표 사진과 디렉터리: 사진 2 원본을 사용한다. 승인된 `cover`, 위치 `50% 25%`를 해당 자산 revision에 연결한다.
- 사진첩 본문은 원본 비율을 유지한다. Instagram 주소는 기존 외부 링크 측정 경로를 사용한다.
- 퀴즈는 계정 아이디, 프로필 표시 이름, 고정 게시물 첫 사진의 흰 꽃다발을 묻는다. 사진첩 안내에서 같은 정보를 확인할 수 있다.

Instagram 계정 인증을 대신하거나 자동 수집 연결을 만들지 않는다. 새 보상 정책이나 금액을 설정하지 않으며, 기존 팬 인증·패스포트 흐름을 사용한다.

## 검증

- 운영 공개 API에서 한국어·영어 사진 8장과 사진첩 본문 이미지 8장을 확인했다.
- 실제 Dev에서 퀴즈 정답 처리, 패스포트 발급, 재제출 중복 방지를 트랜잭션 롤백으로 확인했다. 현지 보상 정책은 미설정 상태이며 새 보상을 만들지 않았다.
- 운영 공개 데이터를 사용하는 로컬 프로덕션 빌드에서 11개 언어 × 390px·1440px의 가로 넘침, 이미지 로딩, WCAG A/AA 자동 검사를 통과했다. 사진첩·안내 상세·디렉터리는 두 너비에서, 팬페이지는 768px에서도 확인했다.
- 키보드 초점 표시와 팬 인증 버튼의 로그인 후 복귀 경로를 실제 브라우저에서 확인했다. 로그인한 실사용자의 인증·온체인 발급은 실행하지 않았다.
- 관련 컴포넌트 테스트, 타입 검사, 변경 파일 린트, 최신 main 통합 빌드가 통과했다. 브라우저 기록과 로그는 원본 checkout의 `work/hyunji-onboarding-20261016/`에 보존한다.
