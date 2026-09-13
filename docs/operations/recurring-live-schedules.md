# 정기 LIVE 운영

정기 방송은 `live_events.live_type = recurring`인 실제 LIVE 회차입니다. 각 회차는 기존 상세·예약·스탬프·알림 경로를 사용합니다. 홈 배너는 독립적이며 월간 캘린더 UI는 그대로입니다.

공식 채널은 주 1회 확인합니다. 승인한 반복 규칙에서 49일을 생성하여 다음 주 실행 전까지 최소 42일 일정을 확보합니다. 일일 전체 채널 조사는 하지 않습니다. 종료 근거가 없으면 종료 시각을 비워 두며, 출석 인증은 코드와 유효 시간이 설정된 경우에만 열립니다.

## 최초 조사

2026-09-13 공개 최애 8명 전체의 연결된 공식 채널을 확인했습니다. 프로필·소개·공식 일정 공지와 관련 최근 공개 게시물 범위이며, 비공개 콘텐츠나 사라진 Story는 확인한 것으로 취급하지 않습니다.

| 최애 | 결과 | 근거와 처리 |
| --- | --- | --- |
| 이퓨 | 정기 | [공식 TikTok](https://www.tiktok.com/@ifewknow): 평일 07:00 KST, 종료 미정. 주말은 랜덤이므로 자동 생성 제외. 2026-09-13 22:23 KST 확인. |
| 엘리나 | 미확인 | [TikTok](https://www.tiktok.com/@elina_karimovaa), [Instagram](https://www.instagram.com/elina_4_22/), [YouTube](https://www.youtube.com/@ElinaKarimova)의 확인 범위에서 반복 규칙 미확보. |
| 창하 | 미확인 | [TikTok](https://www.tiktok.com/@chang._.a), [Instagram](https://www.instagram.com/chang._.a/), 연결된 공식 YouTube 확인. |
| 유나 | 미확인 | [TikTok](https://www.tiktok.com/@yuna1_27), [Instagram](https://www.instagram.com/yuna_1_27/), [YouTube](https://www.youtube.com/@YunaKarimova_) 확인. |
| 정제니 | 미확인 | [치지직 이번 주 공지](https://chzzk.naver.com/0a3f97086cb81d3360c69fdf5d020045/community/detail/28373896)는 해당 주 일정입니다. 매주 반복 규칙으로 확장하지 않습니다. |
| 아렴 | 미확인 | [Instagram](https://www.instagram.com/aryeomii/), [YouTube](https://www.youtube.com/@aryeomii) 확인. |
| 박명호 | 미확인 | [TikTok](https://www.tiktok.com/@myunghopark74), [Instagram](https://www.instagram.com/myunghopark/)에서 LIVE 관련 언급은 있으나 반복 요일·시각 미확보. |
| 재희 | 미확인 | [TikTok](https://www.tiktok.com/@thisisj_official), [Instagram](https://www.instagram.com/j.hya/) 확인. |

미확인은 방송하지 않는다는 뜻이 아닙니다. 과거 일회성 행사도 정기 규칙으로 바꾸지 않습니다. 이 표는 최초 기록이며, 매 실행의 명단과 규칙은 DB를 기준으로 합니다.

## 실행 명령

현재 사용 중인 Supabase CLI 로그인과 연결된 ByUs 체크아웃을 사용합니다. CLI는 프로젝트 ref를 검사하며 비밀번호·service key를 인자나 결과에 쓰지 않습니다.

```sh
node scripts/recurring-live-schedules.mjs roster --linked-workdir /Users/jewel/Desktop/Developement/byus --output work/recurring-live/roster-current.json
node scripts/recurring-live-schedules.mjs import --input work/recurring-live/input.json --dry-run --linked-workdir /Users/jewel/Desktop/Developement/byus
node scripts/recurring-live-schedules.mjs import --input work/recurring-live/input.json --apply --linked-workdir /Users/jewel/Desktop/Developement/byus
node scripts/recurring-live-schedules.mjs replenish --days 49 --dry-run --linked-workdir /Users/jewel/Desktop/Developement/byus
node scripts/recurring-live-schedules.mjs replenish --days 49 --apply --linked-workdir /Users/jewel/Desktop/Developement/byus
node scripts/recurring-live-schedules.mjs verify --required-days 42 --linked-workdir /Users/jewel/Desktop/Developement/byus
```

`--dry-run`은 입력/현재 명단 또는 현재 coverage만 읽습니다. 실제 생성 수는 잠금과 중복 검사를 적용한 `--apply` 결과에 있습니다. 종료 코드 `0`은 정상, `2`는 실패, `3`은 검토 필요입니다. `3`을 성공으로 숨기지 말고 결과를 읽습니다.

최초 승인 명령 `bootstrap`은 `--run-id`, import 결과의 `--expected-input-hash`, 실제 승인 관리자의 `--admin-user-id`와 `--admin-allowlist-id`가 필요합니다. 관리자 ID는 현재 로그인 계정과 DB allowlist를 확인한 뒤 사용합니다. 승인되지 않은 다른 관리자를 임의 선택하거나 자동화에서 bootstrap을 호출하지 않습니다.

## 주간 절차

1. `roster`로 현재 공개 최애, 공식 URL, 기존 series/규칙/slot ID와 마지막 관찰을 가져옵니다. 최초 8명을 고정 목록으로 사용하지 않습니다.
2. Aside로 공식 프로필·일정표·고정 공지와 관련 변경/휴방 공지를 확인합니다. 기존 성공 근거와 같은 주의 중복 조사는 재사용합니다. 접근 실패를 일정 유지 확인이나 비정기 판정으로 바꾸지 않습니다.
3. 입력 v1은 `scripts/lib/recurring-live-input.mjs` 계약을 따릅니다. 매 조사 run UUID는 새로 만들되 같은 실행의 재시도에는 그대로 사용합니다. 모든 현재 공개 최애를 포함합니다. 공식 채널이 없는 최애는 출처 null인 미확인 관찰을 남깁니다.
4. **기존 seriesKey, slot UUID, effectiveFrom과 승인 규칙을 보존합니다.** 단순 재확인 때문에 새 slot UUID나 이번 주 날짜로 규칙을 바꾸지 않습니다. `expectedCurrentRevisionId`는 조회한 현재 ID를 넣습니다. 근거가 없는 종료 시각이나 시간대를 넣지 않습니다. 같은 방송을 여러 출처에서 확인해도 series를 늘리지 않습니다.
5. 입력 검증 후 import합니다. 새 규칙/변경/휴방/충돌은 관리자 검토 대상으로 남깁니다. 자동화가 스스로 변경 규칙을 승인하지 않습니다. 기존 예약이 있는 회차를 다른 LIVE로 대체하거나 기록을 옮기지 않습니다.
6. 승인 규칙의 회차를 보충하고 42일 coverage를 확인합니다. 같은 실행을 반복해도 기존 ID·예약 창·schedule revision은 변하지 않아야 합니다.
7. 이전 결과와 비교해 새 일정, 의미 있는 규칙/조사 상태 변경, 실패, coverage 부족 또는 신규 검토 건이 있을 때만 알립니다. 같은 미확인 상태와 같은 검토 건을 매주 새 문제처럼 반복 알리지 않습니다. 변동이 없으면 조용히 종료합니다.

관리자는 `/admin/lives`의 정기 방송 패널에서 공식 근거와 현재/제안 규칙을 확인합니다. 충돌은 기존 LIVE 연결, 서로 다른 방송 판정 또는 명시적으로 선택한 회차 취소로 처리합니다. 실제 일정 수정은 기존 회차 ID의 이력과 예약을 보존합니다.

## 중단과 복구

잘못된 조사나 운영 실패가 있으면 해당 규칙의 추가 생성을 멈추고 검토합니다. 이미 예약된 회차를 삭제하거나 새 ID로 교체하지 않습니다. 출석 기록이 있는 회차를 규칙 변경 때문에 자동 수정하지 않습니다.

운영에 nullable 정기 회차가 생긴 뒤에는 이 값을 모르는 과거 앱 버전으로 단순 되돌리지 않습니다. 자동화를 일시중지하고 nullable 지원 버전을 유지하며 기존 취소/일정 수정 절차를 사용합니다. 관찰·승인·예약·출석·audit 기록은 보존합니다.

주간 자동화는 이 작업의 로컬 체크아웃과 Aside 로그인 세션을 사용합니다. 실행 시 컴퓨터와 Codex 앱이 켜져 있고 작업 폴더가 남아 있어야 합니다. [공식 예약 작업 안내](https://learn.chatgpt.com/docs/automations?surface=app).
