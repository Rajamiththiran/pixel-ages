# Pixel Ages — Future Updates Blueprint (v1.1 → v2.0)

*Draft for the owner's approval, 15 October 2026. Nothing here is built until the owner approves it.*

This document plans everything after Pixel Ages v1.0: people who change the land, a land that changes people back, disasters that come from people's own choices (floods, fires, disease), inventions that grow from practice, richer societies, and better graphics. It is written for **Claude Code** (the builder) and the **owner** (who decides), in the same way as [pixel-ages-blueprint.md](pixel-ages-blueprint.md).

---

## Contents

0. Read this first — rules for Claude Code
1. The idea in one page
2. Decisions the owner must make first
3. Glossary additions
4. How "real-world physics" works in this game
5. Data model additions
6. Update F0 — Fix first (people who hunt, move and survive)
7. Update F1 — Wood and materials
8. Update F2 — Inventions from practice
9. Update F3 — Food and environment
10. Update F4 — People change the landscape
11. Update F5 — Elements and hazards (fire, water, earth, air, disease)
12. Update F6 — Society, conflict and animals
13. Update F7 — Observer tools
14. Update F8 — Graphics and sound
15. Worker protocol additions
16. `config.ts` additions
17. Build plan — steps with acceptance criteria
18. Testing
19. New test scenarios and tuning goals
20. Performance budgets
21. Risks and open questions
22. Checklists and definition of done

---

## 0. Read this first — rules for Claude Code

1. **The v1 blueprint stays the source of truth** for everything it already covers. This document **adds to** it. Where this document changes a v1 rule, it says so and names the v1 section.
2. **Nothing here starts before v1.0 is published** (v1 Step 7 accepted), except **F0**, which is part of v1 Step 7 tuning.
3. **Every step needs the owner's approval** before it starts and after it ends, exactly like v1 (§0.2 of the v1 blueprint). Do not build features from later steps early.
4. **All v1 rules still apply:** determinism (seeded RNG, no `Math.random`/clocks/trig/`pow`/`exp`/`log` in `src/sim/`), every number in `config.ts`, simulation never touches the DOM, rendering never changes the simulation, only Vite + TypeScript + Vitest.
5. **Locked decisions (v1 §2) are only changed with the owner's explicit approval.** Section 2 lists which ones this plan needs to unlock.
6. **Gaps:** implement the option that best fits this document's goals and real-world patterns, and record it in `DECISIONS.md` (owner instruction, 14 Oct 2026).
7. **Every new system must stay repeatable:** same setup + same seed = same history, at any speed, after any jump in the timeline, and after save → load.
8. **Every new system must pay for itself in speed:** it gets a time budget (section 20). If it goes over, make it cheaper before moving on.
9. **Real, but simple.** Every rule follows a real-world pattern, written as a simple model with numbers that can be tuned. Never claim exact science.

---

## 1. The idea in one page

v1 is a world where people grow, discover, meet and collapse, but **the land barely changes** and **disasters only happen when the owner plans them**. The next versions close that loop:

```
people use the land  →  the land changes  →  people must adapt, move, invent or collapse
      ↑                                                                  ↓
lessons and discoveries  ←  disasters caused by how people live  ←  risk builds up
```

**What the owner will see:**

- Forests shrink around villages as people cut wood for huts, fires, boats and metal; deserts spread where goats overgraze; old fields wear out; irrigated land turns salty; abandoned villages become ruins that forest slowly swallows.
- Disasters come from people's choices: a dense thatch town burns, a city on the floodplain without drains floods, a crowded village next to its herds catches disease, a cleared mountain slope slides.
- Inventions grow from practice: a band that hunts a lot finds the spear and the bow; a village that keeps burning its huts learns to build in stone.
- Societies get specialists, leaders, intermarriage, culture, raids, walls and alliances.
- The map looks alive: seasons, day and night, weather, smoke, growing towns, roads, territories, and effects for fires and floods.

**What does not change:** the owner still paints the world, places groups, plans events, picks a seed and watches hands-off (an optional separate "intervention mode" is proposed in F7 and needs approval).

---

## 2. Decisions the owner must make first

| # | Topic | v1 locked decision | What this plan needs | Needed by |
|---|---|---|---|---|
| D1 | Materials | #4 "Materials are simple tile layers" | Groups also **store** materials (wood, metal). Wood comes from forest density, so no new painted layer | F1 |
| D2 | Layers | #7 tile layers | New **hidden** simulation layers (soil, salt, fire, flood, wear, ruins). The painted layers stay the same, plus two new painted resources (Tin, Salt) and one optional painted layer (Elevation, see D7) | F1, F3, F4 |
| D3 | Discoveries | #15 "6 eras + 19 discoveries" | About **36 discoveries**, still 6 eras | F2 |
| D4 | Out of scope (v1 §27) | Fishing, inbreeding, roads, languages/culture, wider diplomacy, sound | Move these **into** scope | F3, F4, F6, F8 |
| D5 | Hands-off | #22 "Hands-off during the run" | Optional **intervention mode**, clearly separate from experiments | F7 |
| D6 | Art | #26 terrain colour + grain, rough pixel sprites | Keep the style; add animation, seasons, day/night, effects | F8 |
| D7 | Elevation | — (none) | **Recommended:** an Elevation layer (0–9) painted with a brush, so floods run downhill and slopes can slide. Without it, F4/F5 use a simpler "near water / mountain" rule | F4 |
| D8 | Sound | v1 §27 | Optional ambient sound with a mute button | F8 |

**Recommendation:** approve D1–D4 and D6 together; decide D5, D7 and D8 when their step comes.

---

## 3. Glossary additions

| Term | Meaning |
|---|---|
| Wood | Group-stored material. Cut from forest; one unit lowers a forest tile's density |
| Fuel | Wood burned for fire, cooking, heating and smelting |
| Practice | Months a group has spent on an activity; raises related discovery chances |
| Fertility | 0–1 per tile: how well a field grows. Falls with farming, rises with rest, silt and manure |
| Salinity | 0–1 per tile: salt left by irrigation. High salinity ruins fields |
| Wear | 0–255 per tile: how much people walk there. High wear draws a path, then a road |
| Hazard | A disaster with a natural driver and a human driver (fire, flood, slide, disease…) |
| Prevention | A discovery or behaviour that lowers a hazard's chance or damage |
| Lesson | After a disaster, the related prevention discovery gets more likely for a while |
| Ruin | What remains of an abandoned settlement; fades back to nature over centuries |
| Culture | A group's inherited habits (sharing, warlike, openness), copied on splits with drift |
| Risk view | A map overlay showing how likely a hazard is on each tile |

---

## 4. How "real-world physics" works in this game

The game is not a physics engine. It models real processes with **simple, local, repeatable rules**. Every new process follows the same six principles.

### 4.1 The risk formula

Every hazard and every kind of land damage uses one shape:

```
chance (or rate) = base
                 × natural driver   (rain, season, dryness, slope, wind-free)
                 × human driver     (density, clearing, materials, herds, waste)
                 × (1 − prevention) (discoveries, skills, maintenance)
```

Example — town fire per village per month:

```
chance = 0.002 × dryness(month) × density × thatchShare × (1 − firebreaks) × (1 − stoneShare)
```

So the same drought hurts a stone town far less than a thatch town, and a careful group with firebreaks less than a careless one. That is the core of "design matters".

