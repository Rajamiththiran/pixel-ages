# C4: Chiefdoms and kingdoms — plan

Owner request, 28 Oct 2026: "a conquered village becomes part of the winner's chiefdom or kingdom instead of vanishing". Built after the founders, war and log fix (DECISIONS 20.x) was confirmed.

Decisions taken while building are logged in DECISIONS.md §21, and the numbers in TUNING.md.

---

## 1. In one paragraph

Today a beaten village is either driven from its land or scattered. With C4, a farming village with a chief can beat a settled village and **keep it**: the beaten village stays where it is with its people, fields and name, but pays a yearly **tribute** of food and stops making its own wars. A group that rules other villages heads a **chiefdom**. Once its capital has Writing and a City and it rules enough villages, it becomes a **kingdom**. Realms are never permanent. Villages **rebel** when the ruler is weak, far away, foreign or starving them, and a realm **falls apart** when its capital loses its chief or is destroyed. Over centuries the map shows realms rising, spreading and breaking up, as they did in history.

---

## 2. How it matches the real world

| Real pattern | Source / example | Rule in the game |
|---|---|---|
| Chiefdoms grew out of wars between **farming villages** that had nowhere to flee | Carneiro's circumscription theory (1970): Peru's coastal valleys, Polynesia | Only a **farming village with a chief** can hold what it conquers. A beaten village is held only if it is **settled**: a band of foragers is driven off as before |
| Rulers lived on **tribute**, about a tenth of the harvest | Tithes; Aztec tribute lists (Codex Mendoza); Inca labour tax | A subject sends **10%** of its food store to its ruler each year; **15%** in a kingdom, which taxes more efficiently |
| Chiefs **gave food back** in hard years: it bound villages to them | Service (1962), Polynesian redistribution; Mississippian granaries | A ruler with food to spare sends some to a **starving** subject |
| A chief could control only villages within about **half a day's walk** | Spencer (1990), Wright & Johnson (1975) | **Control range 16 km**; ×1.5 with riding, ×1.5 along a road, ×2 with Writing (scribes, records) |
| **States** need writing and cities: the first writing was tax accounting | Uruk tablets (~3200 BC) | A **kingdom** needs a capital with **Writing** and a **City**, at least **3** subject villages and **1,000** people |
| Chiefdoms **rose and fell** in cycles of 50–150 years | Anderson (1994), "chiefly cycling" in the Mississippian south-east | Yearly **unrest** in each subject; a revolt frees it. A capital that loses its chief or is destroyed lets every village go |
| Revolts came when the ruler was **weak, far away, foreign or harsh** | Assyria after Ashurbanipal; Inca provinces at the Spanish arrival | Unrest rises when the realm's strength (without the village) is under **1.5×** the village's, when the village is **hungry**, **far** from the capital, or speaks **another language** |
| Over generations, subjects **assimilated** | Roman provinces; Han China | Unrest falls by up to 70% over **100 years** in the realm, and is halved for close kin of the ruler |
| A realm acts **as one** in war; neighbours **ally against a rising power** | Balance of power: Greek leagues against Persia, Italian city-states | No war, raids or swallowing inside a realm. Subjects and the capital fight beside each other. Alliances weigh the **whole realm's** strength |
| Many tributaries **submitted** rather than being stormed | Aztec "flower war" submissions; vassal treaties | A side that is worn out by war may **submit** and pay tribute instead of making peace, if the winner can hold it |
| People **fled** the state's reach | Scott, *The Art of Not Being Governed* | A subject that **moves** beyond the control range is free |
| Daughter villages **stayed in** their mother's polity | Hawaiian and Mississippian chiefdoms | A village that **splits** from a realm member stays in the realm while it is within range |
| Conquering a capital took its **whole realm** | Akkad took Sumer's cities; the Inca took the Chimú | Beating a ruler hands its subjects to the winner (each one only if within the winner's range); the rest go free |

What stays the same: wars still start from hunger, crowding and missing resources (DECISIONS 20.x). C4 changes what **winning** means, not why groups fight.

---

## 3. Structural plan

### 3.1 Data (src/sim/state.ts)

Five numbers per group, no new list. Every realm is a **flat** two-level tree: a subject's ruler is always a free group, so finding a realm never walks a chain.

| Field | Meaning |
|---|---|
| `overlordId` | Ruler's group id; −1 = free |
| `subjectSince` | Year it began to pay tribute (for assimilation) |
| `tributePaid` | Food sent (or received, for a ruler) last year, in FU: for the inspector |
| `unrest` | Last year's chance of revolt, 0–1: for the inspector and tests |
| `realmRank` | On a ruler: 0 none, 1 chiefdom, 2 kingdom |
| `realmSince` | Year the rank was reached |

