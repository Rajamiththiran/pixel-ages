# Pixel Ages — rules for Claude Code

The full design is in [pixel-ages-blueprint.md](pixel-ages-blueprint.md). Read it before changing anything.

1. **The blueprint is the single source of truth.** Read it fully before writing any code.
2. **Build in the 7 steps of §24, in order.** Finish a step, run its tests, show the result, then **stop and let the owner try it** before starting the next step. Do not build features from later steps early (empty interfaces/stubs are fine).
3. **Every tunable number lives in `src/config.ts` (§23).** Never hard-code a tunable number anywhere else. If you need a new number, add it to `config.ts` with a comment.
4. **The simulation must be deterministic (§16).** Inside `src/sim/` never use `Math.random`, `Date`, `performance.now`, `Math.pow`, `Math.exp`, `Math.log`, `Math.sin`, `Math.cos`, or `**` with non-integer exponents. Use the seeded RNG and the helpers in `src/shared/`.
5. **Simulation code never touches the DOM or Canvas. Rendering code never changes simulation state.** The simulation runs in a Web Worker.
6. **Dependencies:** only Vite, TypeScript and Vitest. Ask the owner before adding any other package.
7. **If something in the blueprint is missing, ambiguous or contradicts itself, implement the option that best fits the blueprint's goals and real-world patterns, and record it in [DECISIONS.md](DECISIONS.md)** (what was missing, what you chose, why). Mention new decisions in the step report. Ask the owner only before changing a locked decision (§2) or anything that would bias the owner's experiment. *(Owner instruction, 14 Oct 2026; replaces "ask, don't guess".)*

Units: 1 tile = 1 km, 1 tick = 1 month, 1 FU = food one adult eats in one month.
Code style: TypeScript `strict`, small pure functions, short comments that explain *why*. No classes for hot data (people, tiles) — use typed arrays. No TypeScript `enum`; use `as const` objects.

## Commands

- `npm run dev` — dev server
- `npm test` — unit tests (Vitest)
- `npm run build` — type check + production build

## Progress

- Step 1 (map and brushes): approved.
- Step 2 (living world): approved.
- Step 3 (people, band mode): approved.
- Step 4 (discoveries and eras): approved.
- Step 5 (villages, walls, contact): approved.
- Step 6 (events, graphs, full inspector): built, waiting for owner approval.

## Notes

- Gap decisions are logged in [DECISIONS.md](DECISIONS.md).
- The owner does all git commits and pushes. Never commit or push.
- This machine's global `~/.npmrc` sets `os=linux`; install with `npm install --os=win32 --cpu=x64`.
- The full test suite takes a few minutes (multi-century simulation tests). Long scenario runs: `LONG=1 npm test` (bash) or `$env:LONG=1; npm test` (PowerShell).
- Number tuning goes in [TUNING.md](TUNING.md).
