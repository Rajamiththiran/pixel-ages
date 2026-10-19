# Tuning log

Every change to a number in `src/config.ts` made to hit the goals in blueprint §26. Newest at the bottom.
Each pass: what changed, why, and the results before and after.

## Pass 1 — Step 3 (people), 14 Oct 2026

**Goal:** Scenario A (4 founders) alive at year 100 in at least 7 of seeds 1–10 (§24 Step 3).

**Before:** 8 of 20 seeds alive at year 100 with the blueprint's birth numbers (5% a month, 24 months nursing), after the rule fixes in DECISIONS 3.1–3.5. Surviving bands were well fed; deaths matched the §11.9 table exactly. The losses were founder effects: with two couples, one family of only sons ends the lineage.

| Variant (20 seeds) | Alive at year 100 |
|---|---|
| 5% a month, 24 months nursing (blueprint) | 8–9 / 20 |
| 7% a month, 24 months | 10 / 20 |
| 5% a month, 18 months | 11 / 20 |
| **7% a month, 18 months** | **13–14 / 20** |

**Change:** `people.birth.monthlyChance` 0.05 → 0.07, `hungryMonthlyChance` 0.025 → 0.035, `nursingMonths` 24 → 18.

**Why it stays "real forager numbers" (locked decision 13):** the average gap between births becomes about 2.7 years. Real forager birth intervals: Agta about 2.6 years, Ache about 3.2, Hadza about 3.4, !Kung about 4. Death rates are unchanged.

**After:** seeds 1–10 → 7 of 10 alive at year 100 (target met). Surviving lineages grow to bands of 15–60 and split (up to 3 bands by year 200).

**Notes for later tuning (step 7):** Fire (no winter death ×1.3) and Stone Tools (full hunting) arrive in step 4 and should raise survival further; re-check then and consider moving back toward 24 months nursing.

## Pass 2 — Step 4 (discoveries), 15 Oct 2026 — measured, nothing changed

**Goal (§24 Step 4):** Scenario A's first discoveries "usually within the first 50–150 years".

**Measured with the blueprint numbers (Scenario A, seeds 1–30):**

| | Result |
|---|---|
| First discovery | median year 23; only 4 of 30 seeds in years 50–150 |
| First discovery with every `baseChanceByEra` × 0.5 | median 23, 1 of 30 in 50–150 (more seeds find nothing by year 200) |
| First discovery with × 0.35 | median 33, 4 of 30 in 50–150 |
| Alive at year 100 / 300, discoveries on | 19 / 10 of 30 |
| Alive at year 100 / 300, discoveries off | 18 / 13 of 30 (same founder losses as step 3) |
| Population of surviving seeds at year 300 | 7,800–89,000 (without discoveries: 90–1,000) |
| Best era at year 300 | era 6 in 3 of 10 seeds (seeds 1–10) |

**Why no change yet:**

1. A yearly chance is memoryless: whatever the chance, at most about 40% of seeds can land inside one 100-year window, so "usually within 50–150" can't be reached by scaling. Lowering the chance mostly turns early discoveries into "nothing by year 200".
2. In Scenario A, Fire and Farming are both possible from year 0 (forest and Grassland with rain ≥ 30 are inside the starting radius), so several rolls run from the first year.
3. The fast eras come from runaway growth: a farming band has plenty of food, grows ~3% a year and, without village mode (step 5), stays a band of thousands. `sqrt(population)` then makes it very inventive. Villages (step 5) and events (step 6) change this, so tuning discovery chances now would have to be redone.

**For step 7:** retune with villages in place. Levers: `discoveries.baseChanceByEra` (era pace, tuning goal "era 6 not before ~3,000"), farming-era growth (births/deaths of farmers), and Scenario A survival over seeds 11–30 (~55–60% alive at year 100, below the 70% seen on seeds 1–10).

## Pass 3 — Step 7 (F0: hunting and moving camp), 15 Oct 2026

**Goal:** the owner saw bands ignore deer, herds and horses, and die out fast. Make hunting worth doing and bands move off stripped land (future blueprint F0), without losing v1 §26 survival (≥ 7/10 alive at year 100).

**Measured before (blueprint numbers, Scenario A, seeds 1–10, to year 300):** hunting 0–6% of adult work; a forest band starved at maximum hunger for ~50 years next to deer.

| Variant (Scenario A, seeds 1–10) | Hunting share of adult work (to year 300) | Band-months with H > 60 | Alive at year 100 |
|---|---|---|---|
| F0 rules, blueprint numbers | 1–6% | 0–10% | 6/10 |
| + huntYield 5, pairMaxOlderMan 25, preyMonthlyShare 0.05 | 2–23% | 0–7% | 7/10 |
| **+ preyMonthlyShare 0.2 (kept)** | **2–36% (9–36% in groups that survive)** | **0–7%** | **7/10** |