`headOf(g)` = `g.overlordId ≥ 0 ? g.overlordId : g.id`. Two groups share a realm when their heads match and the head rules at least one village.

### 3.2 Files

| File | What changes |
|---|---|
| `src/config.ts` | New `realms` block: every number in this plan, each with a comment |
| `src/sim/society/realms.ts` (new) | `controlRange`, `canHold`, `makeSubject`, `freeSubject`, `realmMembers`, `unrestOf`, `yearlyRealms` (tribute, relief, flight, revolts, ranks, logs) |
| `src/sim/society/contact.ts` | Pairs inside a realm skip deciding and live in peace. Battles add realm-mates as helpers. Conquest and war-weariness can make a subject. Decisions and alliances weigh the realm |
| `src/sim/people/groups.ts` | `newGroup` gets the new fields. `removeGroups` frees the subjects of a ruler that is gone, and logs the fall |
| `src/sim/people/transfer.ts` | `spawnGroup`: a daughter of a realm member starts in the realm |
| `src/sim/tick.ts` | `yearlyRealms(s)` after hazards, before society (tribute lands before the chief and surplus check) |
| `src/sim/society/society.ts` | Rulers gain a little inequality per subject (a ranked society) |
| `src/sim/stats.ts`, `src/shared/types.ts` | `ruled` per lineage (villages in realms it heads); world counts `realms` (chiefdoms, kingdoms, subjects, largest) |
| `src/shared/types.ts` | New log type `realm` |
| `src/shared/protocol.ts`, `src/sim/view.ts` | `GroupView` gets `realmHead`, `realmRank`, `realmColour`, `subjects`. `RelationView` gets kind `realm`. The inspector gets a **Realm** card |
| `src/render/realms.ts` (new) | Borders and fills, banners, tribute bearers |
| `src/render/effects.ts` | Realm moments (section 6) |
| `src/render/spriteData.ts`, `icons.ts` | Banner, pennant, crown and broken-chain sprites and icons |
| `src/render/renderer.ts`, `src/main.ts` | Wire the realm layer. Ruler labels ("Kingdom of …"). Realm lines |
| `src/ui/eventLog.ts`, `src/render/storyCam.ts`, `src/ui/graphs.ts` | "Realms" log filter, story-camera moments, a "Villages ruled" chart |
| `tests/realms.test.ts` (new) | Unit tests on tiny worlds (section 7) |
| `tests/_probe/bench.test.ts` | Realm line per group, and realm counts in the report |

### 3.3 Where it runs in the year

1. Contact (`yearlyContact`). Inside a realm: peace, trade, ideas, marriage. Outside: decide with realm strength, and fight with realm helpers. Conquest or submission makes a subject.
2. Hazards; empty groups removed (a removed ruler frees its subjects).
3. **Realms (`yearlyRealms`)**, groups in id order:
   1. A ruler that lost its chief, farming or village life lets its realm go.
   2. Subjects that moved beyond range go free.
   3. Revolts are rolled (seeded RNG, fixed order).
   4. Tribute is paid, and relief is sent to starving subjects.
   5. Ranks are updated (chiefdom or kingdom) and logged.
4. Society (chiefs, specialists, inequality), samples, stats.

It stays deterministic: only `s.rng`, groups in id order, and `Math.sqrt` for distances (allowed).

---

## 4. Game logic in detail

