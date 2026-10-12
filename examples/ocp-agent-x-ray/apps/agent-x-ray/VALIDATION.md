# Validation record

Validated on 2026-10-11 in WSL Ubuntu with Bun 1.3.14. No remote deployment or publication was performed.

## Automated checks

- `bun run typecheck`: all 16 Turbo tasks succeeded across the workspace.
- `bun test`: 96 tests passed, 0 failed, 325 assertions across 13 files.
- `bun test apps/agent-x-ray/src/runner.test.ts`: 13 tests passed, 56 assertions.
- `bun run xray:build`: TypeScript and Vite production build passed. Lazy-loading the React Flow inspector keeps each output JavaScript chunk below 500 kB.

The X-Ray cases cover healthy fixture shopping, reproducible missing-data repair, invalid Query schema with preserved evidence, budget and currency rejection, concurrent trace isolation, actual HTTP calls through the SDK, unavailable Live Catalogs, origin restrictions and credential redaction. Review regressions cover streamed credential URLs, case-insensitive URL redaction, secrets inside live-check evidence, authoritative Resolve price changes, access denial, failed inventory checks and expired actions/references.

## Browser checks

An isolated headless Chromium profile visited the built local app at `http://127.0.0.1:4410`. The browser checks passed:

- Healthy Demo returns Aurora Wireless Headphones at USD 199.
- Clicking Resolve opens its actual Request and Response inspector.
- Missing-data Demo returns two failed checks and displays the missing price.
- Downloaded `report.json` contains the broken run evidence.
- Fixture repair runs a fresh trace, shows zero remaining failed checks and downloads a second report.
- Invalid-schema Demo fails Query and stops Resolve.
- Live runs against the repository's TypeScript Catalog on port 4400 and exposes its view action.
- A disallowed Live origin produces a visible failed report.
- At 390 px viewport width, the page has no horizontal overflow.
- Final browser console had zero errors or warnings.

Screenshots and broken/repaired reports were saved in the requesting chat's outputs directory, separate from repository source. The temporary Playwright/Prettier installation is outside this repository and is not a production dependency.

## Review

The implement skill's code-review stage ran separate Standards and Spec reviews against starting commit `076f83a22815b18712eb74928d76c92c1a09e5d3`, using the user's brief and `SPEC.md`. Both reviewers reproduced concrete issues; those issues were fixed and covered with regression tests. Standards and Spec re-reviews reported no remaining blockers.

## Practical limits

The planner uses disclosed rules, not an LLM. Discovery selects a direct Manifest, not a Registration directory. Only the first response page is inspected. Live supports declared keyword or semantic packs and unauthenticated Catalogs on explicitly allowed origins. Fixture repair removes local fault injection and reruns; it does not autonomously edit provider code. Public deployment, authenticated Catalogs, real external Catalog availability, assistive-technology audits and cross-browser behavior were not validated.
