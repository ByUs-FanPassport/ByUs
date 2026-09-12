# LIVE watch resolution

The published LIVE's stored URL remains the fallback. The public watch endpoint never writes that URL back to the database. A scheduled status alone is not proof that an external broadcast is live.

| Platform | Opt-in URL | Detection | Manual URL behavior |
| --- | --- | --- | --- |
| TikTok | `/live/event/{numeric-id}` | Existing cached TikTok observation for the published creator's single canonical handle | Specific watch/replay URLs remain unchanged |
| YouTube | `/@handle` or `/channel/UC…` (bare channel URL) | YouTube Data API channel resolution, live search, then video verification | `/watch?v=…`, `/live/{video-id}`, `/embed/{video-id}`, and `youtu.be/{video-id}` remain unchanged, including scheduled videos that keep the same URL when they begin |
| Instagram | None enabled | Not verified for the existing Instagram Login integration | Stored profile, LIVE, and replay URLs remain unchanged |

## YouTube configuration and matching

Set server-only `YOUTUBE_DATA_API_KEY` for a Google Cloud project with YouTube Data API v3 enabled. Never use a `NEXT_PUBLIC_` key. Public channel lookup uses an API key; it does not require creator OAuth consent.

Register the same channel form in the creator's published YouTube social link and LIVE watch URL. `@handle` matching is case-insensitive. A handle and a channel ID that may refer to the same account are deliberately not treated as equivalent by the route; use the same form in both places. Multiple different social links or unsupported legacy `/c/` and `/user/` forms fall back.

Discovery runs only when clicked, inside the LIVE's `[startsAt, endsAt)` window and with an available, effective-live event. The resolver requires a public video for the resolved channel, an actual start time at or after the event start and not in the future, no actual end time, and an observation younger than five minutes. A broadcast that started before the registered event window falls back, even if it is still live. This avoids linking an unrelated long-running broadcast; an early-starting intended broadcast should use its explicit video URL.

Multiple live candidates, pagination indicating additional candidates, API errors, missing keys, expired observations, and an event ending while lookup is pending all retain the stored URL. An empty result means no broadcast was found; it is not inferred from the schedule.

The provider now shares a private database response cache across home discovery and registered-event redirects: channel resolution for 24 hours, live search for 1 hour, and video confirmation for three minutes. Discovery is request-driven, so a new broadcast can take approximately one hour plus the time until the next request to appear. Candidate uniqueness is checked at the last search, not continuously; video confirmation rechecks the selected candidate's state. An atomic per-key lease prevents duplicate requests across instances. Rolling 24-hour reservations cap search at 96 requests and channels/videos together at 9,000 requests, below the documented default 100-search and 10,000-general daily buckets. Failed requests also consume reservations. API restrictions and other consumers of the same Google project still affect its available quota. The redirect response remains `Cache-Control: no-store`.

For a real read-only source check, select one currently broadcasting channel with a single public LIVE and one currently offline channel. Run with Node 24 and a private environment file containing the key:

```sh
node --conditions=react-server --env-file=<private-env-file> scripts/verify-youtube-live-source.mjs --live <channel-url> --offline <channel-url>
```

The script exits successfully only when the real API returns `live` and `offline` respectively. It prints normalized observations, never the key or raw upstream responses. An `unavailable` result is not proof of offline status. Current channel state can change, so do not turn this command into an unconditional CI assertion.

### Verified activation evidence, 2026-09-12

- Google Cloud project `byus-508205` (ByUs): YouTube Data API v3 enabled; dedicated `ByUs YouTube LIVE Server` key restricted to that API. Existing OAuth clients were not changed.
- Vercel `sallylab/byus`: `YOUTUBE_DATA_API_KEY` saved as a Secret for Production only and verified after refresh before the code push. Preview/Development were not configured. Temporary local key files were removed. The variable is used by production deployments containing this extension.
- At 08:11 UTC, the actual source returned `live` for channel `UCQfwfsi5VrQ8yKZ-UWmAEFg` (FRANCE 24 English), with video `HvZt-nh9sGg`; it returned `offline` for registered creator `@aryeomii` (channel `UCt0iA30wbnPxFOHCFS1mrYw`).
- Historical video `Ap-UM1O9RBU`, found in search results, was independently confirmed ended by the videos API (`actualEndTime: 2026-05-26T20:10:12Z`, `liveBroadcastContent: none`). Search-engine LIVE titles are not current-state proof.
- The initial guessed handle `@FRANCE24English` returned `unavailable`; the correct channel ID was obtained from official video metadata. No fallback or test assertion was weakened to make the check pass.
- Source/API evidence is separate from the earlier rendered local component/redirect check, which used injected repositories and observation fixtures. Production end-to-end navigation has not been tested for this extension.