### 4.1 Who can hold a village (`canHold(ruler, village)`)
- The ruler is free (or is the head of the winner's realm), a **village** with a **chief** and **active Farming**.
- The beaten group is a **village** (settled), and is not the ruler itself.
- The two homes are within the ruler's **control range**: 16 tiles, ×1.5 riding, ×1.5 if a road joins them, ×2 with Writing.

### 4.2 Becoming a subject
- **Conquest:** when a battle ends in conquest, the winner's head is the would-be ruler. If it can hold the loser:
  - the loser loses **10%** as captives (hostages and slaves, not 50%) and becomes a subject;
  - the war ends;
  - the log reads "Garden conquered Hilltop: Hilltop now pays tribute (6 captured)".
  
  Otherwise the loser is driven off or scatters as today.
- **Submission:** when a war ends from weariness, the side that lost more of its people submits if:
  - the other side's head can hold it;
  - and the other realm is at least **2×** stronger.
  
  The log reads "Hilltop submitted to Garden after 3 years of war".
- **Taking a realm:** if the beaten group was itself a ruler, each of its subjects goes to the winner if within range, otherwise it is free. The log reads "…and its 2 villages with it".
- **Daughters:** a group that splits from a realm member starts in the realm. It goes free at once if it settles beyond range.

### 4.3 Inside a realm
- No war, raid or absorb between members. They trade every year: they learn each other's skills and maps, and food goes ×1.05. They marry and grow alike.
- **Tribute:** each year a subject sends 10% of its food store to the ruler (15% in a kingdom).
- **Relief:** if a subject's hunger is 60 or more and the ruler is not hungry, the ruler sends 10% of its store (a small event).
- The ruler gains **+0.005 inequality per subject** a year: a ranked society.

### 4.4 War with outsiders
- **Deciding:** when one side of a pair belongs to a realm, its strength counts the ruler and the realm-mates in contact with the other side.
- **Fighting:** they join the battle as helpers, like allies, and share its losses.
- **No absorbing:** an outsider cannot absorb a subject, which is protected. A subject may still take in a starving free group.
- **Alliances:** neighbours measure a ruler's threat by its **whole realm's** strength. A realm's own members never "ally against" it.

### 4.5 Unrest and revolt (each subject, each year)

```
unrest = 0.5%                                          base
       + 15%  if the realm without this village < 1.5 × its strength
       + 10% × hunger / 100
       +  5% × how far past half the control range it lives (0–1)
       +  3%  if it speaks another language
(for the first 10 years in the realm only the weak-ruler term counts: hostages, reprisals)
then   × (1 − 0.7 × min(1, years in the realm / 100))   assimilation
       × (1 − 0.5 × kinship with the ruler)             kin are loyal
       × 0.5 in a kingdom                                standing army, law
```

- **A revolt:** the village is free.
  - If it is in contact with the ruler, a war of independence begins, logged "Hilltop rebelled against Garden". Winning by conquest re-subjugates it; a peace means it stays free, with a truce.
  - Out of contact, it is logged "Hilltop broke free of Garden".
- **Collapse:** a ruler that loses its chief, its Farming or its village life, or is destroyed, absorbed or driven off, lets every subject go. The log reads "The chiefdom of Garden fell apart (4 villages went free)".

### 4.6 Ranks
- **Chiefdom:** a ruler with at least 1 subject. Logged "Garden founded a chiefdom: 2 villages, 640 people".
- **Kingdom:** a ruler with active Writing and City, at least 3 subjects and at least 1,000 people in the realm. Logged "Garden became the Kingdom of Garden: 5 villages, 2,100 people". A kingdom stays a kingdom while it rules at least one village and keeps Writing; it does not flap at the 3-village line.
- Losing all subjects ends the realm 10 years later (`graceYears`), unless the ruler wins a village back: "The chiefdom of Garden is no more".

### 4.7 Numbers (`CONFIG.realms`) — first values, tuned with the bench

| Number | Value |
|---|---|
| `controlRange` | 16 |
| `ridingMult` | 1.5 |
| `roadMult` | 1.5 |
| `writingMult` | 2 |
| `captureShare` | 0.1 |
| `submitRatio` | 2 |
| `tributeShare` | 0.1 |
| `kingdomTributeShare` | 0.15 |
| `reliefHunger` | 60 |
| `reliefShare` | 0.1 |
| `rebelBase` | 0.005 (was 0.01: TUNING pass 9) |
| `rebelWeakRatio` | 1.5 |
| `rebelWeak` | 0.15 |
| `rebelHunger` | 0.1 |
| `rebelFar` | 0.05 |
| `rebelForeign` | 0.03 |
| `assimilateYears` | 100 |
| `assimilateCut` | 0.7 |
| `kinLoyalty` | 0.5 |
| `kingdomRebelMult` | 0.5 |
| `kingdomMinSubjects` | 3 |
| `kingdomMinPop` | 1000 |
| `inequalityPerSubject` | 0.005 |
| `graceYears` | 10 |
| `cowedYears` | 10 |

---

## 5. Graphics

| What | How it looks | Where |
|---|---|---|
| **Realm borders** | Each realm's land is the home ranges of its villages, nearest home wins. It gets a soft wash in the ruler's colour (alpha ~0.12) and a 1-px border with a dotted stitch on its edge. A kingdom's border is solid and a little brighter. Drawn over the ground and under people, buildings and the night tint, so it reads like a map | `render/realms.ts`, drawn after the territory fill |
| **Capital banner** | A pole with a 2-frame waving flag in the ruler's colour beside the capital's temple. A kingdom's banner is taller with a gold finial | Sprites `banner_1/2`, `banner_royal_1/2` |
| **Subject pennant** | A small pennant in the **ruler's** colour on each subject village: who it pays is visible at a glance | Sprites `pennant_1/2` |
| **Labels** | The ruler's second line becomes "Chiefdom · 4 villages" or, in gold, "Kingdom · 9 villages" (instead of the era name). Subjects keep the era line | `main.ts` label builder |
| **Tribute bearers** | Once a season, a porter with a sack walks from each subject to its capital and back, along the straight line. With the Cart it is a cart. Only realms on screen; capped | `render/realms.ts`, visual only |
| **Realm lines** | With the relation-lines view on, a gold dotted line joins each subject to its capital | `RelationView` kind `realm`, `updateLines` in main |
| **Inspector** | A **Realm** card. On a ruler: rank, villages, people, tribute received, since when. On a subject: who it pays, since when, tribute paid, and how restless it is (calm / uneasy / restless) | `view.ts` |
| **Event log** | A "Realms" filter. Icons: crown (founded, kingdom), flag (joined), broken chain (revolt, fall) | `eventLog.ts`, `icons.ts` |
| **Graphs** | A "Villages ruled" chart per lineage: realms rising and falling are visible over the centuries | `graphs.ts`, `stats.ts` |

---

## 6. Visual effects (render only, never touch the simulation)

| Moment | Effect |
|---|---|
| A village **joins** (conquest or submission) | The pennant "rises": a flag icon floats up from the village, and a ring of sparks in the ruler's colour spreads out. The new border land fades in over ~1.5 s |
| A **chiefdom is founded** | A golden ring over the capital (like a new era), a crown icon rising, a short shower of gold sparks |
| A **kingdom** is proclaimed | Two golden rings one after the other, a larger crown, more sparks; the border turns solid with a gentle pulse for a few seconds |
| A **revolt** | A red ring at the rebel village, embers and smoke rising, and a broken-chain icon; the border around it flickers out |
| A realm **falls apart** | Dust puffs over the old capital; the whole border fades away over ~2 s instead of vanishing |
| A **border** changes (growth, loss) | The old and new borders cross-fade, so nothing pops |

The story camera also flies to realm founding, kingdoms, revolts and falls; they are big moments.

Sound (F8) is not changed in C4. A horn for a new kingdom could be added later if you want it.

---

## 7. How it will be checked

**Unit tests** (`tests/realms.test.ts`, tiny worlds, seconds):
1. A farming village with a chief that conquers a village makes it a subject. It stays put, keeps its name and loses 10%.
2. A band, a village out of range, or a winner without a chief or Farming: driven off as before.
3. Tribute moves 10% of the subject's food (15% in a kingdom). Relief goes to a starving subject.
4. Realm members never go to war, raid or absorb each other; they trade.
5. A subject's realm-mates and ruler join its battles.
6. Unrest formula: weak ruler, hunger, distance, language, assimilation, kin and kingdom.
7. A revolt frees the village and starts a war when in contact.
8. A removed or chiefless ruler frees all its subjects, logged once.
9. Conquering a ruler hands over its subjects in range (the realm stays flat).
10. Ranks: a chiefdom with 1 subject; a kingdom with Writing, City, 3 subjects and 1,000 people; no flapping.
11. Submission at the end of a weary war.
12. Determinism: the existing Scenario D replay test must still pass.

**Bench** (mini world, then Scenario A, several seeds), measured per century:
- the number of chiefdoms and kingdoms, villages per realm, how long realms last, revolts and falls, and share of villages in a realm;
- big log lines per century must not rise much against TUNING pass 8.

**First targets** (to confirm with the bench, then you judge by playing):
- in the farming eras, a few chiefdoms of 2–6 villages at a time, most lasting 50–200 years;
- kingdoms only after Writing and City, and rarer;
- no realm swallowing the whole map: unrest and alliances push back.

---

## 8. Build order

1. Logic: config, fields, `realms.ts`, contact changes, tick, unit tests.
2. Bench pass: tune the numbers, write TUNING.md and DECISIONS.md.
3. Graphics: GroupView fields, borders, banners and pennants, labels, tribute bearers, lines, inspector, log, graph.
4. Effects and the story camera.
5. Full test suite, the build, and the report to you. Then you try it.

**Not in C4** (later, if you want):
- realms with their own names ("the Two Rivers");
- succession and civil wars;
- ruler-appointed governors;
- sound cues.
