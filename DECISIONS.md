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
| 3.19 | The bottom ▶ in setup mode (§20.3 shows it disabled) | It starts the run, the same as Run ▶ in the Run tab; 1×, 8× and Step stay disabled until then | On a window narrower than 1,680 px the right panel is off-screen, and the owner couldn't find how to start |

## Step 4 — Discoveries and eras

| # | Gap | Decision | Why |
|---|---|---|---|
| 4.1 | "The group keeps ceil(farmers / 10) farm tiles" (§11.5): nobody may farm in winter, so taken literally every field would vanish each winter | Fields are only ever added to reach ceil(farmers / 10). A field is given up when nobody has farmed it for 3 years (it turns back into grass, §10.2) or when the group migrates | Fields persist through winter and fallow years, as real fields do |
| 4.2 | Which tiles become fields when rain ties (§11.5 says ties → lowest index) | Wettest first, then open land before forest or fruit bushes, then lowest index. Never the camp tile | Clearing a fruit grove throws away foragers' best food; early farmers chose open land. The camp stays a camp |
| 4.3 | "Farm tile available" (brain, §11.6) | Free farmer places: 10 per existing field plus 10 per tile that could still become a field | The brain can't send more farmers than the land can take |
| 4.4 | How "no farmers for 3 years" is tracked | A per-tile "farmed this year" mark; a field with no mark for 3 yearly checks reverts | Exact, and independent of which month the last farmer worked |
| 4.5 | Teaching "this year's discovery rolls" (replaces 3.13) | Teachers during the year raise the rolls at the end of that same year | Now that rolls exist, the literal reading works |
| 4.6 | Resource use when there isn't enough (§12.6) | Nothing is taken; the discovery goes inactive (logged once) and is checked again next year. An emptied deposit disappears from the map | Taking the last scraps and still failing would waste them; an empty deposit shouldn't still look like stone |
| 4.7 | How far a group fetches resources | Any known tile, nearest first (no range limit) | §12.6 says "known tiles"; distance only sets the order |
| 4.8 | Logging a forgetting cascade (§12.5) | One line per lost discovery: "forgot Boat (too few people)", then "forgot Clothing (it needs Spear)" | The log shows exactly what was lost and why |
| 4.9 | What happens to a herd when Taming is forgotten | The herd goes wild (herd = 0). Herds only grow while Taming is active | Nobody left knows how to keep them |
| 4.10 | Several discoveries in one year (§12.3) | Rolled in id order against the up-to-date set, so Stone Tools then Spear can both arrive in one year | "Roll each discovery in id order"; no rule says to freeze the set first |
| 4.11 | "Found" on wall tiles (§12.2) | A River or Sea wall counts as Water, a Mountain wall as Mountain; nothing else (walls have no plants or resources) | Matches §12.2 and §8.2 |
| 4.12 | §11.5 "density × 10" animals when herding | 1.0 wild herd density = 10 catchable animals (`food.herdAnimalsPerDensity`) | The number lives in config.ts like every other |
| 4.13 | Pressure (§13) belongs to step 5, but step 4's tests need "inactive adds pressure" | Pressure is built now (`society/walls.ts`) and shown in the inspector; wall work comes in step 5 | Needed for the step 4 acceptance test |
| 4.14 | Laying out mud-brick houses (§18.5) | Houses (2×2 tiles, top-left at the candidate) are placed first, nearest the camp, then huts; a band draws at most 12 buildings; buildings never stand on fields. `GroupView` gained `farms` so the layout updates when fields appear | Fields and buildings no longer overlap |
| 4.15 | Raft, boat and cart positions (§18.5) | Raft/boat on the nearest Water ground or River/Sea wall within 3 tiles of home; the cart on the tile right of home | "Nearest water" includes rivers and seas, where boats belong |
| 4.16 | "Era name shown on groups" | A small line with the era name above each group's name on the map, and in the inspector | Visible without clicking |
| 4.17 | Herd goats and city buildings (§18.5) | Not drawn yet: §24 lists them under step 5's village visuals. The herd size shows in the inspector | Keeps to the build order |
| 4.18 | Riders and facing (§19.1) | Riders face the way they move (flipped when going left) | Horses face right in the grid; a rider going left looked backwards |
| 4.19 | §11.8 sets no minimum size for a split. Scenario B's 4 desert founders are crowded from year 1 and split 2 + 2, so neither half could ever have children (this already happened in step 3) | A band only splits if both parts keep at least 4 people including a man 16+ and a woman 16–40 (`split.minPeople`) — the same test §14.4 uses for refugees | Real bands don't split below a breeding core; a 2-person "band" is a death sentence, not a daughter group |
