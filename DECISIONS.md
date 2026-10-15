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

## Step 5 — Villages, walls and contact

| # | Gap | Decision | Why |
|---|---|---|---|
| 5.1 | Who works in a village | Adults 15–59, as §11.10 says; elders don't work (they still count for teaching) | The blueprint's labour definition |
| 5.2 | Rebuilding individuals from a village (§11.10 "copies traits from a random sample member") | Sample members are dealt in shuffled rounds, so each is copied about equally often (still random). The "trait averages within 2%" test is checked on the average over 20 runs; one switch may be off by up to ~4% on a trait near 50, because the sample is 64 people | A single 64-person sample can't promise 2% on a trait where 2% is 1 point; dealing in rounds removes the extra noise from copying |
| 5.3 | Ages for the open 70+ bucket when rebuilding individuals | 70–79 (`village.oldestSpanYears`) | With 15% yearly deaths, few people pass 80; 70–100 would make old people too old |
| 5.4 | Village labour by score² lets a big shelter deficit put 90% of people on building, and the village starves | Support jobs (Explore, Care, Build) get the same falloff as in bands (DECISIONS 3.5), solved in a few damped rounds | Same rule as bands; food work is never crowded out |
| 5.5 | Labour shares can exceed the fields or herd | Farmers beyond 10 per field, and herders beyond the herd, gather instead | The land can't take more farmers |
| 5.6 | Adding people to a village ("sample merged and resized to 64") | The new sample takes members from each side in proportion to the people they stand for | 20 captives in a village of 1,000 should get ~1 sample place, not 20 |
| 5.7 | A village's childhood nutrition and adversity (§11.4 needs cn and ca) | 15-year moving averages of the fed ratio and of hard months (starving; war adds 3 months) | Matches a childhood; used for new sample members and rebuilt children |
| 5.8 | Village hunting "spread over the best tiles" | Each expected success hits the tile with the most prey at that moment | The same rule a band hunter follows, in expected values |
| 5.9 | "Adults" in war power and battle deaths | Fighting age 15–59 (`contact.fightingAgeMax`) | Matches the village labour age; children and elders don't fight |
| 5.10 | A group under pressure wore down the sea wall around the map edge — a breach there leads nowhere | A wall tile is only a target if a breach there would reach an area not yet connected to home | Nobody tunnels into the edge of the world; work goes to real barriers |
| 5.11 | Trading's food × 1.05 "that year" — contact is resolved at the end of the year | A year of trade gives × 1.05 to the following year's food | The bonus can only apply after the trade has happened |
| 5.12 | Village buildings vs. fields | Villages draw up to 30 buildings (city 2×3 first, then houses, then huts); fields are avoided unless there is no other room | Villages are surrounded by fields; their houses still need a place |
| 5.13 | Where herd goats wander | Within 2 tiles of home (`render.herdRadiusTiles`); village walkers within 3 (§18.5) | "Near home" |
| 5.14 | Refugees with no site 12+ tiles from the winner | They scatter (removed); founding a refugee group is logged as a movement entry "N people fled from X and founded Y" | Same viability rule as §14.4 |
| 5.15 | People moving between a band and a village (captives, absorbed groups, splits) | Into a village: counted and added to the sample (5.6). Into a band: village people are rebuilt as individuals (5.2) | Each mode keeps its own representation |
| 5.16 | Learned discoveries (trade, conquest, absorb) and eras | The era is recomputed at once | Otherwise the era would lag a year behind its discoveries |
| 5.17 | "Shortage this year" in the sample update | Any month with fed below 1 | The plainest reading |
| 5.18 | A group made by a split or by refugees with fewer than 150 people, coming from a village | Starts as a band of individuals | §11.8: only a group of 150+ starts as a village |
| 5.19 | Speed: site searches, "found" checks and wall searches dominated late games | Exact branch-and-bound for split and migration sites, found bits cached once a month, fruitless wall searches skipped until something relevant changes | Same results, several times faster |

## Step 6 — Events, graphs, full inspector

