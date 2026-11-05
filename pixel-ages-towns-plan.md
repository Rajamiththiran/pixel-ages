# G1: Towns that grow — plan

Owner request, 28 Oct 2026, after watching 2,000 years:

> "no bigger city is built, never a market is built … it will look like just a repetitive motion (built demolished built demolished)".

The owner chose this part first. Diplomacy and the built world (roads, reservoirs, bridges) come after it, each with its own plan.

---

> **Built 29 Oct 2026.** Changes found by the bench are in DECISIONS 22.x and TUNING pass 10: market reach 20 km, a market cannot open within reach of a bigger one, no craftspeople needed to open one, villagers keep 4 months and sell half the rest.

## 1. The problem, measured

| What you see | Why (the code today) |
|---|---|
| The same small villages everywhere | A settlement only eats what its own land within **6 km** gives. When need passes 1.1× that for a year, it **splits**, and the daughter village founds another small village. Food barely moves between settlements: trade adds 5%, and C4 tribute is 10% of a store. So growth becomes **more villages**, never **bigger ones** |
| Built, demolished, built, demolished | A group switches to **village** mode at 150 people and back to **band** at 100. Groups near those numbers flip again and again: about 1,000 "grew into a village" and 1,000 "became a band" lines per 1,000 years in Scenario A. Hungry groups move house and leave ruins |
| No market, no town | Neither exists. There is no exchange of goods, and no settlement class above "village" |
| Slow history | Each group's chance of a discovery grows with the square root of **its own** population. Groups stay small, so the pace stays slow. Nothing is scripted: every discovery is a yearly chance roll |

---

## 2. How it matches the real world

| Real pattern | Source / example | Rule in the game |
|---|---|---|
| Towns grew because **food flowed in** from the countryside | Uruk, medieval market towns; von Thünen's rings | A town counts the food it **buys and receives** (market, tribute) as well as its own land. It only splits when **all** of that cannot feed it |
| Farmers traded **surplus grain for crafts** at a market | Market towns, Christaller's central places | Villages within a day's walk sell part of their **surplus** to the nearest market town and get **crafts** back: better tools, so higher yields |
| A market needed a **big enough town** with craftspeople and **neighbours** to come | Central place theory: a hierarchy of markets | A market opens in a settlement of 300+ people with craftspeople and at least 2 villages in reach. Each village sells to the nearest market, so markets space themselves out |
| Bigger towns farmed **farther out** | Infield and outfield; carts | A town's field range grows with its size: 6 km, +1 km per 500 people, up to 10. Carts and roads add reach for market trade |
| Farmers **stayed put**: fields and houses were years of work | Sedentism | A group with fields and houses stays a village (it no longer flips back to band unless it falls under 50 people and has no fields). Settled groups move only after a much longer famine |
| Daughter villages settled **near** the town | Settlement hierarchies (town + hamlets) | A split from a town prefers a site **inside its market reach**: it becomes a supplier, not a rival far away |
| **Ideas come faster in towns** | Many minds, specialists, exchange | Unchanged formula. Towns have more people and craftspeople, so they invent faster on their own. **No date is set for cities:** they come when towns grow |
| A **city** is a big town with civic life | Uruk (~40,000), Mohenjo-daro | Sizes: hamlet < 100 · village 100–499 · **town** 500+ (or any market) · **city** 2,000+ with the City discovery |

---

## 3. Structural plan

### 3.1 Data (src/sim/state.ts, per group)

| Field | Meaning |
|---|---|
| `market` | It holds a market (bool, with `marketSince`) |
| `marketId` | The market town it sells to (−1 none) |
| `imports` | Food bought or received last year, FU (market + tribute) |
| `exports` | Food sold last year, FU |
| `craftBonus` | Yield bonus from crafts bought this year (0–`craftMax`) |
| `sizeClass` | 0 hamlet, 1 village, 2 town, 3 city (display, logs, buildings) |

### 3.2 Files