## Instagram automatic watch links

Creator `social_links` are public navigation addresses. `instagram_connections` separately stores the credentials and cached media obtained after account-owner consent. These are different registrations.

On 2026-09-12, a read-only production query found 8 published Korean creator Instagram profile links and 0 rows in `instagram_connections`. No tokens or profile records were modified. This does not imply that creator profiles are missing.

The integration uses the existing `instagram_business_basic` Instagram Login connection. A bare Instagram profile URL in both the LIVE watch target and the creator's active Instagram social link opts into automatic switching. Explicit stories, video, or LIVE URLs remain authoritative. The returned official API permalink is used directly; the application does not construct a viewer URL.

The private `/api/internal/instagram/live-sync` cron runs once per minute on the verified Vercel Pro team, separately from hourly media collection. It only claims published creators with a valid connected token, a matching active profile, and a published Instagram event inside its scheduled time window. Each invocation claims at most 25 accounts, processes five concurrently, and bounds each source request to five seconds. Separate 45-second leases and generation/token checks reject duplicate or late writes. More than 25 eligible accounts can delay detection; stale observations always fall back rather than extending freshness.

The public watch handler reads only whitelisted cached observation fields. It never retrieves or decrypts an Instagram token. Automatic redirects require a matching creator/account, an actual broadcast start within the event window, and an observation younger than 90 seconds; the window is checked again after the read. Successful empty responses, failures, expired cache/token, disconnected accounts, and missing connections preserve the stored profile URL. Connection or token changes invalidate previous observations. Detection and end propagation follow the minute polling schedule; this is not instantaneous detection.

**Audience policy approved by the user:** do not distinguish Everyone, Close Friends, or Practice in the redirect decision. Both tested Everyone and Practice broadcasts appear in `live_media` with `BROADCAST + FEED`. The actual same-owner `/stories/{username}/{id}` permalink is accepted. Instagram controls who can view the destination; a redirect does not prove that every fan can play the broadcast. Close Friends behavior was not separately tested.

Activation uses the existing `INSTAGRAM_INTEGRATION_ENABLED=true` gate and the normal creator OAuth connection flow. The dedicated `mirrorworld.ai` developer credential is only a capability-test credential and was not stored against an unrelated production creator. A fresh production query still found 0 connected accounts. Merely registering an Instagram social URL is not OAuth consent; unconnected accounts continue using their stored URL.

Verification for this extension: actual Everyone and Practice start/end API responses; current-source replay of those four captured responses; source/domain, worker/read/cron, redirect and existing screen tests; isolated PostgreSQL leases, identity, expiry, erasure and access checks; TypeScript and lint. The broadcaster browser showed the profile/LIVE badge, not playback, so fan-account playback is not claimed. This does not block the user-approved automatic-link behavior.

Migration `20260912120819_instagram_live_observations.sql` was applied to production `gmrykvmtmuaeswpajteq` with its history recorded. The post-application query confirmed five LIVE columns, zero claims for unconnected accounts, null fallback for a missing connection, and no anon/authenticated RPC access. Supabase CLI security advisors reported no issues. A scoped rollback is in `supabase/rollback/20260912120819_instagram_live_observations.sql`; disable the integration/revert the application before removing the database objects.

Local rendered verification passed at KO 375px using the actual `LiveEventScreen` and `createGetLiveWatchHandler` with fixture repositories and the captured response shape. Keyboard activation opened a new tab through the internal watch route (307) to the exact Instagram stories permalink; ended/error observations redirected to the configured profile. The CTA was 343×48px, with no overflow or page errors. External destination navigation was intercepted, so this proves the local application flow, not Instagram playback. Evidence: `artifacts/instagram-live-20260912/local-rendered-cta-result.json`.

