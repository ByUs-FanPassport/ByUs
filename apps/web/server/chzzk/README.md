# Creator news and CHZZK community

Every published creator uses the same compact news UI and paginated full list.
Without a valid published CHZZK channel link, only ByUs notices appear, with no
CHZZK category or request. With an HTTPS chzzk.naver.com/<32-hex-channel-id> link,
All / Notices / CHZZK categories appear. Enrollment is no longer tied to Jenny's
slug. List and detail routes resolve the channel from the published creator on
every request; removing the channel disables subsequent reads.

## Pagination

Home shows three rows, with one pinned notice prioritized. View all carries the
selected category via news=notice|chzzk. Full lists expose Load more while any
selected source has a next cursor. Notices use the existing API's nextCursor;
CHZZK fetches ten upstream rows at the validated numeric cursor/offset.

The next CHZZK offset counts upstream rows, including entries filtered for privacy.
The upstream totalCount decides completion; omitted comments at an exhausted
offset are an empty final page. Server cache is bounded to 100 channel/offset keys
for 15 minutes. Expired data is not returned on failure.

Client pages are deduplicated by source and post ID. Failed additional requests
retain the current list and cursor for retry. In-flight repeat clicks are ignored;
creator/locale changes abort and discard old responses. Returning to a visible
page or the 15-minute refresh restarts at page one to recheck removed content.
Each source retains its own pages when switching categories. Combined loaded
records are sorted together, with pinned notices first.

## Source and privacy

The website's internal nng_comment_api is not part of the documented CHZZK Open
API; availability and reuse policy are not guaranteed. Verified 2026-09-15:
Jenny's anonymous offset=0 returns five posts; offset=2 returns the remaining
three; offset=10 has no comments. Multi-page volumes are tested with fixtures.

Only creator-authored CHANNEL_POST entries for the resolved channel, explicitly
secret=false, deleted=false, hideByCleanBot=false are projected. No replies,
private comments, credentials or cookies are requested. Text is escaped; image
URLs are restricted to HTTPS nng-phinf.pstatic.net and not copied into storage.

CHZZK rows open /c/[slug]/updates/chzzk/[postId]. Detail requests recheck the exact
post without caching. Source links go to that creator's community list because
no stable browser per-post URL was verified. The existing CHZZK logo is reused.
ByUs notice detail pages and comments remain accessible from notice rows.

## Checks

Feature tests cover publication/channel gating, safe URLs, pagination offsets,
filtered rows, cache isolation, three-page traversal, duplicate requests, end of
list, partial failures/retry, stale responses and creators without CHZZK.
Local browser evidence distinguishes live CHZZK reads and published ByUs snapshots
from large-volume fixture responses. No production writes or deployment are made.