**Changes:**
- `people.food.huntYield` 3.0 → 5.0. A successful month of big-game hunting beats a month of gathering, as it did for real hunters; with Stone Tools and Spear a hunter brings ~2.8 FU, without tools ~0.9.
- `people.migrate.preyFoodValue` = 5.0 (matches huntYield).
- `people.pairMaxOlderMan` 20 → 25, so widowers can pair again (common in real foragers).
- New numbers for the F0 rules: `people.brain.food.*` and `people.migrate.nowWeight / campMonths / preyFoodValue`; migrate thresholds 60 → 40, 0.4 → 0.5, 3 → 2 months.

**What is still open (next passes):** groups that die out are tiny bands without Stone Tools that run out of unrelated partners (F6 marriage between groups would help). Discovery pace and farming-era growth are still far too fast (era 6 by ~year 260–300, population 2,000–7,000 at year 300); see pass 2.

## Pass 4 — F3 (fish), 15 Oct 2026

**Goal (future blueprint §9.7):** "a river or coast group without much land can grow on fish."

**Test world:** a 6-tile strip of grassland between a sea (left) and a mountain range (right), 8 founders on the shore, seeds 1–6, 150 years. Compared with and without Fishing.

| Variant | Without Fishing | With Fishing |
|---|---|---|
| Blueprint numbers (yield 2.0), rain 25 | all dead by year 23–57 | all dead by year 20–36 (fishing 3–20% of work) |
| yield 5.0, rain 25 (+ fish counted in sustainable food, DECISIONS 10.11) | all dead by year 23–57 | **alive in 6/6, 40–223 people, fishing 70–75% of work** |
| yield 5.0, rain 40 | all dead by year 33–83 | **alive in 6/6, 80–276 people, fishing 32–45% of work** |

**Change:** `future.fish.yield` 2.0 → 5.0 — the same step as `huntYield` in pass 3, for the same reason: at 2.0 a month of fishing a sea (density 0.5) brought 1 FU, half a gatherer's month, and a shore band starved next to a full sea.

**Real basis:** coastal and river foragers were often among the densest and most settled (salmon rivers, shell middens). At 5.0 a sea tile gives at most ~0.6 FU a month for ever, a river tile ~1.6 FU — still less than a field (20 FU).

**Still open (F3 acceptance, for F9):** "deer vanish from heavily hunted areas" is not reached. On a 20 × 20 island with up to ~200 spear hunters for 200 years, deer stayed at 106–122% of their start. Hunters take at most 20% of the range's prey food a month (`people.brain.food.preyMonthlyShare`, pass 3) and switch to other food as deer thin out, and one success takes only 1% of a tile's deer (`people.food.huntDepletion`), while deer regrow 3% a month. Levers: `huntDepletion`, `preyMonthlyShare`, `animals.prey.growth`. Not changed now because they are v1/F0 numbers.

## Pass 5 — F4 (forest regrowth), 15 Oct 2026

**Goal (future blueprint §10.8):** forest returns over cleared land and ruins at the default rain.

**Change:** `plants.forest.spreadMinRain` 55 → 45. At 55, forest never spread at the new-map rain of 50, so every clearing stayed open for good. At 45 forest spreads at rain 50 and still not in dry land (rain 25–44 keeps existing forest but never gains).

## Pass 6 — F6 (inequality and war), 16 Oct 2026

**Goal (future blueprint §12.9):** conflict gains raids and alliances without F6 turning every big village into a war machine.

**Measured:** Scenario D, 10 seeds, 600 years. At the starting numbers (inequality war, trade and absorb weights 20, cooperation fall 0.05) most villages got a chief, inequality settled near 0.8, and +16 on the war score put it above coexisting: median wars ~170 against ~100 with F6 off, ~3× the conquests, and a third of the people.

**Change:** `future.society.inequalityWarWeight`, `inequalityTradeWeight`, `inequalityAbsorbWeight` 20 → 5; `inequalityCoopFall` 0.05 → 0.1 (inequality settles near 0.38 at cooperation 50).

**Result:** median wars ~38 (fewer than with F6 off: walls and alliances deter), alliances in 9/10 seeds, raids in 5/10.

**Open for F9:** Scenario D population at year 600 is still below the F6-off runs. The largest part was wider contact spreading F5 outbreaks along trade links (now only horses widen contact, DECISIONS 13.16). F5 disease itself is strong: in one seed, turning outbreaks off tripled the population.