### 4.2 Spreading things (fire, flood, disease) are cellular

- They live in **per-tile state arrays** (typed arrays, struct-of-arrays, v1 §7).
- They spread to **neighbours** by fixed local rules, processed in **ascending tile index**, reading from a **copy of the previous state** (double buffer, v1 §16.2), so the order of processing never biases the result.
- Every random roll comes from `state.rng`, in that fixed order.

### 4.3 Time scales

1 tick = 1 month, 1 tile = 1 km. Real processes run at very different speeds, so each one is checked at the right cadence:

| Process | Real speed | Checked | How it fits a 1 km / 1 month grid |
|---|---|---|---|
| Wildfire | km per hour–day | monthly | A fire burns its whole connected fuel patch within the month, up to a spread limit (section 11.2) |
| River flood | days–weeks | yearly (wet season) | One flood roll per river stretch per year |
| Flash flood in town | hours | monthly (wet months) | One roll per village per heavy-rain month |
| Disease outbreak | weeks–months | monthly | Death multiplier while active |
| Soil wear, salt | years–decades | yearly | Slow counters per tile |
| Deforestation, regrowth | years–centuries | yearly | Forest density per tile (already exists) |
| Desert spread | decades | yearly | Counters like v1 §10.3 |
| Paths and roads | years | yearly | Wear counter per tile |
| Ruins fading | centuries | yearly | Ruin age per tile |

### 4.4 Conservation — nothing appears from nowhere

- Wood cut from a tile **is** that tile's lost density. Fuel burned is gone.
- Food burned in a fire, spoiled in a flood or eaten by pests is removed from the group store.
- Soil fertility used by crops returns only through fallow, silt or manure.
- Every number moves between the land and the groups in a way the inspector can show.

### 4.5 Aftermath and lessons

Every disaster leaves **state** and **history**:

- **On the map:** ash (fertile grass after 1–2 years), flood silt (+fertility), bare slopes, ruins, desert.
- **In the group:** losses, a log entry, children's adversity (v1 §11.4), and a **lesson** — for `lessonYears` years, the prevention discovery for that hazard is `lessonMult` times more likely (section 8.4).

### 4.6 Scale honesty

- One tile is 1 km², so the game shows **village- and region-scale** change, never single trees or houses.
- Rules are **simplified models** of real patterns (v1 §1). The documentation and the About panel say so.

---

## 5. Data model additions

### 5.1 New ids (`src/shared/ids.ts`)

```ts
export const Resource = { None: 0, Stone: 1, Clay: 2, Copper: 3, Iron: 4, Tin: 5, Salt: 6 } as const; // +Tin, +Salt
export const Species  = { Prey: 0, Predator: 1, Herd: 2, Riding: 3, Fish: 4 } as const;             // +Fish (not painted on land)
export const Action   = {
  None: 0, Gather: 1, Hunt: 2, Farm: 3, Herd: 4, Explore: 5, Care: 6, Build: 7, Wall: 8, Rest: 9, Teach: 10, Child: 11,
  Fish: 12, CutWood: 13, Craft: 14, Maintain: 15, Burn: 16,   // new
} as const;
export const Hazard = { Wildfire: 0, TownFire: 1, RiverFlood: 2, FlashFlood: 3, Landslide: 4, DustStorm: 5,
  Outbreak: 6, Pests: 7, Blight: 8, MineCollapse: 9 } as const;
```

### 5.2 New tile layers (worker only, all typed arrays)

| Field | Type | Meaning | Bytes/tile |
|---|---|---|---|
| `fertility` | Uint8 | 0–255 = 0–1 soil fertility | 1 |
| `salinity` | Uint8 | 0–255 = 0–1 salt | 1 |
| `fireState` | Uint8 | 0 none, 1–3 burning months left | 1 |
| `ashYears` | Uint8 | years since burned (fertile ash) | 1 |
| `floodMonths` | Uint8 | months of standing flood water | 1 |
| `wear` | Uint8 | path wear 0–255 | 1 |
| `ruinAge` | Uint16 | years since a settlement was abandoned here (0 = none) | 2 |
| `grazing` | Uint8 | this year's grazing pressure | 1 |
| `fish` | Float32 | fish density 0–1 on Water ground and River/Sea wall tiles | 4 |
| `elevation` | Uint8 | 0–9, painted (only if D7 is approved) | 1 |

Total ≈ 14 bytes per tile × 14,400 tiles ≈ 200 KB per state (keyframes copy it; the 150 MB keyframe cap still applies).

### 5.3 Group additions (`Group`)

```ts
wood: number;                 // stored wood units
metal: number;                // stored smelted metal units (bronze/iron tools and weapons)
practice: Float32Array;       // months of practice per activity (index = Practice id), decays slowly
lessons: Uint16Array;         // per Hazard: year until which its lesson boost lasts
culture: { sharing: number; warlike: number; openness: number }; // 0–100, inherited with drift
chief: boolean;               // has a leader (F6)
inequality: number;           // 0–1 (F6)
specialists: number;          // share of workers who are craftspeople (F6)
maintenance: number;          // 0–1 upkeep of canals, levees, drains, walls (F5)
fortification: 0 | 1 | 2;     // none, palisade, stone wall (F6)
discoveries: Uint32Array;     // 2 words (64 bits) instead of one number (D3)
inactive: Uint32Array;
```

**Bitmask change (D3):** v1 stores discoveries in one JavaScript number used as a 32-bit mask. With ~36 discoveries this becomes a `Uint32Array(2)`. All `has(mask, d)` calls move to `has(words, d)`. A migration test must show v1-era discoveries keep their ids.

### 5.4 State additions (`SimState`)

```ts
weatherYear: Float32Array;    // per climate cell: this year's rain anomaly (for floods and droughts, F5)
alliances: Alliance[];        // sorted (F6)
hazardsActive: ActiveHazard[];// outbreaks, blights with an end year (F5)
```

### 5.5 Save files

- `RunSetup.version` becomes **2**. v1 files still load: missing layers get defaults (elevation 0 everywhere, no tin/salt).
- Loading a v2 file in v1 shows the existing "different version" message.

### 5.6 Hashing and keyframes

Every new array joins `stateArrays()` (v1 `serialize.ts`) so determinism tests cover it. Every new group array is deep-copied by `cloneGroup`.

---

## 6. Update F0 — Fix first (people who hunt, move and survive)

*Part of v1 Step 7 tuning. Fixes what the owner saw: bands ignore deer, starve in place, and 4-person groups die out by chance.*

> **Status (15 Oct 2026): 6.1, 6.2 and 6.4 are built** (DECISIONS 7.1–7.3, TUNING pass 3). 6.3 (seasonal rounds) waits for the owner's decision.

### 6.1 Food jobs scored by expected food (rule change to v1 §11.6)

**Problem:** the v1 hunt score `(15 + H) × YA × (str/100) × tools × spear` is about a quarter of the gather score, so bands starve next to plenty of deer (measured: hunting 0% of adult work).

**New rule:** each food job's score uses the food it is expected to bring this month.

```
expectedGather = min(gatherCap × yieldMult × stoneTools, Σ plantFood of the best 4 range tiles)
expectedHunt   = huntSuccess × huntYield × bestPreyDensity × yieldMult
expectedFarm   = farmerCap × farmSeason × farmRain × yieldMult        (fields only)
expectedHerd   = min(20, herd) × herdYieldPerAnimal × yieldMult

score(job) = jobBase + (H + hungerFloor) × expected(job) / foodNeedAdult
```