Checks passed: 183 focused web tests (43 source/domain, 14 sync/read/cron, 126 route/link/existing screen), 8 probe tests, existing PostgreSQL OAuth lifecycle/concurrency checks, new PostgreSQL LIVE checks, web TypeScript checking, and targeted ESLint. Existing unchanged successes were reused; no new public broadcast was requested.

The chronological capability-test notes below preserve what was known at each checkpoint; their earlier pending audience/parser conditions are superseded by the implementation and user-approved policy above.

### Owned-account validation checkpoint, 2026-09-12

- The user selected `mirrorworld.ai` and authorized continuing the basic-read integration test. The existing Instagram session confirmed a public Creator account with 1,406 followers and access to the LIVE preparation screen. No broadcast was started.
- Dedicated ByUs Meta app `1732948291088067` / Instagram app `3397133600468084` was reused. The exact account is now an accepted Instagram tester. An initial generic role-save error was caused by submitting the typed username without selecting its autocomplete result; selecting the exact account resolved it. The unrelated existing Sally Social API-IG tester relationship was preserved.
- Basic-read consent and a dedicated developer test token were completed. Every optional message, comment, publishing and insights permission was deselected in the consent UI. This developer test connection does not create a production creator connection.
- At `2026-09-12T09:12:37.945Z`, the actual `graph.instagram.com/v25.0` API confirmed `mirrorworld.ai` as `MEDIA_CREATOR`, then returned HTTP 200 with an empty `live_media` list. The offline control passed. This establishes access to the endpoint under the tested basic-read setup; nonempty LIVE fields, watch navigation and the end transition remain unverified until the owner starts a test broadcast. Evidence: `artifacts/instagram-live-20260912/offline-proof.json`.
- `scripts/probe-instagram-live.mjs` performs read-only identity and `live_media` requests against an explicit `graph.instagram.com` version. It requires a private credential JSON file (`accessToken`, `graphVersion`), checks the expected username, and prints only whitelisted evidence. No token, raw upstream message, or paging URL is logged. A successful empty result is an offline control; errors remain unavailable, and a nonempty result remains a live candidate until broadcast semantics and navigation are verified.
- Local validation: `node --test scripts/probe-instagram-live.test.mjs` (6 passed), syntax check, and targeted ESLint passed. These mocked tests are separate from the real offline API proof above.
- Meta's generated-token input initially contains masked text until the acknowledgment checkbox is selected. A first capture failed locally before any authenticated HTTP request because of non-ASCII mask characters. The valid token was subsequently captured and verified by the real API. The probe now rejects masked credential strings before constructing a request; token values are kept only in the private temporary file and secure vault.
- Next required action after the practice test below: compare a user-started public broadcast and establish public-audience eligibility before automatic link promotion. Do not enable the adapter on endpoint presence alone.
- The private `server/instagram/live-source.ts` module is now prepared. It bounds the complete request/body read to five seconds and 64 KiB, validates account identity, LIVE media type, an explicit timestamp and a safe Instagram permalink, and rejects pagination or multiple candidates. A nonempty valid record is deliberately named `candidate`, and its time is named `mediaTimestamp`; actual broadcast start semantics have not yet been established. It is not wired into the anonymous watch route or a token-loading path.
- Source validation: 17 focused tests, targeted ESLint and web TypeScript checking passed. The actual module also returned `offline` at `2026-09-12T09:19:08.578Z` using the dedicated test credential (`artifacts/instagram-live-20260912/source-offline-proof.json`). On this continuation, the account was still offline; no start/end or live-button navigation evidence exists yet.

```sh
node scripts/probe-instagram-live.mjs --credentials <private-json-file> --username mirrorworld.ai --expect offline
```

### Practice broadcast start/end evidence, 2026-09-12

