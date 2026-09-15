# Ticket guide loopback harness

Run `node apps/web/e2e/tickets-local/server.mjs`, then open:

- `/guide?locale=ko` and `/guide?locale=en&compact=1`
- `/history?locale=ko` and `/history?locale=en`
- add `scenario=guest`, `scenario=loading`, or `scenario=error`

All identity and API data is synthetic and served on loopback only.

Home summary and adjacent content layout: `/home?locale=ko` (also `locale=en`).
With the harness running, execute `node apps/web/e2e/tickets-local/verify-summary.mjs`
from the repository root to check 360px/1440px summary height, 24px/32px content
spacing, full-guide access, and guest/loading/error states. Screenshots are saved
under `work/ticket-summary-review/`.