Gather, Hunt, Farm and Herd then compete on real food. With tools and a spear, a hunter in deer country brings ~1.7 FU a month and is chosen often; without tools, hunting is chosen only when plants run short. Real foragers took roughly a third to a half of their food from hunting, varying a lot by region.

### 6.2 Moving camp when the land is stripped (rule change to v1 §11.8)

**Problem:** sites are compared by long-run capacity, so a stripped forest looks as good as a fresh one; bands stay and starve.

**New rule:**

```
siteScore = (1 − nowWeight) × sustainableYield(site)
          + nowWeight × foodNow(site) / campMonths
          − distancePenalty × distance
foodNow(site) = Σ plantFood + Σ prey × preyFoodValue over the site's range
```

- `nowWeight` 0.5, `campMonths` 6 (food for the next half year counts).
- Bands without fields check this every month when `H > 40` and `PA < 0.5` for 2 months (lower thresholds than v1).
- Real basis: foragers move camp every few weeks to months, following ripe plants and game.

### 6.3 Seasonal rounds (optional, owner decides)

Bands without fields may keep **two camps** (summer and winter) and move between them in spring and autumn if the second camp's `foodNow` is at least `seasonalGain` (1.3×) better. Real basis: many foragers had seasonal camps.

### 6.4 Small founder groups

