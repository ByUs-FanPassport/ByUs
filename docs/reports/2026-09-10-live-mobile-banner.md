# Mobile LIVE banner and production delivery

- Requested change: remove vertical letterboxing around the landscape LIVE hero on mobile.
- Implementation: `fe2a3bb`; remove the mobile `4 / 5` override so the hero inherits `2 / 1`. Keep mobile `object-fit: contain`.
- Validation: 34 existing LIVE screen/layout tests passed; `git diff --check` passed. Browser preview at 360, 390, and 430px confirmed a 2:1 hero; 768 and 1440px retained existing geometry. At 390px the hero changed from 358 x 447.5 to 358 x 179.
- Preview evidence: `artifacts/live-mobile-banner-20260910/`.
- Existing local environment guards prevented a full local app start. Preview validation applied the equivalent CSS removal to the production DOM in an isolated browser; it was not production deployment proof.

## Deployment context verified on September 10

- Production project: Vercel `sallylab/byus`, ID `prj_kGkUOgGXU01nXsRhpwZ0n9jTuavv`, on the Pro team.
- Before this work, the project API returned `link: null`; the dashboard showed the Git connection prompt. Pushing `fe2a3bb` did not trigger a Vercel deployment.
- Previous production: `dpl_Ebedp6cmedWNrNxaW42RxoXtYP5c`, based on `30ed8ba`.
- Normal CLI authentication succeeded as project-team Owner `jewel-sallylab`. The default CLI identity remains a separate Viewer account.
- Banner-only deployment source: clean production `30ed8ba` plus the CSS from `fe2a3bb`, excluding the separate MY redesign during this initial deployment.
- The user subsequently authorized connecting `ByUs-FanPassport/ByUs` to automatic production deployment from `main`. Future `main` deployments include the previously approved MY redesign already committed there.
- Banner-only production deployment `dpl_82sw4VrrWxUXTbFW5AC1bwxMpSWP` reached Ready and was aliased to `byus.kr`. Fresh production renders at 360/390/430/768/1440px confirmed `2 / 1` and no horizontal overflow. Actual production captures and measurements are in the evidence directory with the `production-` prefix.
- Vercel project API now confirms GitHub organization `ByUs-FanPassport`, repository `ByUs`, repository ID `1307387500`, and production branch `main`. Existing domain, environment variables, billing, and project identity were retained.
- Push this delivery record to verify the newly connected Git deployment trigger; the resulting deployment status must be checked separately before claiming end-to-end automatic delivery.

## Separate CI finding

- GitHub run `34429146396` failed the dependency audit baseline: critical 1 (allowed 0), high 1 (allowed 0), moderate 11 (baseline 10); new moderate path `baseline-browser-mapping`, advisory 1193686.
- The banner change does not modify dependencies or the audit baseline. No check was disabled or bypassed.