- The owner started a Practice broadcast and confirmed it in the conversation. At `11:58:41Z` and `11:58:59Z`, the official `live_media` endpoint returned one matching `mirrorworld.ai` broadcast: `media_type=BROADCAST`, `media_product_type=FEED`, timestamp `2026-09-12T11:58:27+0000`, with an actual `/stories/mirrorworld.ai/{id}` permalink. Sanitized evidence: `artifacts/instagram-live-20260912/practice-live-proof.json`.
- After the owner confirmed ending it, the same endpoint returned HTTP 200 and an empty list at `11:59:56.962Z`. The offline expectation passed. Evidence: `artifacts/instagram-live-20260912/practice-ended-proof.json`. These observations establish a practice broadcast appearing and disappearing; they do not measure exact detection latency.
- The prepared source and probe had assumed `media_product_type=LIVE` and the source did not accept a stories permalink. Consequently the probe reported a candidate with `matches=false`; the source is not yet validated for actual nonempty responses. Its earlier mocked test successes must not be presented as real LIVE acceptance.
- Practice broadcasts also appear in this endpoint, so a nonempty list does not prove that general fans can view a broadcast. Public-audience discrimination and actual viewer navigation remain unverified. Do not simply allow `FEED` plus stories URLs and activate automatic redirects; preserve the manual fallback until eligibility is established.

### Public broadcast comparison, 2026-09-12

- The owner selected Everyone and confirmed starting another broadcast. At `12:01:40.326Z`, the official API returned one matching broadcast: `media_type=BROADCAST`, `media_product_type=FEED`, timestamp `2026-09-12T12:01:14+0000`, with a `/stories/mirrorworld.ai/{id}` permalink. Evidence: `artifacts/instagram-live-20260912/public-live-proof.json`. The queried fields have the same shape as the practice response and do not distinguish audience.
- A read-only media request with `metadata=1` returned HTTP 200 but no metadata field list; it did not establish any audience discriminator. Evidence: `artifacts/instagram-live-20260912/public-metadata-proof.json`. This is not proof that every possible API field lacks audience information.
- Aside navigated the existing Instagram tab to the exact returned permalink. Both initial and settled inspections showed the broadcaster's profile and LIVE badge. The settled page had zero video elements; playback was not observed. Because this session was signed in as the broadcaster (profile-edit controls visible), this does not establish independent viewer behavior or prove that the permalink is broken.
- Browser evidence: `/Users/jewel/.aside/u/0/sessions/2026-09-12_hPgYwNVr2kc5O2oP/tmp/mirrorworld_instagram_settled_check.png`. No comments, account changes, or broadcast controls were used. Independent viewer navigation and public eligibility remain pending; automatic redirects remain disabled.

- After the owner confirmed ending the public broadcast, `live_media` returned HTTP 200 with an empty list and no next page at `2026-09-12T12:03:57.529Z`; the offline expectation passed. Evidence: `artifacts/instagram-live-20260912/public-ended-proof.json`. Both tested audiences now have observed start/end transitions. Exact transition latency was not measured.

## Official references

