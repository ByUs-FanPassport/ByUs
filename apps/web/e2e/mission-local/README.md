# Mission local verification harness

This harness renders the real `LiveMissionScreen` with its production CSS. It aliases Privy to the synthetic `testowner` identity and serves only the LIVE detail, mission list, and mission submit endpoints on `127.0.0.1:4186`.

Run the complete verification from the repository root:

```sh
cd apps/web && node e2e/mission-local/run.mjs
```

Run the real completion-motion checks on an isolated port while the 4186 visual preview remains open:

```sh
cd apps/web && BYUS_MISSION_LOCAL_PORT=4187 node e2e/mission-local/motion-run.mjs
```

The motion run records active and settled animation state, reduced-motion behavior, mid/settled PNG frames, and a playable desktop WebM under `test-results/mission-local/motion/`.

For visual inspection, start the loopback server and keep the returned process open:

```sh
cd apps/web && node -e 'import("./e2e/mission-local/server.mjs").then(async ({startHarness}) => { const h = await startHarness(); console.log(h.baseURL); })'
```

Open `http://127.0.0.1:4186/?locale=ko&scenario=fresh`. Supported scenarios are `fresh`, `wrong-quiz`, `already-completed`, and `retry`; locale accepts `ko` or `en`.

The checked-in `elina-public-fixture.json` contains only public presentation fields
and configured reward numbers from the archived payload. It contains no owner
identity or authentication data and does not depend on ignored local docs.
