# Decisions — gaps filled in the blueprint

Where [pixel-ages-blueprint.md](pixel-ages-blueprint.md) is silent or unclear, the builder picks the option that best fits the game's goals and records it here (CLAUDE.md rule 7). Newest steps at the bottom. Each entry: **what was missing → what was chosen → why.**

## Step 1 — Map and brushes

| # | Gap | Decision | Why |
|---|---|---|---|
| 1.1 | Can plants/resources be painted on wall tiles? (§8.2 says walls clear them) | No — skipped on wall tiles. Animals may be painted on walls (only Water is excluded) | Painting a wall clears plants and resources, so allowing it the other way round would be inconsistent |
| 1.2 | Rain brush soft edge while dragging | The outer ring blends 50% from the value *before the stroke*; tiles already painted at full strength in the stroke are never lowered | Stops repeated 50% blends compounding into a hard edge while dragging |
| 1.3 | Fill bucket for Plants/Resources: compare type or amount? | Compares the layer's type (plant type, resource type, wall type, ground); rain value for Rain; one species' density for Animals; all four densities for the animal eraser | "Same value in the current layer" (§20.2), using the layer's main value |
| 1.4 | Group ids after deleting a group | Renumbered to 1, 2, 3… | Founder id = lineage id (§7.2), so ids stay compact and stable for the run |
| 1.5 | Does "New map" remove placed groups? | No, groups stay | The map and the people are separate parts of the setup; groups can be deleted on their own |
| 1.6 | Area outlines when the whole map is one area | Hidden; area labels sit in each area's top-left corner | Outlines around non-splitting walls were noise; centred labels covered placed groups |
| 1.7 | Extra terrain detail (owner request) | Water depth, waves, foam, wet edges, grass blades, flowers, tree crowns, mountain peaks, dunes, pebbles — recorded in blueprint §18.3 | Owner asked for richer graphics |
| 1.8 | TypeScript version | TypeScript 5.9 | TypeScript 7's native compiler would not install on this machine |
| 1.9 | Zoom (§18.8) appears in no build step | Built in Step 2 together with run mode | Needed to look at the living world closely |

## Step 2 — Living world

| # | Gap | Decision | Why |
|---|---|---|---|
| 2.1 | Plant food stock at run start | Starts full (`maxStock`) | The painted world is meant to be mature; an empty start would make year 0 a fake famine |
| 2.2 | Animal capacity on intact wall tiles | 0 (animals there slowly vanish); crossings use the ground underneath | Rivers, mountain ranges and seas are not habitat; diffusion already treats them as blocked |
| 2.3 | Densities that decay forever never reach 0 | Densities below 0.0001 become 0 (`animals.minDensity`) | Local extinction is realistic, and tiny float values (denormals) slow the simulation badly |
| 2.4 | Predator–prey line order (§10.4) | Both lines use the same prey value (standard Lotka–Volterra step) | Result no longer depends on which line runs first |
| 2.5 | Spread rolls "for each neighbour" | One roll per qualifying neighbour, stop at first success | Matches the text; more dense neighbours → higher spread chance, as in nature |
| 2.6 | Drift "off" and the RNG | No random numbers are drawn when drift is off | Zero-sigma noise is pointless and would waste RNG draws |
| 2.7 | When exactly a keyframe is taken | At month 0 of year 0, 200, 400… (after the year rolls over). Keyframes don't copy the log/stats | "Year Y" in the timeline means the start of year Y; the live run keeps the full history |
| 2.8 | The worker loop needs a real clock, but `src/sim/` may not read one | Clock lives in `src/shared/clock.ts`; only the loop's pacing uses it, never a tick | Keeps the forbidden-API rule meaningful: no simulation rule can see real time |
| 2.9 | Falling behind at 8× on a slow computer | At most 0.5 s of real time is "owed" (`time.maxBacklogSeconds`) | Runs as fast as it can instead of freezing to catch up; the speed label shows the real rate |
| 2.10 | Playing state when viewing the past | Jumping to a past year pauses; Back to now stays paused; Play while viewing replays forward and joins live seamlessly | The owner is looking at something; it shouldn't run away |
| 2.11 | Does a run start paused? | Run ▶ starts playing at 1× | "Press Run, then watch" (§1) |
| 2.12 | Frame fields | Added `liveMonth`, `playing`, `speed` to `Frame` | The worker owns play state; the UI just mirrors it, so they can't disagree |
| 2.13 | Redrawing terrain for rain-only changes | Rain changes only redraw the rain overlay; terrain redraws are capped at 6 ms per frame (`render.terrainBudgetMs`) | Drift changes rain on most tiles every year; redrawing all terrain at 8× would stutter |
| 2.14 | People during a Step 2 run | Placed groups are hidden while running | They are not simulated until Step 3; showing them frozen would be misleading |
| 2.15 | Run validation (§20.6) | Not yet — Run works with or without groups | Validation is part of Step 6; Step 2 runs only the world |