- [YouTube channels.list](https://developers.google.com/youtube/v3/docs/channels/list)
- [YouTube search.list](https://developers.google.com/youtube/v3/docs/search/list)
- [YouTube videos.list](https://developers.google.com/youtube/v3/docs/videos/list)
- [YouTube video resource and liveStreamingDetails](https://developers.google.com/youtube/v3/docs/videos)
- [YouTube API getting started and current quota guidance](https://developers.google.com/youtube/v3/getting-started)
- [Meta Instagram API with Instagram Login](https://www.postman.com/meta/instagram/folder/1z5vxzu/instagram-api-with-instagram-login)


## TikTok and YouTube home discovery, 2026-09-12

The existing `ObservedLiveStrip` is mounted on both the guest home and LIVE catalog. `/api/public/live-now?v=2&locale=ko|en` observes active TikTok and YouTube links from published creators without requiring a registered ByUs event or creator OAuth. Bare supported YouTube handles/channel IDs are required; explicit videos and unsupported legacy channel forms do not opt in. v1 remains TikTok-only so a previously cached client cannot label a YouTube card as TikTok. Existing registered-event watch redirects retain their stricter event-window and manual-link rules.

Each card and target status has a platform + creator + account identity. The same creator can have one card on each platform. Confirmed provider metadata supplies the title/cover; the published creator image is the fallback. TikTok uses its canonical account LIVE URL and YouTube uses the confirmed video watch URL. The UI names the destination platform in each CTA and keeps the existing desktop grid/mobile carousel.

The feed reports live, confirmed offline, unavailable, and stale separately for every current target. A partial failure, HTTP error, malformed response, or older negative result retains a previously confirmed card only until its original platform expiry (TikTok: 90 seconds; YouTube: five minutes). A fresh offline result removes it immediately; removed/unpublished/account-changed targets are removed on the next successful roster response. An independent timer expires cards even when the browser is hidden or a request hangs. No retry or cache read extends the original proof timestamp.

The reported morning ifew card flicker cannot be attributed conclusively without historical request logs. Confirmed code paths previously cleared all cards on fetch failure and replaced all cards on a partial feed. An authorized production read also returned all six TikTok targets as stale, while another returned five offline/one unavailable. The TikTok cache now throws on unavailable refreshes to preserve successful cached entries, and awaits a bounded, deduplicated source lookup when cached proof is 90 seconds old instead of returning that stale cache unchanged.

YouTube's shared cache and reservation tables are service-role-only with RLS and revoked public/authenticated table/RPC access. Requests are restricted to fixed Google API endpoints and canonical stage parameters. Only stage-specific whitelisted response fields are cached; credentials and raw upstream errors are excluded. The database's claim timestamp is the proof origin, avoiding runtime/database clock-skew rejection or quota stampedes. A 15-second lease and five-second network/body deadline prevent late completion from replacing a newer lease. Failure backoff and rolling quotas are enforced in SQL, including across different runtime instances.

Migration: `20260912124226_youtube_live_shared_cache.sql`. Rollback: disable/revert the application feature before running the matching file under `supabase/rollback/`. Removing the cache without reverting the application fails YouTube observation closed; it does not change creator records or Instagram connections.

Verification passed: 150 focused web tests (31 provider/cache, 22 feed/API/shared-cache, 16 domain/UI, 81 existing watch-route/link/channel), TypeScript checking and scoped ESLint. Isolated PostgreSQL checks covered table/function/sequence access, real service-role claim, leases/late writes, DB proof origin, 60-second video TTL, failure backoff, both quotas and rolling expiry. Twelve simultaneous requests for one key produced one claim and one quota reservation. Independent review found and resolved runtime/database clock skew; rejected direct-refresh cleanup also no longer creates an unhandled promise rejection.

Local actual-component rendering passed at KO/EN 375px and 1440px: mixed-platform cards, provider-specific accessible links, keyboard new-tab navigation, mobile next-card operation, partial-failure retention, confirmed-end removal and original-time expiry, with no overflow or browser errors. Evidence: `artifacts/live-now-20260912/browser-result.json` and locale/width screenshots beside it. The v2 API was fixture-backed and external destinations were intercepted; these results do not claim current provider playback or production UI verification. The initial carousel concern was a test-order error after keyboard focus had already scrolled to the second card; no carousel implementation change was needed.

Production migration was applied to `gmrykvmtmuaeswpajteq` in a transaction and history recorded. Read-back confirmed no public/authenticated RPC or sequence access; the cache and attempts were empty before application rollout. Security advisors reported no issues. Application rollout uses the existing main push and exact-commit automatic deployment-start confirmation.


### YouTube timing adjustment, 2026-09-12

The user approved increasing known-broadcast reconfirmation from 60 seconds to three minutes and card validity from 90 seconds to five minutes. `YOUTUBE_LIVE_RECHECK_MS` and `YOUTUBE_LIVE_MAX_AGE_MS` are shared by the source, process cache, feed projection, client expiry timer and registered-event watch redirect. The database video cache and video-failure backoff also use three minutes; channel/search TTLs, quotas, TikTok and Instagram behavior are unchanged. A confirmed end still removes the card immediately. Request-driven discovery of a new broadcast remains hourly; a longer cached observation can delay end detection.

The client accepts both the previous 90-second YouTube card expiry and the new five-minute expiry during rollout, always preserving the original expiry instead of extending old cards. Migration `20260912130515_youtube_live_three_minute_cache.sql` replaces only the two existing cache functions and preserves their private access/budget/lease rules. The matching rollback restores the previous cache timings without deleting data.

Validation: 108 relevant web tests, TypeScript checking and scoped ESLint passed; unchanged successes from the preceding verification were reused. SQL confirmed the 179/180-second video cache boundary and existing lease/quota/access rules. The actual local component passed KO/EN 375px/1440px and retained the updated YouTube observation through 299 seconds, removing it at 300 seconds after that observation (`artifacts/live-now-timing-20260912/browser-result.json`). Production migration history and both three-minute function settings were read back successfully with anonymous execution still denied.
