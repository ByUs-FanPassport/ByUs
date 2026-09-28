# 배포 변경 안내

- 운영에 반영할 변경을 만들 때 `release-notes/YYYY-MM-DD-short-name.json`을 함께 추가한다. 작성법은 `release-notes/README.md`를 따른다.
- 비개발자가 읽는 한국어로 실제로 바뀐 동작을 1~5문장 적는다. 기술 용어·커밋 번호를 나열하거나 계획을 완료로 쓰지 않는다.
- 기존 안내 파일은 수정·삭제하지 않는다. 새 작업마다 새 파일을 추가한다.
- 문서·테스트만 바꾸거나 같은 코드를 다시 배포할 때는 새 수정 안내를 만들지 않아도 된다.
- 운영 배포 성공 뒤 GitHub Actions가 Sally_Bug_Report 방에 자동 전송한다. 작업 에이전트가 별도로 같은 안내를 보내지 않는다.
- `NOTICE_DELIVERY_UNCERTAIN`이면 자동 재전송하거나 receipt를 삭제하지 않는다. 방과 GitHub check의 전송 기록을 먼저 확인한다.