| # | Gap | Decision | Why |
|---|---|---|---|
| 6.1 | When exactly events start and end | At month 0 of the start year; a 30-year drought covers years start … start + 29 and ends at month 0 of start + 30. Die-offs and earthquakes strike at month 0 of their year (§15) | Matches §5.1 step 1 and "Year 500 … began" in the log |
| 6.2 | The half-strength ramp for very short droughts and wet periods | First and last year are half strength; a 1-year event is half strength all year | "First and last year at half strength" taken literally |
| 6.3 | Two rain events over one area | Their multipliers multiply | Simple and order-independent |
| 6.4 | Harsh winters "gather, hunt and herd food × 0.5" | Applied to every worker's yield in winter months; fields give nothing in winter anyway, so only gathering, hunting and herding change | One rule in one place |
| 6.5 | A child who starves during a plague month | Counts one hard month, not two | Adversity counts months |
| 6.6 | Which groups a plague hits | Groups whose home tile is in the plague's (original) area; a home on a breached wall tile belongs to no area | §15: "groups whose home is in the area" |
| 6.7 | An earthquake on a wall that is already broken there | Logged; nothing more opens | The crossing already exists |
| 6.8 | Does an earthquake count as breaching the segment? | Yes: the segment is marked breached, like a worn-through wall | Groups don't keep wearing a wall that is already open |
| 6.9 | Lineage filters for world events (planned events, breaches by nobody) | World events have no lineage: always shown, with a grey dot | They matter to every lineage |
| 6.10 | Graphs while viewing the past | The x axis still runs to the live year; lines stop at the viewed year and a white marker shows it. A lineage's trait lines stop when it has no people; its population line shows 0 | Keeps the axis steady while scrubbing; extinct lineages don't drag averages to 0 |
| 6.11 | Graph and log refresh rate | At most 4 times a second, only while their tab is open (`ui.graphs.redrawMs`) | At 8× a stats row arrives 8 times a second |
| 6.12 | Follow "turns on fog + territory" while the toolbar view buttons are one-at-a-time | Follow selects both Fog and Territory; any view button switches back to a single view | Both views at once is the point of Follow |
| 6.13 | Starting values in the event dialog | Year 100, 20 years, strength 50 (`ui.eventDialog`) | Something sensible to edit |
| 6.14 | Where run errors stop the run | The Run tab (Run ▶ disabled, with the reasons) and the bottom ▶ (shows the first error and opens the Run tab) | Both buttons start a run |
| 6.15 | "No Forest, Fruit bushes, Grass or prey within 6 tiles" | Painted plants with density > 0, or painted prey > 0, within the forage radius | The same 6-tile range the group forages |
| 6.16 | "Two groups' homes within 12 tiles in the same area" | Distance ≤ 12 (the contact distance, §14.1) and the same area at setup | Exactly the pairs that will meet in the first year |
| 6.17 | Scenario C's "plague hits villages harder than bands" | By year 800 every group in Scenario C is a village, so there is nothing to compare there; the unit test checks the rule instead (a band of 4: × 1.32; a village of 400 with Taming: × 5.8) | The scenario no longer contains bands when the plague comes |

## Step 7 — Tune and publish

| # | Gap | Decision | Why |
|---|---|---|---|
| 7.1 | Bands ignored deer and starved beside them: the v1 hunt score (§11.6) was about a quarter of the gather score, so hunting was 0% of adult work even at maximum hunger | **Rule change approved by the owner (future blueprint F0 §6.1):** Gather, Hunt, Farm and Herd are scored by the food each would bring this month: `base + (H + 10) × expected FU / 2`. Gatherers share the range's plant food, hunters share up to 20% of its prey food a month, herders count caught animals as a year of future food. A full gatherer at H = 0 still scores 15, as in v1, so support jobs keep their balance. Villages use the same scores with group averages | The owner saw bands starving next to herds of deer; real foragers took a large share of their food from hunting |
| 7.2 | Bands starved on stripped land: sites were compared by long-run capacity only (§11.8), so an eaten-out forest looked as good as a fresh one | **Rule change approved by the owner (F0 §6.2):** a site's value = ½ long-run yield + ½ × food there now ÷ 6 months; bands check from H > 40 and PA < 0.5 for 2 months (v1: 60, 0.4, 3) | Real foragers move camp to fresh ground before they starve |
| 7.3 | Small founder groups die out by chance: daughters can't pair with their father, and a 4-person band often has no unrelated partner left | A setup warning for groups under 10 people (`ui.smallGroupWarnBelow`); the People dialog default stays 2 + 2 (the owner's experiment). Marriage between groups is planned as F6 | Real bands were 25–50 people and married into neighbouring bands |
| 7.4 | The tutorial's "Load the example" needs Scenario B inside the game | The §26 scenario generators moved from `tests/fixtures.ts` to `src/presets/scenarios.ts`, shared by the game, the `presets/` files and the tests | One source for all three |
| 7.5 | Credits in the About panel | "Created by Rajamiththiran" (owner's answer, 15 Oct 2026) | Asked rather than guessed: the blueprint names "Vinush", the git user is "Rajamiththiran" |
