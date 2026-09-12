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

Discovery runs only when clicked, inside the LIVE's `[startsAt, endsAt)` window and with an available, effective-live event. The resolver requires a public video for the resolved channel, an actual start time at or after the event start and not in the future, no actual end time, and an observation younger than 90 seconds. A broadcast that started before the registered event window falls back, even if it is still live. This avoids linking an unrelated long-running broadcast; an early-starting intended broadcast should use its explicit video URL.

Multiple live candidates, pagination indicating additional candidates, API errors, missing keys, expired observations, and an event ending while lookup is pending all retain the stored URL. An empty result means no broadcast was found; it is not inferred from the schedule.

The provider caches channel resolution for 24 hours, live search for 5 minutes, and video confirmation for 30 seconds. A new broadcast may therefore take up to 5 minutes to appear. Candidate uniqueness is checked at the last search, not continuously; video confirmation rechecks the selected candidate's state. Caches are bounded and process-local, so separate server instances may repeat requests. They are not a global quota limiter or background monitor. Review the project's current Search Queries quota before activation and configure API restrictions appropriate to the server. The redirect response is always `Cache-Control: no-store`.

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

## Instagram activation boundary

Creator `social_links` are public navigation addresses. `instagram_connections` separately stores the credentials and cached media obtained after account-owner consent. These are different registrations.

On 2026-09-12, a read-only production query found 8 published Korean creator Instagram profile links and 0 rows in `instagram_connections`. No tokens or profile records were modified. This does not imply that creator profiles are missing.

The existing integration requests `instagram_business_basic` through Instagram Login and decrypts tokens only in its private sync service. An SDK `getLiveMedia` method alone is insufficient evidence that the configured host, API version, login flow and scope support LIVE lookup. Current official materials did not establish that contract in this investigation. Do not add anonymous-request token decryption, construct a `/live/` URL and call it detection, or display scheduled events as observed-live on this basis.

Before implementing automatic Instagram discovery:

1. Choose a consenting professional account and complete the existing ByUs connection flow. Preserve unrelated Meta apps and accounts; follow `instagram-login-runbook.md`.
2. Verify the supported LIVE endpoint, required scope, live-state semantics and permalink against the configured Graph API version with an actual broadcast and an offline control.
3. Extend the existing private sync/cache boundary with a short-lived, whitelisted observation. Never expose encrypted or decrypted tokens through the public watch endpoint.
4. Verify identity, ended/expired/error fallback and mobile navigation before enabling the adapter.

Instagram automatic detection remains pending these checks; the current implementation preserves its existing manual behavior.

## Official references

- [YouTube channels.list](https://developers.google.com/youtube/v3/docs/channels/list)
- [YouTube search.list](https://developers.google.com/youtube/v3/docs/search/list)
- [YouTube videos.list](https://developers.google.com/youtube/v3/docs/videos/list)
- [YouTube video resource and liveStreamingDetails](https://developers.google.com/youtube/v3/docs/videos)
- [YouTube API getting started and current quota guidance](https://developers.google.com/youtube/v3/getting-started)
- [Meta Instagram API with Instagram Login](https://www.postman.com/meta/instagram/folder/1z5vxzu/instagram-api-with-instagram-login)
