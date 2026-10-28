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
- Step 6 (events, graphs, full inspector): approved.
- Step 7 (tune and publish): in progress (F0 done; discovery-pace tuning and the itch.io zip still open).
- F1 (wood and materials, future blueprint §7): built on the owner's request before v1.0 shipped.
- F2 (inventions from practice, §8): built on the owner's request.
- F3 (food and environment, §9): built on the owner's request.
- F4 (people change the landscape, §10; D7 elevation layer added): built on the owner's request.
- F5 (elements and hazards, §11): built on the owner's request.
- F6 (society, conflict and animals, §12): built on the owner's request.
- F7 (observer tools, §13; D5 intervention mode added): built on the owner's request; approved.
- F8 (graphics and sound, §14; D6 keep the style, D8 sound on by default): built on the owner's request; awaiting the owner's approval.
- Perfection pass (owner, 20 Oct 2026: perfect what exists before adding features; 11 items, owner's choices in DECISIONS.md §17–19):
  - Item 1 (slow down history): built (DECISIONS 17.1–17.7); final discovery numbers being calibrated (TUNING.md pass 7).
  - Item 2 (readable people): 2b walking routes and pace built (DECISIONS 18.x); 2a jobs last a season built (19.1). Awaiting the owner's try.
  - Founders, war churn and log (owner, 28 Oct 2026): built (DECISIONS 20.1–20.11, TUNING pass 8). Next, once the owner approves: C4, conquered villages join the winner's chiefdom or kingdom.

## Test bench (fast checks of simulation changes)

Never wait on long runs to check a change. Unit tests test one rule on a tiny world in seconds; the bench checks a change in the game itself from the moment that matters. The simulation is deterministic, so a saved state replays exactly.

All settings are environment variables (bash: `BENCH=run SNAP=A-19-y500 npm run bench`; PowerShell: `$env:BENCH='run'; $env:SNAP='A-19-y500'; npm run bench`).

- **Snapshot** a world: `BENCH=snap SCEN=A SEED=19 AT=500,1000`. SCEN is A–H (`src/presets/scenarios.ts`) or `M`, the mini world (`tests/_probe/mini.ts`: half size, 4 couples, ~4× cheaper, rarely dies out). Files go to `.snaps/` (or `SNAPDIR`; keep them out of commits). Remake snapshots when the state gains a field.
- **Run on** from it: `BENCH=run SNAP=A-19-y500 YEARS=100 STEP=25` → one line per group every STEP years, then log counts. `LOG=split|war` also lists those log lines. Without SNAP it starts at year 0 from SCEN and SEED.
- **Same results?** `HASH=1` prints the state hash: a speed-only change must keep it.
- **Why slow?** `PROFILE=1` lists the 25 slowest functions.
- **Try numbers** without editing config: `OVR='{"discoveries.baseChanceByEra":[0.004,0.002,0.0008,0.0005,0.0003,0.0002]}'` (leaf keys only).
- **Statistics over many worlds**: `tests/_probe/f9.test.ts` (SCEN, SEEDS=1-12, YEARS, OVR, OUT; one JSON line per seed). Run seeds in parallel processes, on the mini world first; confirm on the real scenario once, in the background, at the end of an item.
- The report goes to `OUT` (default `bench.txt`).

## Notes

- Gap decisions are logged in [DECISIONS.md](DECISIONS.md).
- The owner does all git commits and pushes. Never commit or push.
- This machine's global `~/.npmrc` sets `os=linux`; install with `npm install --os=win32 --cpu=x64`.
- The full test suite takes a few minutes (multi-century simulation tests). Long scenario runs: `LONG=1 npm test` (bash) or `$env:LONG=1; npm test` (PowerShell).
- Number tuning goes in [TUNING.md](TUNING.md).
- Future plan (v1.1 → v2.0, not active until v1 ships and the owner approves): [pixel-ages-future-blueprint.md](pixel-ages-future-blueprint.md).
