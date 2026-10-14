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
