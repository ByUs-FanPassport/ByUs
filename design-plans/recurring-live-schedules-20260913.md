# 예약 가능한 정기 LIVE 실행계획

최신 사용자 결정(2026-09-13): 기존 LIVE 구조 안에서 일반/정기 타입을 구분하고 정기 회차도 예약한다. 기존 월간 캘린더 UI/API 유지. 6주는 데이터 확보 범위이며 새6주화면/rangeAPI는 만들지 않는다. 실제 구현·운영 반영·push·자동화 승인됨. 구 calendar-only 계획은 폐기했다.

## 결과와 운영
매 실행 공개 celebrities 전체 동적조회→공식 출처 관찰→규칙 제안→승인 규칙만49일 생성→42일 coverage 검증. 주1회 조사/보충에7일버퍼를 두고 별도일일scheduler 없음. 최초 명확한 규칙은 현재사용자승인+실제관리자RPC로 승인, 이후변경/휴방/충돌은 검토. 미확인을 비정기로 해석하지 않음. 기존배너/월간UI보존. 예약은 최초생성시 열고 시작시닫음. 실제유저예약 스탬프/알림은 기존경로 그대로; 운영합성예약금지.

## Canonical schema
live_events.live_type general|recurring defaultgeneral. recurring_series_id,recurring_slot_id,recurrence_week(localISO월요일),recurring_rule_revision_id. partialunique(series,slot,week), 시간/revision제외. ends_at,brand_id,attendance_valid_from/until,fan_code_hash nullable이나 general의기존필수제약유지. recurring identity는모두필수, general모두null. 모든타입 opens<closes<=starts; end있으면starts<ends. 출석code/from/until은모두null또는모두유효. 기존데이터변경없음.
정기생성: 미래starts만, ends공식근거없으면null, opens최초transactiontime, closesstarts, brandnull, 출석code/windownull, contentscheduled. 기존회차의예약창/ID/slug/상세/보상은재확인으로덮어쓰지않음.

Private RLS tables:
- recurring_live_series(id,celebrity_id,series_key,status active|paused|retired,current_rule_revision_id,timestamps),unique(creator,key).
- recurring_live_rule_revisions(id,series_id,revision,status proposed|approved|rejected,rule jsonb,source_observation_ids uuid[],proposal_hash,reason initial|rule_change|hiatus|source_conflict|duplicate,review_payload,approved_actor/allowlist/time),unique(series,revision),동일pendinghash중복방지.
- recurring_live_observations(id,run_id,celebrity_id,result regular|irregular|unconfirmed,verification verified|inaccessible|not_found|conflicting,source_url/account/published_at,observed_at,original_text,evidence_path,content_hash,normalized_rule),unique(run,creator,hash).
- recurring_live_runs(id,idempotency_key unique,input_hash,mode bootstrap|weekly|replenish,status running|completed|needs_review|failed,roster,summary,timestamps).
Rule={timeZone:IANA,effectiveFrom:date,effectiveUntil:date|null,provider,channelUrl,slots:[{id:stableUUID,isoWeekday:1..7,localStartTime:HH:MM,end:null|{localTime,dayOffset}}]}.

## Security and preservation
SECURITY DEFINER search_path='', revoked direct grants/service RPC only. AdminRPC uses assert_active_admin(actualuser+allowlistemail linkage), CAS expectedcurrentrevision, immutableaudit. Strict bounded inputs/URLs and IANA validation. DSTgap/fold reviewed, no guessedtimes. Creatoradvisorylock then series/live rowlock consistentorder. Existingexactmanualcreator/time/provider/normalizedURL reused viaidentity attach; preserveID/slug/booking/content. Ambiguoussame-day/multiplecandidates review, noautomaticmerge. Manualcreate/publish path/DBguard takes same lock and rejects collisionwith existingID. Never hidebookedautomaticrowinfavorofanotherID, nevermove/deleteuserrecords. Changedrule proposal freezesnewgenerationbutexistingpublishedrowsstay; actualapprovedchanges useexistingrescheduleRPC and CAS.

## Nullable compatibility
Update latestSQL/TS status: existingcancel/overridepriority, knownendexistinglogic, unknownendwithoutactualoverride remains scheduled and existing'시작 확인 중'. Paststartunknownend excludedupcominglist but retainedcalendar/history. No inferredreplay fromchannelURL. Publishedgeneral brandrequired; recurringbrandnullable, specifiedbrandmustpublished. Repositories avoid mandatoryinnerbrandlookup whennull, preservecreator/KOENchecks. Creatorapprovedimage and factualKOENcopy fornewregularrows.
Actualattendanceproducer and insertiontrigger explicitlyfail whennullcode/window (threevaluedSQLlogicmustnotbypass); publicavailability/UI notconfigured. Reservation independent. Use latest20260913090800 producer body preservingGIWAoutbox, notolddefinition.
Schedulehistory end/window nullable; reschedule usesISNOTDISTINCTFROM, type-awarevalidation, existingCAS/attendance/overridelocks. Same-ruleimport/replenish no schedule_revisiontouch, nochange notification. Realapprovedchange usesexisting live_changedtrigger.

