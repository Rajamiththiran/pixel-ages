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

## Step 3 — People (band mode)

| # | Gap | Decision | Why |
|---|---|---|---|
| 3.1 | §11.5 lets a gatherer take food from only one tile a month, but a full forest tile holds 1.5 FU, so the 2.0 cap never matters and a forest band tops out around 8 people. §10.2 says a full forest range feeds 30–40 | A gatherer who empties their best tile moves on to the next richest, up to 4 tiles (`food.gatherMaxTiles`), until their cap | Makes the land, not carrying capacity of one tile, the limit — exactly what §10.2 calibrates for |
| 3.2 | Pairing (§11.9) allows any age gap. Older widows paired for life with young men; 27% of fertile women had nobody | The man may be up to 20 years older or 5 years younger (`pairMaxOlderMan`, `pairMaxOlderWoman`) | Real pairing is age-assortative; this frees young men for young women |
| 3.3 | Is the forage range "all tiles within R" even across a river? | Only tiles the band can walk to from home (8-way, no corner cutting) | Bands were "gathering" across rivers they couldn't cross |
| 3.4 | Sustainable yield counts prey at full value even when the band can barely hunt | Prey count ×0.5 without Stone Tools (the same factor as hunting success) | Crowding read 0.6 ("plenty of room") while bands starved, so they never explored, moved or split |
| 3.5 | With the §11.6 formulas, everyone in a hungry band chooses Explore at once (same inputs, same scores), nobody gathers, and the band starves every summer | Support jobs (Explore, Care, Build, Teach) lose score as more of the band already does them: × max(0, 1 − 2 × share) (`brain.supportFalloff`) | Real bands send a few scouts, not everyone; food work is never crowded out |
| 3.6 | A daughter band needs a site 12 tiles from every home (§11.8), but scouts only reach 8 tiles (+ reveal 3), so a band could never split | A band that wants to split, or is hungry enough to want to move, scouts as far as its migrate range (25) | Bands looking for new land scout farther; otherwise splits and long moves are impossible |
| 3.7 | Migration (§11.8) could settle right next to another band (onto its range) | Migration sites must also be 12 tiles (2R) from other bands' homes | Bands avoid each other's ranges; daughter bands were drifting back onto their parent |
| 3.8 | Starting food of founders | 2 months of need (`founderFoodMonths`) | They arrive carrying something; avoids a fake famine in month 1 |
| 3.9 | Founders under 15: their childhood so far | Counted as fully fed and calm | No history exists; the neutral assumption |
| 3.10 | Children's "actual" traits before 15 | Equal to potential (shown as "developing"); group averages use adults only | §11.4 fixes actual traits at 15 |
| 3.11 | Food shortage: shares can exceed someone's need | Capped shares are re-shared until the food is gone (no waste) | §11.5 would otherwise throw food away during a famine |
| 3.12 | Huts after migration | Left behind (huts reset to 0) | Shelters don't move |
| 3.13 | Teaching bonus "this year" | Average teachers per month over the year sets next year's bonus | Teachers change month to month |
| 3.14 | Children's looks | Each feature (skin, hair) from one parent, chosen with the seeded RNG | Families look related |
| 3.15 | Log text | Stored without the year; the UI shows "Year N" in front | Matches §21.3 layout |
| 3.16 | `inspect` message | Also carries the clicked person / group id, picked on the main thread | Only the main thread knows where people are drawn |
| 3.17 | Rendering thousands of sprites with separate drawImage calls was 1 fps at 5,000 people | Sprites are copied into one pixel layer per frame and drawn once (`render/blit.ts`) | 5,000 people now render at ~100 fps |
| 3.18 | Birth numbers | Tuned 5% → 7% a month and 24 → 18 months nursing — see TUNING.md pass 1 | Scenario A target (7/10 alive at year 100) with real-forager birth intervals |