- Setup validation (v1 §20.6) adds a **warning**: "Groups under 10 people often die out by chance (real bands were 25–50)."
- The People dialog default stays 2 men + 2 women (the owner's experiment uses 4).

### 6.5 F0 tests and acceptance

- **Tests:** in a forest full of deer with no plants left, hunters are chosen; expected-food scores order jobs correctly; a band on a stripped range moves to a fresh one within 6 months; small-group warning shows.
- **Acceptance:** in the reproduction world (forest, deer, 4 founders, rain 50), hunting is 15–50% of adult work before Farming; no band stays at H = 100 for more than 3 years while fresh land is known; Scenario A alive at year 100 ≥ 7/10.

---

## 7. Update F1 — Wood and materials

> **Status (15 Oct 2026): built on the owner's request, before v1.0 was published** (DECISIONS 8.1–8.15). Awaiting the owner's approval.

### 7.1 Wood

- **Source:** forest tiles. A forest tile at density 255 holds `woodPerFullTile` (100) wood units. Cutting one unit lowers density by `255 / woodPerFullTile`.
- **Action `CutWood`:** a worker cuts `woodPerWorker` (4) units a month from the known forest tile in range with the most density (ties → lowest index). Real basis: pre-industrial households burned roughly 1–2 m³ of wood per person per year.
- **Regrowth:** v1 §10.2 growth (+26 density a year toward the rain target) is the regrowth. A tile cut to 0 becomes `None` and grass spreads in, then forest returns if rain allows.
- **Brain score:** `cutWoodBase + woodNeedWeight × woodShortage`, where `woodShortage` is wood needed for the next 12 months minus wood stored, divided by the need.

### 7.2 What wood is used for

| Use | Wood | Notes |
|---|---|---|
| Hut | 6 | plus grass (no cost) |
| Mud-brick house | 4 | plus 20 clay units (v1 §12.6 deposits) |
| Stone house (new, F6) | 2 | plus 30 stone units |
| Raft / Boat | 10 / 30 | once per group; boats wear out every 30 years |
| Cart | 15 | once |
| Fire (fuel) | 0.08 per person per winter month, 0.02 other months | without fuel, Fire is **inactive** (v1 §12.6 style) |
| Pottery kiln | 0.5 per pottery-using year per 10 people | |
| Smelting | copper 4, bronze 6, iron 10 per metal unit | charcoal — real iron ages stripped whole regions |
| Palisade (F6) | 200 per village | |

### 7.3 Metals and new resources

- **Tin** (painted resource): **Bronze Working** needs Copper Working + Tin found. Tin is rare, so bronze makes long-distance trade valuable (real Bronze Age).
- **Salt** (painted resource): preserves food (spoilage × 0.8 with Salting); a valued trade good.
- **Metal stock:** smelting turns ore + wood into `metal`. Tools and weapons need metal (F2, F6). Without metal stock, metal-based effects go inactive.

### 7.4 F1 tests and acceptance

- **Tests:** cutting lowers density exactly; a tile cut to 0 becomes `None`; fire without fuel is inactive and logs once; smelting needs both ore and wood; save/load keeps wood and metal.
- **Acceptance:** a ring of thinned forest appears around big villages within 200 years; a forest-poor region (desert) can't keep Fire going without trade or moving; Scenario B still runs 10,000 years.

---

## 8. Update F2 — Inventions from practice

> **Status (15 Oct 2026): built on the owner's request** (DECISIONS 9.1–9.11): 40 discoveries, 2-word discovery sets, practice, needs, lessons (plague only until F5), contact diffusion, unused-skill decay, the 60% era rule. Awaiting the owner's approval.

### 8.1 Practice

Each group keeps `practice[p]` (months) for: hunting, gathering, farming, herding, fishing, fire use, clay work, wood work, metal work, building, sailing, fighting. Each month every worker adds 1 to their activity. Practice decays `practiceDecay` (2%) a year, so skills fade when unused.

### 8.2 Discovery chance (extends v1 §12.3)

```
chance = v1 chance
       × (1 + practiceWeight × min(1, practice[p] / (practiceFull × population)))   // learning by doing
       × (1 + needWeight × need[d])                                               // necessity
       × lessonMult if a related lesson is active                                 // section 4.5
```

- `need[d]`: hunger for food discoveries, cold (winter deaths) for fire and clothing, war losses for weapons and walls, fires for fire safety, floods for drainage and levees.
- Real basis: inventions came from people already doing the related work, under pressure.

### 8.3 The expanded discovery table (~36, still 6 eras)

| Era | Discoveries (v1 in normal text, **new in bold**) |
|---|---|
| 1 Foragers | Fire, Stone Tools, Spear, **Digging Stick**, **Dogs** |
| 2 Hunters | Raft, Clothing, Taming, **Bow**, **Fishing** (hooks), **Fire Safety** (clearings, controlled burning) |
| 3 Farmers | Farming, Pottery, Boat, **Sickle**, **Granary**, **Wells**, **Salting** |
| 4 Villages | Mud Brick, Irrigation, Wheel, Riding, **Drainage**, **Fishing Nets**, **Firebreaks**, **Palisade** |
| 5 Copper Age | Copper Working, Mining, Cart, **Bronze Working**, **Plough**, **Levees**, **Terraces** |
| 6 Iron & Writing | Writing, Iron Working, City, **Stone Building**, **Sewers**, **Crop Rotation**, **Sails** |

Every new discovery gets: needs found, needs discoveries, effect, resource use, practice link, need link — in a table like v1 §12.1. The era rule (v1 §12.4, "all but one of each era") changes to "**at least 60%** of each era" because eras are bigger.

### 8.4 Diffusion and decay

- **Contact diffusion** (no trade needed): neighbours in contact learn each other's discoveries at `contactLearnChance` (2%) × int/100 a year. Real basis: ideas crossed between neighbours through marriage and objects.
- **Skill decay:** a discovery whose practice has been 0 for `unusedForgetYears` (50) years has a yearly `unusedForgetChance` (5%) of being forgotten, on top of v1's population rule. Real basis: isolated groups lost unused skills (the Tasmanian case).

### 8.5 F2 tests and acceptance

- **Tests:** practice raises the chance exactly as the formula says; need raises the right discoveries; lessons expire; the 64-bit mask keeps v1 ids; decay forgets only unused skills; contact diffusion respects requirements.
- **Acceptance:** a group that hunts a lot finds Spear/Bow earlier than one that farms; a group hit by a town fire finds Firebreaks faster than its neighbours; §26 era timing goals still hold.

---

## 9. Update F3 — Food and environment

> **Status (15 Oct 2026): built on the owner's request** (DECISIONS 10.1–10.10): fish and the Fish job, local extinction, seasonal drift, soil fertility, salinity, granaries and pests. Awaiting the owner's approval.

### 9.1 Fishing (new action, v1 §27 moved into scope)

- **Fish** live on Water ground and on River and Sea wall tiles (density 0–1, logistic growth `fishGrowth` 0.04, capacity by water type: river 0.8, lake 0.6, sea 0.5).
- **Action `Fish`** (needs Fishing): a fisher takes `fishYield` (2.0) × density × yieldMult × (Nets ? 1.5 : 1) from the best water tile within the range; density −0.01 per catch.
- Real basis: coastal and river foragers were often dense and settled (salmon rivers, coastal shell middens).

### 9.2 Overhunting and extinction

- Densities below `extinctBelow` (0.01) for 5 years in an area mark that species **locally extinct** there: it can only come back by diffusion from another area.
- A log line "Deer are gone from Area 2". Real basis: large animals disappeared where humans hunted them hard.

### 9.3 Animal migration

Prey, Herd and Riding animals drift toward greener tiles in spring and back in autumn: during those months diffusion is biased toward neighbours with higher capacity K (`migrationBias` 0.5). Hunters follow automatically (they pick the best prey tile).

### 9.4 Soil fertility and fallow

```
each year, for a farmed tile:   fertility −= cropDrain (0.04)
for an unfarmed farm tile:      fertility += fallowGain (0.10)
with Herd on the range:         fertility += manureGain (0.02)
flood silt (F5):                fertility += siltGain (0.15)
farm yield × (0.4 + 0.6 × fertility)
Crop Rotation: cropDrain × 0.4
```

Groups choose fields by `rain × fertility` (extends v1 §11.5 ordering). Real basis: slash-and-burn and fallow cycles; manure; Nile silt.

### 9.5 Salinity

```
irrigated tile without Drainage:  salinity += saltRate (0.01) a year
with Drainage:                    salinity −= 0.02 a year
farm yield × (1 − salinity); salinity > 0.8 → the field is barren and abandoned
```

Real basis: salt slowly ruined southern Mesopotamian farmland.

### 9.6 Granaries and storage

- **Granary:** spoilage × 0.5 (on top of Pottery), and a village can store up to `granaryMonths` (12) months of need without extra loss.
- **Pests:** without Pottery/Granary, a store over 6 months of need loses `pestLoss` (5%) a month.

### 9.7 F3 tests and acceptance

- **Tests:** fish logistic growth; fishing yields; local extinction and return by diffusion; fertility arithmetic; salinity barren threshold; granary limits.
- **Acceptance:** a river or coast group without much land can grow on fish; an over-irrigated desert valley slowly loses yield over centuries unless it finds Drainage; deer vanish from heavily hunted areas.

---

## 10. Update F4 — People change the landscape

> **Status (15 Oct 2026): built on the owner's request; D7 decided: Elevation layer added** (DECISIONS 11.1–11.13, TUNING pass 5). Awaiting the owner's approval.

### 10.1 Deforestation

Comes from F1 (wood) plus field clearing (v1). Shows as a widening ring of thin forest, then grass, around villages. **Local drying (optional):** when forest cover in a climate cell (v1 §10.1) falls below `dryingForestShare` (20%), that cell's rain × `dryingMult` (0.9). Real basis: large clearings lower local rainfall.

### 10.2 Overgrazing → desert

```
grazing[tile] = herd animals on the tile / (herdCapacityPerTile × rainFactor)
if grazing > 1 for a year:   grass density −= overgrazeLoss (20)
if a dry tile (rain < 30) has no plants for overgrazeYears (10): desertify counter × 3
```

Real basis: overgrazing at desert edges (the Sahel).

### 10.3 Erosion and slopes

- **With Elevation (D7):** a tile's slope = largest height difference to a neighbour. Cleared slope tiles (forest gone) lose fertility `erosionRate × slope` a year; Terraces stop it.
- **Without Elevation:** Mountain-ground tiles and tiles next to Mountain walls count as slopes (slope 2).

### 10.4 Fire clearing (foragers)

**Action `Burn`** (needs Fire Safety): burns forest-edge tiles in the wet season to make grass, which raises prey capacity there. Done badly (dry season, no Fire Safety) it can start a wildfire (F5). Real basis: Aboriginal Australian fire-stick farming; deliberate burning in North America.

### 10.5 Mines and quarries

Tiles whose resource is used up show a quarry or mine pit; deep mines can collapse (F5).

### 10.6 Paths and roads

```
each month, for every worker:  wear on the straight line from home to work tile += 1 (capped 255)
each year: wear × 0.8 (unused paths fade)
wear ≥ 60 → path;  wear ≥ 160 with Wheel → road (carts and trade move faster: trade range × 1.5)
```

Lines between trade partners' homes also add wear. Real basis: tracks and roads followed daily use.

### 10.7 Canals and terraces

- **Irrigation canals:** with Irrigation, tiles between a field and water show canals; they need `maintenance` labour; neglected canals silt up (fields lose the irrigation bonus).
- **Terraces:** on slopes with Terraces, fields don't erode and keep their fertility.

### 10.8 Ruins and regrowth

- When a group dies out, migrates or is conquered, its building tiles get `ruinAge = 1`. Ruins draw as broken walls; after `ruinYears` (300) they are gone. Forest spreads over ruins at the normal rate.
- Real basis: abandoned cities swallowed by forest (Maya cities, Angkor).
- **Tuning note:** v1 forest spread needs rain ≥ 55, so at the default rain 50 forest never regrows. F4 lowers `forest.spreadMinRain` toward 45 (tuning, recorded in TUNING.md).

### 10.9 F4 tests and acceptance

- **Tests:** grazing pressure arithmetic; desertify acceleration; wear and fading; road threshold; ruin ageing; local drying only below the forest share.
- **Acceptance:** over 2,000 years in Scenario A the map visibly changes: thinned forests, paths between villages, some desert where herds are dense, ruins where groups collapsed, and forest returning after collapses.

---

## 11. Update F5 — Elements and hazards

> **Status (15 Oct 2026): built on the owner's request** (DECISIONS 12.1–12.16). Awaiting the owner's approval.

Every hazard follows section 4.1: **base × natural × human × (1 − prevention)**, leaves aftermath, and teaches a lesson.

### 11.1 Hazard table

| Hazard | Natural driver | Human driver | Prevention | Damage | Aftermath | Real example |
|---|---|---|---|---|---|---|
| **Wildfire** | dryness (low rain, summer/autumn) | campfires, burning, cleared dry edges | Fire Safety, clearings | burns plants, huts, stored food; kills a few | ash → fertile grass in 1–2 years | most wildfires are started by people |
| **Town fire** | dryness | dense thatch/wood buildings | Firebreaks, Stone Building, water stores | destroys buildings and stored food | rebuild; lesson | Rome, London |
| **River flood** | wet-year rain anomaly | homes and fields on the floodplain | Levees, homes on high ground | crops lost for the year, huts damaged, some deaths | silt (+fertility) | Nile, Yellow River |
| **Flash flood (town)** | heavy-rain month | big dense village without drains | Drainage, Sewers | deaths, disease boost | lesson | early cities |
| **Waterlogging** | — | irrigation without drainage | Drainage | field yield ×0.5 | — | Mesopotamia |
| **Polluted water** | — | big settlement, waste near water | Wells, Sewers | endemic death ×1.1–1.3 | — | cholera in towns |
| **Landslide** | heavy rain | cleared slopes | Terraces, slope forest | buries tiles; deaths if home | bare slope | mountain villages |
| **Dust storm** | dry, windy year | bare overgrazed/ploughed dry land | ground cover, smaller herds | fields lose fertility | — | the Dust Bowl |
| **Outbreak** | — | dense village + herds + trade links | distance from herds, Wells | death × up to 3 for 1–3 years; spreads to trade partners | lesson | measles, flu from livestock |
| **Pests** | — | big stores without pots | Pottery, Granary | stored food −5% a month | — | rats in grain |
| **Blight** | wet years | one crop on most fields | Crop Rotation | harvest ×0.3 for a year | — | Irish potato famine |
| **Mine collapse** | — | deep mines (Mining practice low) | Mining practice | deaths, mine lost | — | ancient flint mines |
| **Predators on herds** | predator density | unguarded herds | Dogs | herd −1–5% a month | — | wolves and flocks |

### 11.2 Fire model (cellular, monthly)

```
dryness(tile, month) = clamp(1 − rainNow / dryRainFull (60), 0, 1) × seasonDry[season]   // [0.3, 1.0, 0.8, 0.1]
fuel(tile)           = forest density/255 × 1.0 + grass density/255 × 0.6 + (huts/houses? 0.8 : 0)

Ignition (each month):
  campfire:  per group with Fire, p = igniteBase (0.003) × dryness(home) × forestShareNearHome × (1 − fireSafety)
  burning:   per Burn action, p = burnEscape (0.05) × dryness × (1 − fireSafety)
  lightning: per forest tile in summer, p = lightning (0.00002) × dryness           // rare, natural

Spread (inside the month, up to maxSpreadSteps = 6 rounds, double-buffered):
  each burning tile ignites each 8-neighbour j with p = spreadBase (0.35) × fuel(j) × dryness(j)
  Water, intact walls, bare and burned tiles don't burn; rivers act as firebreaks

Burning:
  a burning tile loses all plant density and plantFood; fireState = 2 + floor(fuel × 2) months, then ashYears = 1
  a home or building tile on fire: buildings −50%, stored food −30%, people there die with p = 0.02
Ash:
  tiles with ashYears 1–2 grow grass at double speed; prey capacity +20% (fresh growth)
```

Real basis: fire needs fuel and dryness; it stops at rivers and bare ground; ash fertilises; grazing animals return to fresh growth.

### 11.3 Flood model

- **River floodplain** = non-wall land tiles within `floodplainTiles` (2) of a River wall or Water ground, at elevation ≤ the water's + 1 (with D7) or just by distance (without).
- **Yearly wet-season roll** per river stretch (a connected river segment): `p = floodBase (0.04) × max(0, rainAnomaly) × (1 − levees × maintenance)`, where `rainAnomaly` = this year's rain ÷ normal − 1 over the cells it crosses.
- **Flood:** every floodplain tile of the stretch gets `floodMonths` = 1–3 in the wet season: this year's harvest on those fields lost, huts damaged, a small death chance for homes there, then **silt** (+fertility).
- **Flash flood in town:** villages with population ≥ `flashMinPop` (300) and no Drainage, in a month with rainNow ≥ `flashRain` (80): p = `flashBase` (0.05) × density; deaths and an outbreak boost.

### 11.4 Disease model

- **Endemic risk** per village each month: `death × (1 + endemicWeight × density × herdNearHome × (1 − wells))`.
- **Outbreak roll** per village per year: `p = outbreakBase × density × (herds ? 1.5 : 1) × tradeLinks`; an outbreak lasts 1–3 years with a death multiplier, and each trading partner rolls `spreadChance` (30%) a year to catch it. This is in addition to the owner's planned Plague (v1 §15).
- Children's adversity counts outbreak months (v1 §11.4).

### 11.5 Maintenance

Canals, levees, drains and walls have a `maintenance` level (0–1). It rises with `Maintain` work and falls `decay` (5%) a year. A population crash or a long war lowers maintenance → canals silt, levees fail, drains block. Real basis: irrigation and flood works failed when societies lost labour.

### 11.6 Lessons

After a hazard hits a group, its prevention discoveries get `lessonMult` (3×) chance for `lessonYears` (30). Clever, cooperative groups learn more (`× (0.5 + int/200) × (0.5 + coop/200)`).

### 11.7 F5 tests and acceptance

- **Tests:** fire stops at a river; fire spreads more in dry seasons; ash regrows grass; a stone town burns less than a thatch town; floods only touch floodplain tiles; levees cut floods; outbreaks spread only along trade links; maintenance decay; lessons expire; everything replays deterministically.
- **Acceptance:** in a dry forest scenario, careless groups start wildfires and careful ones rarely do; a dense floodplain city without drains floods in wet years; disease hits dense herding villages more than small bands; the log explains each disaster's cause.

---

## 12. Update F6 — Society, conflict and animals

> **Status (16 Oct 2026): built on the owner's request** (DECISIONS 13.1–13.18). Awaiting the owner's approval.

### 12.1 Specialists

When a group stores more than `surplusMonths` (6) months of food and has ≥ `specialistMinPop` (150) people, a share of workers become specialists: `specialists = min(0.15, 0.02 × surplusMonths)`. Each 1% of specialists gives +2% discovery chance and +2% tool and weapon quality. Real basis: the first full-time craftspeople appear in surplus-producing villages.

### 12.2 Leaders and inequality

- A **chief** appears in groups ≥ `chiefMinPop` (300) with surplus. Inequality grows with surplus and war wins, falls with cooperation.
- Effects: inequality raises the "selfish" share in food distribution (v1 §11.5) and war scores; it lowers absorb and trade scores.

### 12.3 Marriage between groups and inbreeding

- **Intermarriage:** groups in coexist or trade relations exchange `marriageShare` (2%) of unpaired young adults a year (band persons move; village counts and samples move). Real basis: exogamy linked foraging bands.
- **Inbreeding (v1 §27 moved in):** each group tracks `isolationYears` since it last received outsiders. Fertility × `(1 − inbreedPenalty × min(1, isolationYears / 200))` when population < 50.

### 12.4 Culture

Each group has `sharing`, `warlike` and `openness` (0–100), copied on splits with `cultureDrift` (gaussian × 3). They bias decisions: sharing → distribution weights; warlike → war score; openness → trade and learning. Neighbours drift toward each other slowly (diffusion). Real basis: cultural traits are inherited and spread like genes, but faster.

### 12.5 Language drift (v1 §27 moved in)

Groups of one lineage separated (no contact) for > `languageYears` (500) become different "peoples": trade and learning × 0.5 and coexist score −10 between them. Shown in the inspector.

### 12.6 Weapons and fortifications

- **Weapons** need materials: spear (wood), bow (wood), bronze (metal), iron (metal). War power multiplies by the best weapon the group can **equip** (metal stock covers its fighters).
- **Fortifications:** Palisade (200 wood) → defence × 1.3; Stone wall (Stone Building + 500 stone) → defence × 1.8. Built when war pressure is high.

### 12.7 Raids and alliances

- **Raid:** a hungry group (H > 70) may raid a neighbour's food store or herd instead of full war: takes `raidShare` (20%) of the store, few deaths. Real basis: raiding was the most common early conflict.
- **Alliance:** two groups that coexist or trade, both threatened by a third much stronger group (power ratio ≥ 2), ally: their power adds up in battles with it.

### 12.8 Animals

- **Dogs** (era 1): hunt success × 1.2; herd losses to predators × 0.3. Real basis: dogs were the first domesticated animal.
- **Domestication over time:** a tamed herd's `domestication` rises 1% a year of herding → yield × (1 + domestication).
- **Working animals:** Plough + herd → farm yield × 1.5; Riding/Cart + horses → trade range × 1.5.
- **Predators on herds:** herd loss = predator density × `herdPredation` (0.03) a month, × 0.3 with Dogs.

### 12.9 F6 tests and acceptance

- **Tests:** specialist share; chief appearance; intermarriage moves people both ways; inbreeding penalty only when isolated and small; culture drift and diffusion; weapon equip limits; fortification multipliers; raids take the right share; alliance power adds.
- **Acceptance:** across 10 seeds, conflict now includes raids and alliances; isolated tiny groups decline; Scenario B and D still run 10,000 years within the speed budget.

---

## 13. Update F7 — Observer tools

| Tool | What it does | Notes |
|---|---|---|
| **Family tree** | Click a band person: parents, partner, children, life events | Bands only; villages show the sample |
| **Life story** | A person's timeline: born, paired, children, jobs, injuries, death cause | Stored only for selected people (cost) |
| **Heatmaps** | Population density, food, era, conflict, fire risk, flood risk, fertility, salinity | Worker sends one layer on request |
| **Territory fills** | Each lineage's known/used land softly coloured | |
| **Trade and war lines** | Lines between groups by relation | |
| **Migration trails** | Fading arrows of past moves | |
| **Compare two runs** | Two runs (same seed, one change) side by side, graphs overlaid | Two workers; memory budget |
| **Export results** | Graphs and log as CSV | Download via browser |
| **Event markers on graphs** | Droughts, plagues, disasters shaded on the timeline | |
| **Intervention mode (D5)** | Drop a flood, start a fire, gift a discovery, move a group | Separate mode; each intervention is stored as a timed event, so the run stays repeatable; experiments stay hands-off |

**Tests:** CSV columns match YearStats; a run with interventions replays identically; comparing a run with itself shows identical lines. **Acceptance:** the owner can answer "what changed between run A and run B" from one screen.

---

## 14. Update F8 — Graphics and sound

All within the locked art style (D6), Canvas 2D, 60 fps budget (section 20). Effort: **S** small, **M** medium, **L** large.

### 14.1 Terrain and world
| Item | Effort |
|---|---|
| Seasons on all land (spring green, summer gold, autumn forest colours, winter snow at cold/high tiles) | M |
| Rivers with curved banks, flow and shimmer | M |
| Forest density look (sparse ↔ thick canopy, stumps where cut) | S |
| Height shading (with D7) | M |
| Beaches where land meets sea or lake | S |
| Paths and roads (from F4 wear) | M |
| Field crops by season, worn-out fields paler, salty fields white | S |
| Ruins (F4) | S |
| Burned land, ash, flood water, silt (F5) | S |
| Trampled clearings around camps | S |

### 14.2 Weather and time (visual only)
| Item | Effort |
|---|---|
| Rain and snow particles where rain falls now | M |
| Cloud shadows drifting | S |
| Day and night tint with glowing fires and windows | M |
| Drought cracks, wet-period puddles | S |

### 14.3 People and animals
| Item | Effort |
|---|---|
| Action poses (bending gatherer, farmer with hoe, woodcutter, fisher with rod, builder with log) | M |
| Carried items (basket, meat, wood, pot) | S |
| Hunting and fishing scenes | M |
| Herders walking with flocks | S |
| People around the fire at night | S |
| Battle crowds during war years | M |
| Animal behaviour: herds move together, wolves stalk, horses gallop | M |

### 14.4 Settlements
| Item | Effort |
|---|---|
| Buildings by era: lean-to → hut → longhouse → mud brick → stone → city block | M |
| Palisades and stone walls (F6) | M |
| Special buildings: granary, well, kiln, smithy, temple, scriptorium | M |
| Boats sailing rivers and coasts; carts on roads | M |
| Smoke from chimneys and fires; city haze | S |

### 14.5 Effects
| Item | Effort |
|---|---|
| Wildfire flames and smoke, then ash turning green | M |
| Flood water spreading, then mud | M |
| Breach/earthquake rocks and dust | S |
| Disease tint over sick villages | S |
| Discovery sparkle and icon; era-up glow | S |

### 14.6 Camera and presentation
| Item | Effort |
|---|---|
| Zoom 1×/2×/4× with mouse wheel and smooth movement | M |
| Follow cam on a selected group | S |
| Story mode: camera jumps to big moments | M |
| Time-lapse replay of the whole history | M |
| Screenshot and short GIF export | M |
| Photo mode (hide UI) | S |

### 14.7 Polish and sound (D8)
| Item | Effort |
|---|---|
| Pixel heading font, pixel icons for discoveries, eras, events, hazards | S |
| Colour-blind-safe lineage palette option | S |
| Ambient sound: birds, wind, rain, fire crackle, work sounds, with a mute button | M |

**Tests:** sprite grid checks (v1 §19.6) for every new sprite; rendering never reads or writes sim state (code review + test that the renderer only imports `shared/` types); screenshot driver runs without console errors. **Acceptance:** 60 fps with 6,000 people, 400 animals, 300 buildings, weather and effects on a mid-range laptop.

---

## 15. Worker protocol additions

```ts
// ToWorker
| { type: 'layer'; layer: 'population' | 'food' | 'era' | 'conflict' | 'fireRisk' | 'floodRisk' | 'fertility' | 'salinity' | null }
| { type: 'person'; personId: number }                 // life story / family tree
| { type: 'intervene'; event: PlannedEvent | Intervention }   // intervention mode only

// FromWorker
| { type: 'layer'; layer: string; data: Uint8Array }   // 1 byte per tile, transferred
| { type: 'person'; story: PersonStory }

// Frame additions
hazards?: Uint8Array;   // per tile: fire / flood / ash / ruin flags, only changed tiles (like tileUpdates)
wear?: Uint8Array;      // paths/roads, sent once a year
weather?: { cellRain: Float32Array };   // for visual rain/snow
```

All big arrays are transferred, never copied (v1 §22).

---

## 16. `config.ts` additions

Starting values; the final step tunes them. Every number used by a new rule lives here.

```ts
future: {
  // F0 — food jobs and camps
  food: { hungerFloor: 10, gatherBase: 5, huntBase: 5, farmBase: 15, herdBase: 10 },
  camp: { nowWeight: 0.5, campMonths: 6, hungerAbove: 40, plantAvailBelow: 0.5, months: 2, seasonalGain: 1.3 },
  smallGroupWarnBelow: 10,

  // F1 — wood and materials
  wood: { perFullTile: 100, perWorker: 4, fireWinter: 0.08, fireOther: 0.02, hut: 6, house: 4, stoneHouse: 2,
          raft: 10, boat: 30, boatLifeYears: 30, cart: 15, kilnPer10: 0.5, palisade: 200 },
  smelt: { copperWood: 4, bronzeWood: 6, ironWood: 10 },
  salting: { spoilageMult: 0.8 },   // Salt resource + Salting discovery: food keeps longer

  // F2 — practice and learning
  practice: { decayPerYear: 0.02, full: 24, weight: 1.0, needWeight: 1.0 },
  lessons: { mult: 3, years: 30 },
  diffusion: { contactLearnChance: 0.02, unusedForgetYears: 50, unusedForgetChance: 0.05 },
  eraShareNeeded: 0.6,

  // F3 — food and environment
  fish: { growth: 0.04, kRiver: 0.8, kLake: 0.6, kSea: 0.5, yield: 2.0, netsMult: 1.5, depletion: 0.01 },
  extinctBelow: 0.01, extinctYears: 5, migrationBias: 0.5,
  soil: { cropDrain: 0.04, fallowGain: 0.10, manureGain: 0.02, siltGain: 0.15, yieldBase: 0.4, rotationMult: 0.4 },
  salt: { rate: 0.01, drainage: 0.02, barrenAbove: 0.8 },
  store: { granaryMonths: 12, granarySpoilMult: 0.5, pestLoss: 0.05, pestAboveMonths: 6 },

  // F4 — landscape
  drying: { forestShare: 0.2, mult: 0.9 },
  grazing: { overgrazeLoss: 20, overgrazeYears: 10, desertifyMult: 3 },
  erosion: { rate: 0.03, mountainSlope: 2 },
  wear: { perWorkerMonth: 1, fadePerYear: 0.8, path: 60, road: 160, roadTradeMult: 1.5 },
  ruinYears: 300,

  // F5 — hazards
  fire: { dryRainFull: 60, seasonDry: [0.3, 1.0, 0.8, 0.1], igniteBase: 0.003, burnEscape: 0.05, lightning: 0.00002,
          spreadBase: 0.35, maxSpreadSteps: 6, buildingLoss: 0.5, storeLoss: 0.3, deathChance: 0.02, ashYears: 2, ashPreyBonus: 0.2,
          townBase: 0.002 },
  flood: { floodplainTiles: 2, base: 0.04, minMonths: 1, maxMonths: 3, deathChance: 0.005, flashMinPop: 300, flashRain: 80, flashBase: 0.05 },
  disease: { endemicWeight: 0.2, outbreakBase: 0.01, outbreakMult: 3, minYears: 1, maxYears: 3, spreadChance: 0.3 },
  blight: { base: 0.02, harvestMult: 0.3 },
  landslide: { base: 0.01, deathChance: 0.05 },
  dust: { base: 0.02, fertilityLoss: 0.1 },
  maintenance: { decayPerYear: 0.05, perWorkerMonth: 0.002 },

  // F6 — society
  society: { surplusMonths: 6, specialistMinPop: 150, specialistMax: 0.15, specialistPerSurplus: 0.02,
             chiefMinPop: 300, marriageShare: 0.02, inbreedPenalty: 0.3, inbreedYears: 200, inbreedBelowPop: 50,
             cultureDrift: 3, languageYears: 500, languageMult: 0.5, raidHunger: 70, raidShare: 0.2, allianceRatio: 2 },
  fortify: { palisade: 1.3, stoneWall: 1.8, stoneWallStone: 500 },
  animals: { dogsHunt: 1.2, dogsHerdLoss: 0.3, domesticationPerYear: 0.01, ploughMult: 1.5, herdPredation: 0.03 },
},
```

---

## 17. Build plan — steps with acceptance criteria

Same rhythm as v1: **build → tests → show the owner → wait for approval.** Each step keeps every earlier test passing and the speed budget (section 20).

| Step | Name | Depends on | Owner decisions | Size |
|---|---|---|---|---|
| **F0** | Fix first (part of v1 Step 7) | v1 Steps 1–6 | — | S |
| **F1** | Wood and materials | v1 published | D1, D2 | M |
| **F2** | Inventions from practice | F1 | D3 | L |
| **F3** | Food and environment | F2 | D4 (fishing) | M |
| **F4** | People change the landscape | F3 | D7 (elevation) | L |
| **F5** | Elements and hazards | F4 | — | L |
| **F6** | Society, conflict and animals | F5 | D4 (inbreeding, culture, language) | L |
| **F7** | Observer tools | F6 | D5 (intervention mode) | M |
| **F8** | Graphics and sound | can run alongside F3–F7 | D6, D8 | L |
| **F9** | Tune and publish v2.0 | F0–F8 | — | M |

### F0 — Fix first
**Build:** expected-food job scores (6.1); stripped-land camp moves (6.2); optional seasonal rounds (6.3); small-group warning (6.4); tune v1 §26 goals.
**Tests:** section 6.5. **Acceptance:** section 6.5 + v1 Step 7 acceptance.

### F1 — Wood and materials
**Build:** `CutWood` action and brain score; wood costs for buildings, boats, carts; fuel for Fire and kilns; Tin and Salt resources and brushes; Bronze Working; smelting with charcoal; metal stock; inspector shows wood and metal; forest thinning visible.
**Tests:** section 7.4. **Acceptance:** section 7.4.

### F2 — Inventions from practice
**Build:** practice counters and decay; practice/need/lesson multipliers; 64-bit discovery masks with migration; the expanded table (8.3) and the 60% era rule; contact diffusion; unused-skill decay; inspector shows practice and lessons.
**Tests:** section 8.5. **Acceptance:** section 8.5.

### F3 — Food and environment
**Build:** fish layer, `Fish` action, Fishing and Nets; local extinction; seasonal animal drift; fertility and fallow; salinity and Drainage; granaries and pests.
**Tests:** section 9.7. **Acceptance:** section 9.7.

### F4 — People change the landscape
**Build:** local drying; overgrazing and desert acceleration; erosion (with or without Elevation); fire clearing (`Burn`); mines/quarries; wear, paths, roads; canals and terraces; ruins and regrowth; tune forest regrowth rain.
**Tests:** section 10.9. **Acceptance:** section 10.9.

### F5 — Elements and hazards
**Build:** hazard framework (risk formula, aftermath, lessons, log); fire model (11.2); flood model (11.3); disease model (11.4); landslides, dust storms, blight, pests, mine collapse, predators on herds; maintenance (11.5); risk views.
**Tests:** section 11.7. **Acceptance:** section 11.7.

### F6 — Society, conflict and animals
**Build:** specialists; chiefs and inequality; intermarriage and inbreeding; culture and language drift; weapons and fortifications; raids and alliances; dogs, domestication, working animals.
**Tests:** section 12.9. **Acceptance:** section 12.9.

### F7 — Observer tools
**Build:** section 13. **Tests/Acceptance:** section 13.

### F8 — Graphics and sound
**Build:** section 14, in priority order: seasons + day/night → growing settlements with smoke and lights → territory fills, trade/war lines → action poses and carried items → fire/flood effects → zoom levels and follow cam → the rest.
**Tests/Acceptance:** section 14.

### F9 — Tune and publish v2.0
**Build:** run all scenarios (v1 A–D and new E–H) with `LONG=1`; change only `config.ts`; record each pass in TUNING.md; update the tutorial (new cards: "The land changes", "Disasters have causes"); update presets, README, About; production build and itch.io zip.
**Acceptance:** section 19 tuning goals met or accepted by the owner; v2 runs v1 run files; the zip runs on itch.io.

---

## 18. Testing

### 18.1 Kinds of tests

| Kind | What | When |
|---|---|---|
| **Unit** | Every formula in this document, with hand-checked numbers (like v1's worked examples) | every step |
| **Determinism** | Same seed → same hash; keyframe restore → same hash; batch size doesn't matter; save → load → same hash. Every new array is in the hash | every step |
| **Forbidden-API scan** | The v1 scan covers all new `src/sim/` files | every step |
| **Conservation** | Wood, food and fertility totals add up: what one place loses, another gains or it's logged as destroyed | F1, F3, F5 |
| **Scenario (short)** | 50–300 year runs checking each new behaviour appears | every step |
| **Scenario (long, `LONG=1`)** | 10,000-year runs of every scenario, summary tables | F4, F5, F6, F9 |
| **Performance** | Years per second at the late game, memory, frame time | every step |
| **Visual** | Headless-Chrome driver takes screenshots of each new look; no console errors | F4, F5, F8 |
| **Regression** | v1 tuning goals (v1 §26) still met | every step |
| **Save compatibility** | v1 run files load and run in v2 | F1, F9 |

### 18.2 Rules for tests

- Hand-checked numbers come from the formulas here, not from running the code.
- Statistical tests run enough seeds and check averages with a stated tolerance (like v1 DECISIONS 5.2).
- Long tests print a table the owner can read; they never fail on exact numbers, only on goals.

---

## 19. New test scenarios and tuning goals

### Scenario E — "Fire season"
Dry forest (rain 35–45) with grassland edges; 3 groups: one cooperative and clever, one average, one careless (low cooperation, low intelligence). Seeds 1–10, drift slow.
**Goals:** wildfires happen in most seeds; the careless group starts most of them; burned land regrows within 20 years; at least one group finds Fire Safety after a fire.

### Scenario F — "Floodplain city"
A wide river valley with rich floodplain soil, dry uplands, rain 40 with a Wet period every 300 years. 2 groups: one on the floodplain, one on the upland edge.
**Goals:** the floodplain group grows faster but suffers floods; it finds Levees/Drainage in most seeds before year 3,000; silt keeps its fields fertile; the upland group grows slower but steadier.

### Scenario G — "Overgrazed steppe"
Grassland at rain 25–35 with many wild herd animals; 2 herding-friendly groups.
**Goals:** herds grow; desert spreads where herds are dense in most seeds; groups that move their herds or keep them smaller keep their grass longer.

### Scenario H — "Island isolation"
A small island (Sea walls) with 6 founders and a large mainland with 4 groups.
**Goals:** the island group loses unused skills over time in most seeds (Tasmanian effect); intermarriage keeps mainland groups healthier; the island's culture drifts away from the mainland's.

### Existing scenarios
v1 Scenarios A–D keep their v1 §26 goals, plus: in A over 10,000 years, the map shows thinned forests, paths, at least one ruin, and regrowth after collapse.

---

## 20. Performance budgets

| Measure | Budget |
|---|---|
| Late-game simulation speed (Scenario D, full map) | ≥ 4 years/s (v1), target ≥ 5 |
| Cost of each new step at the late game | ≤ 15% extra time per step |
| Fire spread | ≤ 2 ms per month even with 1,000 burning tiles |
| Memory (Scenario D, 10,000 years, keyframes included) | < 1 GB |
| Frame time | 60 fps with 6,000 people, 400 animals, 300 buildings, weather and effects |
| Frame size | Hazard and wear layers only send changed tiles |

**How to stay inside:** check slow processes yearly, not monthly; spread fire only from burning tiles; cache per-tile values that rarely change (like v1 Step 5: home ranges, "near water"); profile in-process with `node:inspector` inside a Vitest probe; measure before and after each step and record it in the step report.

---

## 21. Risks and open questions

| Risk | Why it matters | Plan |
|---|---|---|
| Too many systems at once | Hard to tune; results hard to explain | Strict step order; each step tuned enough to pass its own acceptance |
| Speed | Each system adds work every month | Budgets (section 20); yearly cadence where possible |
| Determinism bugs | New spreading rules are easy to make order-dependent | Double buffers, fixed order, hash tests every step |
| Balance | Hazards could wipe out everything, or never matter | Scenarios E–H with explicit goals; lessons give recovery |
| Experiment bias | New rules could favour high or low intelligence unfairly | Owner reviews any rule that uses intelligence; record in DECISIONS.md |
| Save compatibility | v1 files must keep working | Version 2 loader with defaults; tests |
| Discovery mask size | 36 discoveries don't fit one 32-bit mask | `Uint32Array(2)` with a migration test (5.3) |
| Elevation (D7) | Painting height is extra work for the owner | Optional; simpler fallback rules without it |

**Open questions for the owner:**

1. Approve D1–D4 and D6 now? Decide D5, D7, D8 later?
2. Should F0 seasonal rounds (6.3) be included, or keep camps simple?
3. Is intervention mode (D5) wanted at all, or should the game stay purely hands-off?
4. Should graphics (F8) run alongside the simulation steps, or wait until F7 is done?

---

## 22. Checklists and definition of done

### 22.1 Every step (copy into each step report)

- [ ] Owner approved the step before it started
- [ ] Every new number is in `config.ts` with a comment
- [ ] No forbidden API in `src/sim/`; renderer never changes sim state
- [ ] New state arrays are in `cloneState`, `cloneGroup` and the hash
- [ ] Unit tests for every formula, with hand-checked numbers
- [ ] Determinism, keyframe and save/load tests pass
- [ ] Short scenario tests show the new behaviour
- [ ] Performance measured before/after; inside the budget
- [ ] Gaps recorded in `DECISIONS.md`; tuning in `TUNING.md`
- [ ] Inspector, log and (if visual) screenshots show the new behaviour
- [ ] `npm test` and `npm run build` pass
- [ ] Step report: what was built, test results, numbers measured, decisions, what to try
- [ ] Owner approved the step after trying it

### 22.2 Definition of done (v2.0)

- [ ] F0–F9 accepted by the owner
- [ ] All tests pass, including long scenario runs; determinism and forbidden-API scans pass
- [ ] Scenarios A–H meet their goals, or the owner accepted the differences
- [ ] v1 run files load and replay
- [ ] Scenario D runs 10,000 years at ≥ 4 years/s late game, under 1 GB
- [ ] Every new sprite matches its grid; 60 fps budget met
- [ ] README, About, tutorial, TUNING.md, DECISIONS.md and this document are up to date
- [ ] The itch.io build works from a zip upload