## RPC contract
get_recurring_live_roster()
import_recurring_live_observations(p_run_id uuid,p_idempotency_key text,p_input jsonb)
approve_initial_recurring_live_rules(p_actor_app_user_id uuid,p_actor_admin_allowlist_id uuid,p_run_id uuid,p_expected_input_hash text,p_rule_revision_ids uuid[],p_correlation_id uuid)
replenish_recurring_live_events(p_run_id uuid,p_horizon_days integer,p_now timestamptz)
get_admin_recurring_live_schedules(p_actor_app_user_id uuid,p_actor_admin_allowlist_id uuid)
resolve_admin_recurring_live_review(p_actor_app_user_id uuid,p_actor_admin_allowlist_id uuid,p_revision_id uuid,p_expected_current_revision_id uuid,p_resolution jsonb,p_correlation_id uuid)
verify_recurring_live_coverage(p_now timestamptz,p_required_days integer)
Inputv1={version:1,runId:uuid,rosterObservedAt:ISO,creators:[{celebrityId,result,verification,observations:[{sourceUrl,sourceAccount,sourcePublishedAt,observedAt,originalText,evidencePath,contentHash}],seriesKey,proposedRule:null|rule,expectedCurrentRevisionId:null|uuid}]}.
Sameidempotencykeydifferenthashfails; import proposesonly, bootstrap exacthash+realadminchecked. Missingcreatorreportedunconfirmed. Review allowlistedresolution approve_rule/reject/link_existing/distinct_events/cancel_occurrences; relatedcreator/CAS/historyvalidation mandatory, noSQLpayload.
CLI scripts/recurring-live-schedules.mjs roster--output; import--input--dry-run|--apply; bootstrap--run-id--expected-input-hash--dry-run|--apply; replenish--days49--dry-run|--apply; verify--required-days42. No-write dryrun, no credentialarguments/logs, exit0normal/2fail/3review.

## App contract and ownership
PublicLiveEvent liveType general|recurring, endsAt string|null, brand object|null, productContext string|null; configured/not_configured attendance. Unknownenddetail start+종료시간미정; no fabricatedGooglecalendarduration (exportCTAhiddenuntilendknown), ByUs예약maintained. Existingmonthlycalendar allrealIDs/slugs noarchitecturechange. Minimaladmin sameLIVEmanager type/status and regularreviewpanel, nofullredesign.
- DB agent owns additive migrations, SQLbehavior/concurrencytests and backendsecuritywiring. Latestdefinitions preserved.
- Server/domain agent owns live-event.ts/live-schedule.ts/newrule schema, g3eventrepository, attendancedomain/repo/routes, g5managerroute/repo/dependencies, newrecurringadminAPI/adapters/tests. NoUIfiles.
- UI agent owns adminlive-manager and newreviewpanel/CSS/tests, live-event-screen/live-catalog-screen/live-time-display and necessarynullconsumerUI. Monthlylayoutuntouched. Coordinate domaincontract.
- Main owns operationalCLI/tests,sourceinputs, integrationchecks/release/automation. Agentsnotalone/noothereditsrevert/no-redelegation.

## Verification and rollout
Localfixtures: generalregression; nullend/brand/code recurringpublished+actualreservation; retry/concurrencyidempotentbooking+outbox; nullattendanceproducer/directinsertdenied; unknownstatus/replaytruth; same-rule/simultaneousgenerationIDs/opens/revisionunchanged; approvedchange sameID+notificationCAS; manualcreationrace+bookedrowpreservation; DST/year/49day/42coverage; rosterchanges/sourcefailures; adminprivileges. Existingmonth+nextmonthdetail/catalogadminKOEN360/1440render. Mandatoryprojectlint/typecheck/build/security/hooks. Noexternalfanmessagesorproductiontestrecords.
Rollout compatibleadditiveschema→nullable-awareappdeployREADY/alias→firstdataimport/bootstrap/replenish→readonlyAPIandrerundup0. Neverrollbacktooldnullable-unawareappafterrealbookings; stopgenerationanduseexistingcancel/reschedulepath, preserveevidence/reservations.
ACTIVE weeklycurrentthreadheartbeat officialAsidewhole-roster→validatedimport→49dayreplenish→42dayverify, quietunchanged, reportmeaningfulchanges/failures/coverage/reviews. Noautoapprovechangedrules. Sourceunknowndoesnotblockallcreators.

