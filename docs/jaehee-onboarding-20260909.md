# 재희 / Jaehee 등록

## 확정 정보
- 사용자 승인: 2026-09-09, “등록해보자.”
- 표시 이름: 재희 / Jaehee (사용자가 영문 표기 위임)
- 본명: 정재희, 직업: 쇼호스트
- 주소: `/c/thisisj-official`
- Instagram: https://www.instagram.com/j.hya/
- TikTok: https://www.tiktok.com/@thisisj_official (표시 이름: 여기가 제이)
- 팔로워 수: Instagram 1,310명. 사용자가 제공한 화면 기준이며 실시간 조회값이 아님. TikTok 81명과 합산하지 않음.

## 소개
쇼호스트 · 뷰티·건강  
미스코리아 울산·경남 진  
엘리트모델룩 CF 부문 2위

Shopping host · Beauty & wellness  
Miss Korea Ulsan–Gyeongnam winner  
2nd place, Elite Model Look commercial category

수상 경력은 사용자가 제공한 인스타그램 소개를 그대로 반영. 연도나 상세 대회명은 추가하지 않음.

## 이미지
- 작은 프로필: `/Users/jewel/Downloads/j.hya-avatar--20260909_174613_260374837.jpg` (540×540)
- 긴 대표 영역: `/Users/jewel/Downloads/Jaehee-ByUs-candidates/originals/03.webp` (1440×1440)
- 대표 원본 복사: `apps/web/public/images/celebrities/thisisj-official/hero-source.webp`
- 두 자산을 분리하고 PC/모바일에서 대표 이미지의 초점을 검수.

## 팬 인증 퀴즈
한·영 3문항, 문항별 보기 4개와 정답 1개.
1. 재희의 직업은? — 쇼호스트
2. 인스타그램 아이디는? — j.hya
3. 틱톡 표시 이름은? — 여기가 제이

## 등록 기록
- 운영 셀럽 ID: `240af5ef-237d-466f-b038-414d5e72d634`
- CMS 감사 기록을 남기는 기존 등록·퀴즈·공개 함수를 사용.
- 재실행 영수증: `artifacts/private/jaehee-20260909/receipts.json`
- [x] 프로필 및 퀴즈 초안 등록
- [x] 관련 화면 29개 테스트, 타입 검사, 변경 파일 린트 통과
- [x] 빌드 및 대표 이미지 설정 배포
- [x] 프로필·퀴즈 공개 및 운영 데이터 재조회
- [x] PC·모바일 화면과 팬 인증 진입 확인

LIVE, 래플, 팬 활동 수집은 이번 등록에서 새로 설정하지 않음.

## 운영 검증 결과
- 배포: `dpl_Ebedp6cmedWNrNxaW42RxoXtYP5c` — Ready, byus.kr 연결 완료.
- 배포 소스: `30ed8ba`, 커밋 원본만 별도 폴더에 추출하여 배포. 기존 next-env.d.ts 개발 설정 보존.
- 한·영 공개 프로필 및 퀴즈 API 모두 HTTP 200. 퀴즈 3문항, 통과 기준 2문항.
- 실제 로그인 Aside에서 팬 인증 첫 문항 진입 확인. 답안 제출·패스포트 발급은 하지 않음. 진입 과정에서 해당 계정의 미완료 시도 1건 생성.
- 모바일 390px 및 PC 화면에서 지정 사진·크롭·텍스트 확인. 이름 검색 결과 1명 확인.
- 목록의 소개는 기존 UI 규칙에 따라 첫 줄(쇼호스트 · 뷰티·건강)을 표시. 수상 경력을 포함한 전체 한·영 소개는 CMS에 저장됨.
- 검증 파일: `artifacts/private/jaehee-20260909/`의 API 결과 및 화면 이미지.
- 기존 운영 권한 계정으로 별도 CLI 로그인 복구 후 배포했으며 전역 로그인 설정은 변경하지 않음.
