# Ticket guide loopback harness

Run `node apps/web/e2e/tickets-local/server.mjs`, then open:

- `/guide?locale=ko` and `/guide?locale=en&compact=1`
- `/history?locale=ko` and `/history?locale=en`
- add `scenario=guest`, `scenario=loading`, or `scenario=error`

All identity and API data is synthetic and served on loopback only.