## Checkpoint
Main271a49b integrated; branchcodex/recurring-live-schedules-20260913. Architecture revisedaftertwoexplicitusercorrections. IndependentriskP1accepted: nullattendancefailclosed/status/no-opnotification/IDpreservation/adminactor. All-rosterAside ongoing; currentclearIfeWMonFri07:00KST, other7unconfirmed, Jennycurrent-weeknotice notrecurrence. Noimplementation/DBmutationyet.

최종 risk review 보완: unknownend scheduled 유지시 지연된 reminder가 시작후발송되지 않도록 실제 공통/email/Kakao eligibility에 p_at<starts_at 명시. 예약/변경알림도 시작후기존만료정책유지. 시작전queued→시작후denied 로컬검증. 이보완포함시독립리뷰구현진행가능.

## 2026-09-14 00:15 KST 체크포인트
- 사용자최신범위: canonical 일반/정기, 실제예약, 월간UI유지. sourceweekly49daybuffer.
- Main앱/CLI/관리자review/UI구현. local월간/상세/목록/패널/실제LiveManager KOEN360/1440총20렌더통과(합성데이터,실기기/운영증거아님). artifacts test-results/recurring-local/evidence.json.
- 최초8명Aside완료, onlyIfeWverifiedMonFri07KST. bootstrap inputrun20423c0f-b1f0-47a6-af8e-cda153ed58d6 (work/recurring-live/bootstrap-input.json). Evidence work/recurring-live/official-source-research.json.
- 운영현재로그인biz@sallylab.io/admin Aside확인, activeactor/allowlist readonlyDB확인 work/recurring-live/authorized-admin.json. 운영mutation없음.
- Maincodechecks:194focused;1654broaderpass+1oldUIcontractfixed→26targetedpass;panel/route8pass;CLI4pass. typecheck/lint/buildpass. Worker575+typecheck/buildpass;contracts44passed1skipped,explicitAnvilintegration1pass,storagevalidationpass.
- DB담당재사용agent banner_admin owns4new2026091320*migrations+SQLfixtures/concurrency/backendsecuritywiring. Baseline181migrationreplaypass, 신규fixtureextensionsgen_random_uuidpermission수정중. Finalscopedbehavior/concurrency/fullpipeline아직미완료.
- IndependentSQLriskreview found cancelNULLscopebypass,effectiveFrom/Untiligonredreschedule,same-day/crossseriesduplicateweakness,stalerule/lockorder,unpublishedcreatorwholetransactionfailure,hiatusregen,writerGUChashNULLguards,late reserved/changedexpiry. DB담당fix진행. 반드시수정검증후운영.
- origin/main advanced3c024a9promotion; 통합아직안함. overlap scripts/verify-backend-security-behavior.sh 양쪽검증모두보존. 새base20260913133000migration포함하여최종combinedDBpipeline/build확인필요.
- Remaining: DBfixes/tests+independentrecheck→scopedcommit→originmainmerge→requiredintegrationchecks→guardedprodadditiveschema→push/deployREADYalias→inputdryrun/import/bootstrap/replenish/readAPI/replenishdup0→ACTIVEweeklyheartbeat(원문 work/recurring-live/automation-prompt.txt)→goalcomplete. 임의팬참여/메시지/권한변경금지. Worklogs/Userfiles보존.

## 2026-09-14 00:45 KST 검증 완료 체크포인트
- 최신 origin/main 234950053aba47a43610dcb0407662a80cb05dc3를 f23bcdd로 통합. promotion/GIWA 변경과 두 backend 검증 wiring 모두 보존.
- 전체 `npm run security:backend-db` exit 0 (`work/recurring-live/backend-db-final.log`). 정기 실제 예약/GIWA outbox 멱등, unknown-end/출석 fail-closed, 적용일 전후 동일 ID reschedule/CAS, 미확인 유지/휴방 dedup·pause, 수동 예약 LIVE 재사용, 같은날 insert/update 충돌 거절 통과. 별도 세션 동시 생성 및 승인 대기 후 최신 규칙 재조회 경합도 PASS.
- scoped6는 실제 196개 migration 재생 후 통과. 스크립트 `migrationsApplied` 필드는 public table count이므로 migration 개수로 보고하지 않음.
- 독립 risk review의 마지막 두 P1(writer guard 및 manual-after-generation 충돌) 수정 확인, 실행 통과 조건 충족.
- 통합 앱 59 tests, 최종 hiatus/admin API 9 tests, CLI 4 tests, lint/typegen/typecheck/build 통과. UI20렌더 및 기존 worker/contracts 성공 근거 재사용. 추가 main worker 변경은 2349500 Backend security CI success로 확인.
- DB source hash와 exact source ledger를 포함한 guarded SQL 준비. 기존 LIVE·예약·출석·배너 보존 assertion 포함. 아직 운영 mutation/push/자동화 생성 전.