| File | What changes |
|---|---|
| `src/config.ts` | New `towns` block (section 4.6), every number commented |
| `src/sim/society/markets.ts` (new) | Market towns (open, close), who sells where, the yearly exchange, size classes and their log lines |
| `src/sim/people/food.ts` | Crowding counts imports: need ÷ (own yield + imports a month) |
| `src/sim/people/farming.ts` | Field range grows with town size; `craftBonus` in field yield |
| `src/sim/people/village.ts`, `movement.ts` | Mode switch hysteresis (village stays village); settled groups move only after longer famine; daughters prefer a site in market reach |
| `src/sim/tick.ts` | `yearlyMarkets(s)` after realms, before society |
| `src/sim/society/realms.ts` | Tribute counts as imports |
| `src/sim/stats.ts`, `src/ui/graphs.ts` | "Largest settlement" per lineage; towns and cities counted |
| `src/shared/protocol.ts`, `src/sim/view.ts` | `GroupView.sizeClass`, `market`, `marketId`; inspector **Town** card |
| `src/render/decor.ts`, `spriteData.ts` | Town and city layouts (a plaza and lanes, denser houses), market stalls |
| `src/render/markets.ts` (new) | Market-day crowd, carriers and carts bringing food in |
| `src/render/effects.ts`, `storyCam.ts`, `src/ui/eventLog.ts` | Moments: market opened, became a town, became a city |
| `tests/towns.test.ts` (new) | Unit tests on tiny worlds |

### 3.3 Where it runs in the year

Contact, then hazards, then realms (C4), then **markets** (new), then society.

The markets step runs groups in id order:
1. Markets open or close (with a 10-year hysteresis).
2. Each settled group picks its market.
3. Food moves and crafts come back.
4. Imports are recorded for next year's crowding.
5. Size classes are updated and logged.

It stays deterministic: no randomness is needed beyond the existing RNG, and the order is fixed.

---

## 4. Game logic in detail

### 4.1 Market towns
- **Open:** a settled, free or ruling group of `marketMinPop` (300)+ people with craftspeople (F6 specialists > 0), and at least `marketMinVillages` (2) settled groups at peace with it within **market reach**. Market reach is 12 km, ×1.5 along a road, ×1.5 with the Cart.
- **Close:** after 10 years without those conditions, so a bad year does not flap it.
- **Spacing:** each village sells to the **nearest** market in reach (ties go to the larger one). A market left with no sellers for 10 years closes, so markets space themselves out naturally.
- **No market across a war:** villages at war with a market town don't sell to it.

