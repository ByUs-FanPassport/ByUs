# Independent home banner local checks

These loopback-only checks render the real GuestHome, carousel, LiveCalendarScreen and HomeBannerManager with production CSS. Next links/images/navigation and Privy have explicit local adapters. The four LIVE occurrences and admin API responses are synthetic; existing local artwork is fixture input, not final banner art. No production tokens, DB writes, uploads, notifications or reservations are used.

From `apps/web`:

```sh
node e2e/banner-local/run.mjs
node e2e/banner-local/admin-run.mjs
```

Each runner starts and closes its own loopback Vite server. Set `BANNER_LOCAL_URL=http://127.0.0.1:4193` to reuse an existing harness. Screenshots/evidence JSON go to `test-results/banner-local` under the current working directory.

Home checks cover KO/EN at 360/1440, responsive assets, same-language desktop fallback with contain, failed image CTA, hidden-slide focus exclusion, guide preservation, independent unpublishing and four calendar occurrences. Admin checks exercise bilingual input, save, publish and unpublish at the same four sizes/languages. Unit tests additionally exercise uploads, reorder, permissions and conflict recovery.

Database behavior is checked separately by `supabase/tests/home_banners.sql` and `scripts/verify-home-banner-concurrency.sh`, both included in `npm run security:backend-db`. These run only against the disposable local replay database and exercise real roles, publication/FK/revision constraints, ordering and concurrent create/reorder exclusion.
