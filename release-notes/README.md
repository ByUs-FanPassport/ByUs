# 운영 변경 안내

작업할 때 한국어 안내를 작성하면 운영 배포 성공 후 Sally_Bug_Report 방에 OMCODEX 봇이 자동 게시합니다. AI API·별도 요약 비용은 없습니다.

새 파일 `release-notes/YYYY-MM-DD-short-name.json`을 변경과 함께 커밋합니다.

```json
{
  "changes": ["알림 목록의 점을 굵은 제목과 같은 높이에 맞췄어요."],
  "path": "/notifications"
}
```

- `changes`: 비개발자가 이해할 한국어 1~5문장, 문장당 6~240자. 바뀐 동작과 사용자에게 미치는 영향을 구체적으로 씁니다. 기술 용어·커밋 번호·추측·계획·민감 정보·외부 링크는 넣지 않습니다.
- `path`: 확인할 ByUs 경로. `/`, `/notifications`처럼 영문·숫자·하이픈·밑줄·슬래시만 사용합니다.
- 파일 이름은 소문자·숫자·하이픈으로 만듭니다. 이미 게시한 안내는 수정·삭제하지 않고 새 파일을 추가합니다.
- main push/PR 검사가 실행 코드 변경의 안내 누락·형식 오류를 잡습니다. 문서·테스트만 바꾼 경우와 이미 안내한 코드의 재배포는 새 안내 없이 건너뜁니다. 기존 배포 파이프라인의 보호 규칙은 변경하지 않습니다.
- 전송 문구는 여러 작업의 안내를 합칩니다. 합계 3,900자를 넘으면 짧게 정리한 후 다시 확인해야 합니다.

## 전송 기준과 복구

`.github/workflows/deployment-notices.yml`은 Vercel의 `Production` 배포 `success` 이벤트를 받습니다. 고정 저장소·Vercel 발신자·현재 배포 상태·main 포함 여부를 검증하고, `https://byus.kr`의 인증된 전송 경로만 호출합니다. 봇 키는 기존 Vercel 앱에 그대로 두고, GitHub에는 기존 operator secret만 설정합니다. 기존 버그 접수 웹훅·반응 기능은 변경하지 않습니다.

마지막 전송 성공 receipt 이후의 새 안내를 모읍니다. 첫 안내의 기준은 도입 전 배포 `6712694578` / `401f25159028791b0d680df3c56c1b7e6a354714`로 고정하며 과거 안내를 소급 전송하지 않습니다. 실패·미완료 배포는 게시하지 않습니다. 동일 이벤트/작업 재실행은 성공 receipt가 있으면 건너뛰고, 뒤늦은 과거 이벤트는 더 최신 알림이 있으면 건너뜁니다. 빠른 연속 배포에서 대기 작업이 합쳐지면 마지막 전송 이후의 안내를 다음 알림에 모읍니다.

GitHub check `Telegram deployment notice`에 배포 ID, 메시지 ID와 전송 결과를 기록합니다. 전역 concurrency와 전송 전 예약으로 CI의 자동 전송 시도를 한 번으로 제한합니다. Telegram API에는 idempotency key가 없고 내부 전송 경로도 단독 중복 방지 저장소는 아니므로, **결과 불명 POST를 직접 다시 보내면 안 됩니다.**

- `success`: 전송 완료. 재실행해도 보내지 않습니다.
- `failure`: 메시지가 거절된 것이 확인된 상태. 원인을 고친 후 해당 Actions 실행을 재실행할 수 있습니다. 다음 성공 배포에도 아직 전송되지 않은 안내가 포함됩니다.
- `action_required` 또는 오래된 `in_progress`: 전송됐을 수도 있습니다. 후속 자동 알림도 멈춥니다. 방에서 실제 메시지를 확인한 운영자가 receipt를 `success`(메시지 ID 포함) 또는 `failure`(미전송을 확인한 경우만)로 정리한 다음 해당 실행을 재실행합니다. 확인 없이 삭제·실패 처리하지 않습니다.

검증: `node --test scripts/deployment-notices.test.mjs`, `node scripts/deployment-notices.mjs check <base-sha> <head-sha>`, `npm run test:web -- server/telegram`.

참고: [GitHub 배포 이벤트](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#deployment_status), [Check runs](https://docs.github.com/en/rest/checks/runs), [Telegram sendMessage](https://core.telegram.org/bots/api#sendmessage).