### 4.2 The exchange (yearly)
- A seller keeps `keepMonths` (6) months of its own need. Of the food above that, it sells `sellShare` (25%) to its market town.
- The town's craftspeople pay in goods. The seller's `craftBonus` becomes min(`craftMax` 0.15, `craftPerSpecialist` × the town's specialist share × 10) for the next year: fields, herds and wood yield × (1 + craftBonus).
- The town records `imports`. C4 tribute is added to imports.
- **Real basis:** grain for pottery, tools and cloth at the market. Villages gain better tools; the town gains food to grow.

### 4.3 Crowding and splitting with imports

```
supply   = own wild food + fields + herds + fish (as today) + imports last year / 12
crowding = need / supply
```

- A town fed by its villages no longer splits.
- If its villages fail (drought, war), imports fall, the town crowds and suffers, and may split or starve. Towns rise and fall with their hinterland.
- A split from a group in a market's reach prefers a new site still inside that reach, ≥ 2R from home as today: a new supplier village.

### 4.4 Settled life (stops build and demolish)
- **Band/village switch:** a village goes back to band mode only under `toBandBelow` 50 people and with no fields (today: under 100). "Grew into a village" is logged once per group.
- **Moving house:** a group with fields and houses moves house only after `settledMigrateMonths` (36) months of hunger (bands: as today).

### 4.5 Size classes

| Class | Rule |
|---|---|
| Hamlet | Under 100 people |
| Village | 100–499 |
| Town | 500+, or any settlement holding a market |
| City | 2,000+ with the City discovery active |

- **Logged:** "Garden 5 grew into a town (620 people)" and "Garden 5 became a city (2,140 people)". Shrinking is logged as a small event.
- **Field range:** a town's field range is 6 + floor(pop / 500), up to 10 km, so a big town farms an outer ring.

### 4.6 Numbers (`CONFIG.towns`) — first values, tuned with the bench

| Number | Value |
|---|---|
| `marketMinPop` | 300 |
| `marketMinVillages` | 2 |
| `marketReach` | 20 (was 12: TUNING pass 10) |
| `roadMult` | 1.5 |
| `cartMult` | 1.5 |
| `marketHoldYears` | 10 |
| `keepMonths` | 4 (was 6) |
| `sellShare` | 0.5 (was 0.25) |
| `craftFloor` | 0.3 |
| `craftMax` | 0.15 |
| `craftPerSpecialist` | 1 |
| `townPop` | 500 |
| `cityPop` | 2000 |
| `fieldRangePer` | 500 |
| `fieldRangeMax` | 10 |
| `toBandBelow` | 50 |
| `settledMigrateMonths` | 36 |

---

## 5. Graphics

| What | How it looks |
|---|---|
| **Town layout** | A town's buildings gather round a small **plaza** with a well. Lanes are drawn between house rows, and houses pack closer than in a village. A city adds stone blocks, a temple and a wall ring (existing city sprites, laid out denser) |
| **Market** | 3–6 striped **stalls** on the plaza, the stripes in the town's colour. On market days, every few seconds of play, people from the selling villages walk in with baskets and walk home. Groups with the Cart send carts |
| **Labels** | The second line shows the size: "Town · 1,240" or "City · 4,800". Villages and hamlets keep the era line. A C4 realm title still wins on a capital |
| **Inspector** | A **Town** card: size class; market (since when, buys from N villages, food bought last year); or "sells to Garden 5 (45 FU last year, crafts +8% yield)"; field range |
| **Graphs** | A "Largest settlement" chart per lineage |
| **Event log** | A "Towns" filter. Icons: market stall, town, city |

## 6. Visual effects

| Moment | Effect |
|---|---|
| A **market opens** | Bunting flags pop over the plaza and a ring of coloured sparks spreads; a stall icon rises |
| Grows into a **town** | A soft golden ring and a house icon |
| Becomes a **city** | Two golden rings, a city icon and sparks; the camera visits (story mode) |
| Hinterland in famine | Fewer carriers walk in; the market stalls stand empty (the crowd thins with last year's imports) |

---

## 7. How it will be checked

**Unit tests** (tiny worlds, seconds):
1. A market opens with 300+ people, craftspeople and 2 villages in reach, and closes after 10 years without them.
2. A village sells 25% of its surplus above 6 months to the nearest market and gets the craft bonus.
3. Crowding counts imports, so a supplied town does not split.
4. Splits in market reach settle inside it.
5. A village with fields does not flip back to band at 99 people.
6. Size classes and their log lines.
7. Determinism (the existing replay test).

**Bench** (mini world, then Scenario A seeds 19 and 3, 2,000 years), against today:
- the size of the largest settlement over time;
- towns and cities per century, and markets;
- splits and moves per century;
- band/village flips per century, which should fall by about 90%;
- the year of each era, to measure the pace that emerges;
- big log lines per century.

**First targets** (then you judge by playing):
- Scenario A has a few towns of 500–2,000 by year 1,000–1,500, each with villages around it.
- Fewer, longer-lived settlements.
- Cities once City is found, and that comes sooner than year 3,000 because towns invent faster.

---

## 8. Build order

1. Settled life: the switch hysteresis and longer famine before moving, so the flip and ruin churn stops first.
2. Markets and the exchange, imports in crowding, splits inside market reach; unit tests.
3. Size classes and town field range; bench pass and tuning (TUNING.md, DECISIONS.md).
4. Graphics: town layout, market stalls, carriers, labels, inspector, graph, log.
5. Effects and the story camera; the full suite and the build; the report. Then you try it.

**Next plans** (each after this one is approved):
- **Diplomacy:** trust between neighbours, treaties, marriage alliances, gifts, joining a chiefdom by choice, leagues.
- **Built world:** roads built between towns, market squares, dug reservoirs, bridges (item 7), granaries.
