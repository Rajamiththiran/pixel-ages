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
