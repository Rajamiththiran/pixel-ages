// src/config.ts — every tunable number lives here. Units: tiles (1 km), months, FU.
export const CONFIG = {
  map: { width: 160, height: 90, tilePx: 8 },

  time: {
    ticksPerYear: 12,
    ticksPerSecond1x: 12,        // 1 year per second
    fastMultiplier: 8,           // the 8× button
    maxFramesPerSecond: 30,
    maxWorkMsPerLoop: 50,
    // Added in step 2: if the computer falls behind, at most this much real time is "owed",
    // so a slow machine runs as fast as it can instead of trying to catch up forever.
    maxBacklogSeconds: 0.5,
    speedWindowMs: 1000,         // real speed ("years/s") is measured over this window
  },

  seasonOfMonth: [0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3], // 0 spring, 1 summer, 2 autumn, 3 winter

  rain: { factorDivisor: 60, factorMax: 1.3 },

  climate: {
    cellsX: 8, cellsY: 5,
    reversion: 0.995,
    sigma: { off: 0, slow: 0.01, strong: 0.025 },
    minMult: 0.3, maxMult: 1.7,
  },

  plants: {
    maxStock: [0, 1.5, 3.0, 0.4, 0],  // FU by Plant id: None, Forest, FruitBushes, Grass, Farmland
    regenRate: 0.2,
    seasonRegen: [1.2, 1.0, 0.8, 0.2],
    growPerYear: 26,
    diePerYear: 13,
    // spreadMinRain tuned in F4 (TUNING.md pass 5): 55 → 45, so forest returns after clearing at the default rain 50.
    forest: { dieBelowRain: 25, fullAtRain: 50, spreadMinRain: 45, spreadChance: 0.02, groundMult: [1, 0, 0, 0.5] },
    fruit:  { dieBelowRain: 30, fullAtRain: 40, spreadMinRain: 40, spreadChance: 0.01, groundMult: [1, 0, 0, 0] },
    grass:  { dieBelowRain: 10, fullAtRain: 30, spreadMinRain: 15, spreadChance: 0.05, groundMult: [1, 0.4, 0, 0.5] },
    spreadSourceMinDensity: 128,
    newPlantDensity: 26,
    farmlandIdleYears: 3,
    farmlandRevertDensity: 128,
  },

  ground: { desertifyBelowRain: 10, desertifyYears: 50, greenAtRain: 30, greenYears: 50 },

  animals: {
    // suitability by Ground id [Grassland, Desert, Water, Mountain]; tiles with Forest density ≥ forestMinDensity use `forest`
    prey:   { ground: [0.8, 0.1, 0, 0.3], forest: 1.0, growth: 0.03 },
    herd:   { ground: [1.0, 0.4, 0, 0.8], forest: 0.2, growth: 0.02 },
    riding: { ground: [1.0, 0.2, 0, 0.1], forest: 0.1, growth: 0.015 },
    forestMinDensity: 128,
    capacityRainBase: 0.3,       // K = suitability × clamp(0.3 + rain/100, 0.3, 1)
    noHabitatDecay: 0.05,
    predation: 0.05,
    predatorGain: 0.02,
    predatorDeath: 0.01,
    diffusion: 0.03,
    foundAtDensity: 0.05,
    // Added in step 2: densities below this are set to 0 (local extinction). Without it,
    // decay never reaches 0 and float denormals slow the whole simulation down.
    minDensity: 0.0001,
  },

  people: {
    founderKnownRadius: 3,
    ages: { adult: 15, elder: 60, maxAge: 100, explorerMaxAge: 45, hunterMaxAge: 59 },
    foodNeed: { child: 0.6, adult: 1.0, elder: 0.8 },
    // Tuned in step 3 (TUNING.md pass 1): 5% → 7% a month and 24 → 18 months nursing, so the
    // birth interval is ~2.7 years (real forager range: Agta ~2.6, Ache ~3.2, !Kung ~4).
    birth: { minAge: 16, maxAge: 40, monthlyChance: 0.07, hungryMonthlyChance: 0.035, nursingMonths: 18, hungryAboveH: 60 },
    // annual 6%, 1%, 1.5%, 3%, 6%, 15% → monthly = 1 − (1 − annual)^(1/12), precomputed
    deathMonthly: [
      { upToAge: 5, p: 0.00514 },
      { upToAge: 15, p: 0.000837 },
      { upToAge: 50, p: 0.001259 },
      { upToAge: 60, p: 0.002535 },
      { upToAge: 70, p: 0.00514 },
      { upToAge: 101, p: 0.01345 },
    ],
    deathMult: { starving: 3, malnourished: 1.5, harshHomeNoClothing: 1.5, winterNoFire: 1.3, mudBrick: 0.8, lowHealth: 2 },
    fed: { starvingBelow: 0.5, malnourishedBelow: 0.8 },
    health: { max: 100, starvingLoss: 20, injuryLoss: 30, regen: 10, restRegen: 20, lowBelow: 30, restBelow: 70 },
    predators: { attackBase: 0.01, spearMult: 0.5, hunterExposure: 1.5, deathShare: 0.5, strDivisor: 200, coopDivisor: 300 },
    traits: {
      intelligence: { min: 40, max: 180, setupMin: 60, setupMax: 160, mendelSd: 7.5, setupSpreadSd: 7.5 },
      cooperation:  { min: 0, max: 100, setupMin: 0, setupMax: 100, mendelSd: 5, setupSpreadSd: 5 },
      strength:     { min: 0, max: 100, setupMin: 0, setupMax: 100, mendelSd: 5, setupSpreadSd: 5 },
    },
    environment: {
      goodNutrition: 0.9,
      intNutritionSlope: 40, intNutritionMin: -20,
      intLearningPerEra: 1.5, intLearningWriting: 3, intLearningMax: 10,
      strNutritionSlope: 30, strNutritionMin: -25,
      coopAdversityPenalty: 15, coopGoodChildhoodBonus: 5,
      strFoodFloor: 0.7, strAgingFromAge: 50, strAgingPerYear: 0.015, strAgingMin: 0.4,
    },
    food: {
      spoilage: 0.10, spoilagePottery: 0.06,
      gatherCap: 2.0, stoneToolsGatherMult: 1.2,
      huntBaseSuccess: 0.5, huntNoToolsMult: 0.5, huntSpearMult: 1.5, huntCoopDivisor: 200,
      huntMaxSuccess: 0.95, huntDepletion: 0.01,
      // Tuned in step 7 (TUNING.md pass 3): 3.0 → 5.0. A successful hunt beats a month of gathering, as real
      // big-game hunting did; with tools and a spear a hunter brings ~2.8 FU, without tools ~0.9.
      huntYield: 5.0,
      huntStrengthBase: 0.5,     // success = 0.5 × (0.5 + strength/100) × … (§11.5)
      gatherMaxTiles: 4,         // a gatherer visits at most this many tiles a month to fill their cap (DECISIONS 3.1)
      farmerCap: 2.0, farmersPerTile: 10, farmMinRain: 30, irrigationDistance: 2,
      farmSeason: [0.4, 0.93, 2.67, 0], ironFarmMult: 1.2,
      herdPerHerder: 20, herdYieldPerAnimal: 0.08, herdGrowth: 0.015, herdCapturePerHerder: 2, herdCapacityPerTile: 5,
      herdAnimalsPerDensity: 10, // a tile's wild herd density 1.0 = 10 catchable animals (§11.5)
      cookedMult: 1.15, copperMult: 1.15, intYieldDivisor: 400, tradeMult: 1.05,
    },
    distribution: { selfishness: 0.5, childBase: 0.5, carerMult: 0.7 },
    hunger: { fedWeight: 200, storageWorry: 30, storageWorryPerMonth: 7.5, fedMonths: 3 },
    care: { reductionPerCarer: 0.02, minMult: 0.7 },
    teach: { minAge: 50, minInt: 90, perShare: 3, maxBonus: 0.3, villageShare: 0.3 },
    build: { hutMonths: 2, houseMonths: 6, familiesPerHut: 1, familiesPerHouse: 3, villagePeoplePerHouse: 10, villagePeoplePerHut: 5 },
    range: { forage: 6, explore: 8, migrate: 25, cartExploreMult: 2, ridingExploreMult: 3, cartMigrateMult: 2, ridingMigrateMult: 2 },
    reveal: { base: 2, intStart: 60, intStep: 40, min: 1, max: 5 },
    brain: {
      nudge: 10,
      // Food jobs are scored by the food they would bring (future blueprint F0, DECISIONS 7.1):
      // score = base + (H + hungerFloor) × expected FU / gatherCap. A full gatherer at H = 0 scores
      // 15, like v1, so support jobs keep their balance.
      food: {
        hungerFloor: 10, gatherBase: 5, huntBase: 5, farmBase: 15, herdBase: 10,
        herdInvestMonths: 12,    // a caught animal counts as a year of future herd food
        preyMonthlyShare: 0.2,   // hunters can take up to ~20% of the range's prey food a month without emptying it
        villageHunterShare: 0.25, // villages estimate a quarter of workers might hunt when sharing prey
      },
      exploreBase: 10, exploreIntDivisor: 2, exploreCrowdWeight: 40, exploreCrowdStart: 0.9, exploreHungerWeight: 0.5,
      careKidsWeight: 40, careHungerWeight: 0.5,
      buildBase: 25, buildPerFamily: 5,
      wallWeight: 70,
      restWeight: 1.5,
      teachBase: 20, teachIntDivisor: 2, teachKidsWeight: 20,
      // Support jobs (Explore, Care, Build, Teach) lose score as more of the band already does
      // them this month: score × max(0, 1 − falloff × share). At falloff 2, at most about half
      // the adults take any one support job (DECISIONS 3.5).
      supportFalloff: 2,
    },
    groupSize: { bandMax: 60, toVillageAt: 150, toBandBelow: 100 },
    split: {
      crowdingAbove: 1.1, months: 12, bandChance: 0.10, villageChance: 0.05, coopBase: 1.2, bandShare: 0.4, villageShare: 0.3, minDistanceR: 2,
      minPeople: 4,              // added in step 4: both halves of a split keep 4+ people incl. a man 16+ and a woman 16–40 (DECISIONS 4.19)
    },
    // Tuned in step 7 (F0): bands move sooner (H > 40 and PA < 0.5 for 2 months; v1: 60, 0.4, 3) and
    // judge sites by the food there now as well as the long-run yield (DECISIONS 7.2).
    migrate: {
      hungerAbove: 40, months: 2, plantAvailBelow: 0.5, farmerHungerAbove: 80, farmerMonths: 12, logMinDistance: 10, distancePenalty: 0.5, sampleStep: 2,
      nowWeight: 0.5,            // site score = (1 − w) × sustainable yield + w × food there now / campMonths
      campMonths: 6,             // food on hand counts as feeding the next half year
      preyFoodValue: 5.0,        // FU per unit of prey density on a tile (= food.huntYield)
    },
    village: {
      sampleSize: 64, revealsPerExplorer: 0.2, birthIntervalMonths: 44, fertileShare: 25 / 35, traitHazardDivisor: 250,
      // Added in step 5 (numbers inside §11.10):
      bucketYears: [5, 10, 35, 10, 10], // years in buckets 0–4; the 70+ bucket only loses people to death
      oldestSpanYears: 10,       // a 70+ person rebuilt as an individual gets an age of 70–79 (DECISIONS 5.3)
      traitHazardMid: 50,        // sample death × (1 + (50 − strength) / 250) × (shortage ? 1 + (coop − 50) / 250 : 1)
      sampleNoiseShare: 0.5,     // copies of sample members get gaussian × mendelSd × 0.5 noise
      labourFalloffRounds: 10,   // damped rounds of the support-job falloff when sharing village labour (DECISIONS 5.4)
      hungryBirthMult: 0.5,      // expected births are halved when H > 60
    },
    sustainable: { plantShare: 0.1, preyValue: 0.3 },   // plantShare = regenRate × 0.5
    // Added in step 3:
    founderFoodMonths: 2,        // founders arrive carrying this many months of food
    crowdingMax: 10,             // crowding when the range can sustain nothing at all
    splitNameStart: 2,           // first split of "Desert" is "Desert 2"
    childMonths: 180,            // months of childhood used for cn / ca (§11.4)
    // Age window for pairing (DECISIONS 3.2): the man may be up to 25 years older or 5 years
    // younger. Without it, older widows pair for life with young men and young women find nobody.
    pairMaxOlderMan: 25,         // tuned in step 7 (TUNING.md pass 3): 20 → 25, so widowers can pair again
    pairMaxOlderWoman: 5,
  },

  discoveries: {
    baseChanceByEra: [0.02, 0.015, 0.01, 0.007, 0.005, 0.003],
    writingChanceMult: 1.3,
    resourceUsePer: 50,
    // Stone Tools use a tenth as much: a knapper makes dozens of tools from a kilo of flint, and a
    // known outcrop served a region for millennia (DECISIONS 17.4).
    stoneUsePer: 500,
    // Painted clay beside water (river banks, lake shores) comes back with silt: 5 units a year,
    // up to what was painted, so a dug-out bank refills in about 50 years (DECISIONS 17.5).
    clayRenewPerYear: 5,
    cityMinPop: 500,
    // Added in step 4 (numbers inside the §12.3 formula):
    spareFoodFrom: 0.5,          // spareFood = clamp((fed12 − 0.5) × 2, 0, 1)
    spareFoodScale: 2,
    popSqrtDivisor: 5,           // × sqrt(population) / 5
  },

  // Future updates (pixel-ages-future-blueprint.md §16). Starting values; tuned in F9.
  future: {
    // F1 — wood and materials (§7). Real basis: pre-industrial households burned ~1–2 m³ of wood a person a year.
    wood: {
      perFullTile: 100,          // wood units in a forest tile at density 255
      perWorker: 4,              // units one woodcutter cuts a month (= 10 density points)
      fireWinter: 0.08, fireOther: 0.02, // fuel per person per month with Fire; without it Fire goes inactive
      hut: 6, house: 4,          // per building (a house also needs houseClay)
      houseClay: 20,             // clay units per mud-brick house, from known deposits
      raft: 10, boat: 30, cart: 15, // once per group; without the wood the discovery is inactive
      boatLifeYears: 30,         // a boat wears out and must be rebuilt
      kilnPer10: 0.5,            // Pottery: kiln wood per 10 people a year
      cutBase: 0,                // CutWood score = cutBase + needWeight × shortage (0–1 of the next 12 months' need)
      needWeight: 40,            // a full shortage beats gathering at low hunger (15), loses to it when hungry
      fuelUrgentMonths: 2,       // with less fuel than 2 winter months, cutting is scored by the fire's cooking bonus
      // Once the forest within the forage range is gone, woodcutters walk to known forest up to 10 km
      // away and bring back half as much (the rest of the day is the walk). Real basis: where land is
      // cleared, people walk 5–10 km for firewood (DECISIONS 17.3).
      farRangeTiles: 10,
      farEfficiency: 0.5,
      // Where wood falls short, a group burns dung, straw and dry grass (DECISIONS 17.6). Fuel a
      // month: per herd animal, per field tile in the range (straw: a wheat field leaves 3–5 t a
      // hectare, about a third of it spare after fodder and thatch) and per Grass tile (dry grass
      // and brush). Real basis: steppe, plains and treeless farming peoples cooked and heated
      // with dung and straw. 1 wood unit ≈ 2.4 person-years of fuel (see fireWinter / fireOther).
      dungPerAnimal: 0.05,
      strawPerField: 3,
      grassPerTile: 1,
    },
    // Smelting (charcoal): wood per metal unit. Real iron ages stripped whole regions of forest.
    smelt: {
      copperWood: 4, bronzeWood: 6, ironWood: 10,
      metalWearPerYear: 0.1,     // stored metal (tools, weapons) wears out; it covers years with no smelting
    },
    bronze: { foodMult: 1.05 },  // Bronze Working: harder tools than copper (its weapons: F6 `weapons`)

    // F2 — inventions from practice (§8). Real basis: inventions came from people already doing
    // the related work, under pressure; unused skills were lost (the Tasmanian case).
    practice: {
      decayPerYear: 0.02,        // practice fades 2% a year
      full: 24,                  // practice / (24 × population) = 1 gives the full boost
      weight: 1.0,               // chance × (1 + 1.0 × practice share): up to ×2
      needWeight: 1.0,           // chance × (1 + 1.0 × need): up to ×2
      // Activities without their own job (DECISIONS 9.3): share of workers' months that counts.
      fireUseShare: 0.25,        // with Fire burning: cooking, heating, firing
      clayWorkShare: 0.1,        // with Pottery or Mud Brick working
      metalWorkShare: 0.05,      // with a metal discovery working
      sailingShare: 0.05,        // with a raft or boat
      fightingPerBattle: 1,      // each fighting adult in a battle: 1 month of fighting
    },
    needs: { warLossFull: 0.1 }, // losing 10% of the group in battles in a year is the full war need
    lessons: { mult: 3, years: 30 }, // after a hazard, its prevention discoveries ×3 for 30 years (§4.5)
    diffusion: {
      contactLearnChance: 0.02,  // neighbours in contact learn each other's discoveries: 2% × int/100 a year
      unusedForgetYears: 50,     // a discovery whose activity nobody practised for 50 years…
      unusedForgetChance: 0.05,  // …is forgotten with 5% a year
    },
    eraShareNeeded: 0.6,         // an era needs at least 60% of its discoveries (was "all but one")
    tools: { diggingStickGather: 1.1, bowHunt: 1.3, sickleFarm: 1.1, sailsExplore: 1.5 },
    salting: { spoilageMult: 0.8 }, // Salt + Salting: food keeps longer
    animals: { dogsHunt: 1.2 },  // Dogs: hunt success ×1.2 (their herd guarding comes in F6)

    // F3 — food and environment (§9).
    // Fish: density 0–1 on Water ground and River/Sea walls. Real basis: river and coastal foragers
    // were often dense and settled (salmon rivers, shell middens).
    fish: {
      growth: 0.04,              // logistic growth a month
      kRiver: 0.8, kLake: 0.6, kSea: 0.5, // capacity by water: River wall, Water ground, Sea wall
      // FU per catch at density 1 (× yield multiplier). Tuned in F3 (TUNING.md pass 4): 2.0 → 5.0, like
      // huntYield (pass 3); at 2.0 a shore band living off fish starved even next to a full sea.
      yield: 5.0,
      netsMult: 1.5,             // Fishing Nets
      depletion: 0.01,           // density taken by one fisher-month
      diffusion: 0.03,           // like land animals: 3% a month to water neighbours
      fishBase: 5,               // Fish job score base (like hunting)
    },
    extinctBelow: 0.01,          // a tile's deer, goats or horses below 1% …
    extinctYears: 5,             // … for 5 years in a row die out there; only neighbours bring them back
    migrationBias: 0.5,          // spring: diffusion ×1.5 toward greener tiles, ×0.5 away (autumn: back)
    soil: {
      cropDrain: 0.04,           // fertility lost by a farmed field a year
      fallowGain: 0.10,          // fertility regained by unfarmed land a year
      manureGain: 0.02,          // fields of a group with a herd
      siltGain: 0.15,            // flood silt (F5)
      yieldBase: 0.4,            // farm yield × (0.4 + 0.6 × fertility)
      rotationMult: 0.4,         // Crop Rotation: cropDrain × 0.4
    },
    salt: { rate: 0.01, drainage: 0.02, barrenAbove: 0.8 }, // irrigation without drainage salts the soil (Mesopotamia)
    store: { granaryMonths: 12, granarySpoilMult: 0.5, pestLoss: 0.05, pestAboveMonths: 6 },

    // F4 — people change the landscape (§10).
    drying: { forestShare: 0.2, mult: 0.9 }, // a climate cell that had ≥20% forest and drops below it: rain × 0.9
    grazing: {
      overgrazeLoss: 20,         // grass density lost a year where herds eat more than the land grows
      overgrazeYears: 10,        // bare, grazed-out dry land for 10 years…
      dryBelowRain: 30,          // … with rain below 30 …
      desertifyMult: 3,          // … counts 3 years toward desert each year (the Sahel)
    },
    erosion: { rate: 0.03, mountainSlope: 2 }, // fertility lost a year × slope on farmed or bare slopes; Terraces stop it
    wear: {
      perWorkerMonth: 1,         // each worker wears the straight line from home to work
      fadePerYear: 0.8,          // unused paths fade: wear × 0.8 a year
      path: 60, road: 160,       // wear for a path; a road also needs a group with the Wheel walking it
      roadTradeMult: 1.5,        // groups joined by a road meet (and trade) from 1.5× as far
      tradePerYear: 40,          // trade partners wear the line between their homes
    },
    ruinYears: 300,              // abandoned settlements fade back into the land
    burn: {
      base: 10, preyWeight: 30,  // Burn score = (10 + 30 × (1 − prey availability)), spring only, with Fire Safety
      maxPerMonth: 1,            // one burner a month per group: a few patches a year
      grassDensity: 128,         // a burned forest edge becomes grass of this density
      ashYears: 2,               // ash: grass regrows at double speed, grazers find fresh growth
      ashPreyBonus: 0.2,         // animal capacity +20% on ash
    },

    // F5 — elements and hazards (§11). Every hazard: base × natural driver × human driver × (1 − prevention).
    weather: { sigma: 0.2, min: -0.8, max: 1.5 }, // each climate cell's yearly rain anomaly (wet and dry years)
    fire: {
      dryRainFull: 60,           // dryness = clamp(1 − rain / 60) × season
      seasonDry: [0.3, 1.0, 0.8, 0.1], // spring, summer, autumn, winter
      igniteBase: 0.003,         // a group's campfire, per month × dryness × forest near home × (1 − fire safety)
      burnEscape: 0.05,          // a spring burn that escapes × dryness × (1 − fire safety)
      lightning: 0.00002,        // per forest tile per summer month × dryness
      townBase: 0.002,           // a settlement's own fire per month × dryness × crowding × thatch × (1 − firebreaks) × (1 − stone)
      spreadBase: 0.35,          // each burning tile lights each 8-neighbour with 0.35 × fuel × dryness
      maxSpreadSteps: 6,         // spread rounds within the month
      safetyCut: 0.8,            // Fire Safety removes 80% of the risk from people's own fires
      firebreakCut: 0.5,         // Firebreaks halve town fires
      stoneCut: 0.5,             // Stone Building halves town fires
      buildingFuel: 0.8,         // fuel of a tile with huts or houses
      buildingLoss: 0.5, storeLoss: 0.3, deathChance: 0.02, // a settlement on fire: half its buildings, 30% of food, 2% of people
      ashYears: 2,               // burned land: ash for 2 years (grass regrows fast)
      logMinTiles: 5,            // wildfires smaller than this go unlogged unless they hit a settlement
    },
    flood: {
      floodplainTiles: 2,        // land within 2 tiles of a river or lake, no more than 1 higher than the water
      base: 0.04,                // a river stretch floods in a wet year: 0.04 × rain anomaly × (1 − levees × upkeep)
      minMonths: 1, maxMonths: 3, // spring months of standing water
      deathChance: 0.005,        // per person living on the flooded plain
      hutLoss: 0.5,              // share of buildings on the plain damaged
      flashMinPop: 300, flashRain: 80, flashBase: 0.05, flashDeaths: 0.01, // big villages without drains in heavy rain
    },
    disease: {
      endemicWeight: 0.2,        // village deaths × (1 + 0.2 × crowding × herds near × (1 − wells) × (1 − sewers))
      cleanWaterCut: 0.5,        // Wells, and Sewers, each halve it
      herdFull: 50,              // herd size that counts as "herds near home" in full
      outbreakBase: 0.01,        // per village a year × crowding × (herds ? 1.5 : 1) × (1 + trade links)
      herdOutbreakMult: 1.5,
      outbreakMult: 3,           // deaths × 3 while it lasts
      minYears: 1, maxYears: 3,
      spreadChance: 0.3,         // each trade partner catches it with 30% a year
    },
    blight: { base: 0.02, wetWeight: 5, minFields: 3, harvestMult: 0.3 }, // wet years, no Crop Rotation: harvest × 0.3 for a year
    landslide: { base: 0.01, deathChance: 0.05 }, // cleared slopes in wet years × anomaly × slope / 9
    dust: { base: 0.02, dryBelow: -0.1, bareFull: 0.2, fertilityLoss: 0.1 }, // dry years over bare dry land
    mine: { base: 0.01, deathShare: 0.01 }, // deep mines with little metal-work practice
    herdPredation: 0.03,         // herd loss a month × predator density in range (× 0.3 with Dogs)
    dogsHerdLoss: 0.3,
    maintenance: {
      decayPerYear: 0.05,        // canals, levees and drains fall into disrepair
      perWorkerMonth: 0.002,     // a month of upkeep work
      base: 10, weight: 40,      // Maintain score = (10 + 40 × (1 − upkeep)), only with works to keep
    },

    // F6 — society, conflict and animals (§12).
    society: {
      // Specialists (§12.1): with more than 6 months of food stored (year average) and 150+ people,
      // min(0.15, 0.02 × months stored) of the workers craft instead of working the land.
      surplusMonths: 6, specialistMinPop: 150, specialistMax: 0.15, specialistPerSurplus: 0.02,
      specialistDiscovery: 2,    // each 1% of specialists: discovery chance +2% …
      specialistTools: 2,        // … and tool and weapon quality +2% (food yield, war power)
      // Chiefs and inequality (§12.2). Real basis: chiefdoms rose in big villages with surplus.
      chiefMinPop: 300,          // a chief appears at 300+ people with a surplus …
      chiefLostBelowPop: 150,    // … and goes when the group falls below 150
      inequalitySurplusGain: 0.02, // a year with a chief and a surplus
      inequalityWarWinGain: 0.05,  // each battle or raid won
      // Tuned in F6 (TUNING.md pass 6): fall 0.05 → 0.1 and weights 20 → 5; at 20 nearly every chiefdom
      // was at war every year and Scenario D lost two thirds of its people by year 600.
      inequalityCoopFall: 0.1,     // then × (1 − 0.1 × cooperation/100) a year: cooperative groups level out
      inequalityWarWeight: 5, inequalityTradeWeight: 5, inequalityAbsorbWeight: 5, // contact scores ± weight × inequality
      // Marriage between groups and inbreeding (§12.3). Real basis: exogamy linked foraging bands.
      marriageShare: 0.02,       // share of unpaired young adults exchanged a year between groups at peace
      marriageMinAge: 16, marriageMaxAge: 30,
      villageUnpairedShare: 0.15, // villages don't track couples: this share of their 15–49s count as unpaired
      inbreedPenalty: 0.3, inbreedYears: 200, inbreedBelowPop: 50, // births × (1 − 0.3 × min(1, isolated years / 200)) under 50 people
      // Culture (§12.4): sharing, warlike, openness 0–100, copied on splits with drift.
      cultureStart: 50,          // founders' culture (DECISIONS 13.4)
      cultureDrift: 3,           // gaussian × 3 on each split
      cultureBlend: 0.02,        // neighbours at peace move 2% of the gap toward each other a year
      sharingSelfish: 50,        // distribution selfishness × (2 − sharing / 50): ×1 at 50, ×0 at 100
      warlikeWeight: 0.4,        // war score + 0.4 × (pair's warlike − 50)
      opennessWeight: 0.4,       // trade score + 0.4 × (pair's openness − 50)
      // learning (trade, diffusion) × (0.5 + openness / 100)
      // Language drift (§12.5).
      languageYears: 500,        // 500 years without meeting a group of its own language → a new language
      languageMult: 0.5,         // trade and learning between different languages × 0.5
      languageCoexist: -10,      // coexist score between different languages
      // Founder lineages each speak their own language, but by default the penalties above apply only
      // between groups of one lineage that grew apart (§12.5 as written). true = between lineages too:
      // that tips peaceful neighbours of different lineages into war and changes v1 contact (DECISIONS 13.7).
      languageBetweenLineages: false,
      // Raids (§12.7). Real basis: raiding was the most common early conflict.
      raidHunger: 70,            // groups whose worst month this year had H > 70 may raid (neighbours they don't trade with,
                                 // or, attacking in a war, instead of that year's battle)
      raidChance: 0.3,           // a year, × warlike / 50
      raidShare: 0.2,            // a successful raid takes 20% of the store (and of the herd, with Taming)
      raidLossWin: 0.01, raidLossLose: 0.03, // fighting adults lost by the winning and losing side
      // Alliances (§12.7).
      allianceRatio: 2,          // two groups at peace both facing a third 2× stronger than each ally
      threatNeed: 0.1,           // war need above this (losses to battles or raids) also counts as a threat (walls)
    },
    weapons: {
      // War power × the best weapon the group can equip (§12.6). The metal tiers keep v1's numbers:
      // copper 1.2, copper + iron 1.2 × 1.4 = 1.68; bronze 1.2 × 1.25 (F1) = 1.5.
      spear: 1.1, bow: 1.2, copper: 1.2, bronze: 1.5, iron: 1.68,
      metalPerFighter: 0.1,      // metal units per fighting adult; the rest fight with wood weapons
    },
    fortify: {
      palisade: 1.3, stoneWall: 1.8, // defence × (the defender is the side under less pressure, DECISIONS 13.9)
      palisadeWood: 200, stoneWallStone: 500,
    },
    workAnimals: {
      domesticationPerYear: 0.01, domesticationMax: 1, // a herded herd's yield × (1 + domestication)
      ploughMult: 1.5,           // Plough + oxen: farm yield × 1.5 …
      oxenPerField: 2,           // … in full with 2 herd animals per field
      tradeMult: 1.5,            // Riding (horses): contact (and trade) range × 1.5
    },
    stoneHouse: { wood: 2, stone: 30 }, // Stone Building: houses of stone (F1 table §7.2)

    // F7 — intervention mode (D5).
    interventions: {
      floodRadius: 3,            // a flood dropped off any floodplain covers low land within 3 tiles
      floodMonths: 2,            // months it stands
    },
  },

  walls: {
    health: { river: 100, mountain: 200, sea: 300 },
    minPressure: 0.4,
    wearPerWorkerMonth: 0.05,
    ridingWearMult: 1.2,
    breachRadius: 1,
    inactivePressure: 0.5,
    crowdingPressureStart: 0.9,
    crowdingPressureScale: 5,
  },

  contact: {
    reviewYears: 10, pressureChangeReview: 0.3,
    sameLineageCoopBonus: 30,
    powerStrBase: 0.5,
    warPressureWeight: 60, warCoopWeight: 0.4, warRatioBonusAt: 1.5, warRatioBonus: 10,
    tradeCoopWeight: 0.6, tradeFedBonus: 20, tradeFedBelowH: 30, tradeDiffBonus: 10,
    absorbRatio: 3, absorbBase: 30, absorbRatioWeight: 5, absorbRatioCap: 10, absorbHungerWeight: 0.3,
    coexistScore: 35, nudge: 10,
    battleBase: 0.8, battleRandom: 0.4,          // eff = power × (0.8 + 0.4 × U)
    loserLossBase: 0.10, loserLossScale: 0.20, winnerLossBase: 0.05, winnerLossScale: 0.10,
    deathWeightStrength: 150,
    conquerMinPop: 20, conquerPowerShare: 0.5,
    captureShare: 0.5, refugeeMinPeople: 4, refugeeMinDistance: 12,
    gainDiscoveryChance: 0.5,
    tradeLearnChance: 0.10, tradeTileShare: 0.2,
    warAdversityMonths: 3,
    warMult: { riding: 1.3 },    // metal weapons moved to future.weapons (F6: they must be equipped)
    gridCell: 16,
    // Added in step 5:
    fightingAgeMax: 59,          // "adults" in war power and battle deaths are 15–59 (DECISIONS 5.9)
  },

  events: {
    rampYears: 1,
    plagueMinYears: 2, plagueExtraYears: 3,      // years = 2 + round(3 × s / 100)
    plagueDensityPop: 150, plagueDensityMin: 0.2, plagueDensityMax: 2, plagueTamingMult: 1.5,
    harshWinterRegenMult: 0.5, harshWinterFoodMult: 0.5, harshWinterNoFireMult: 1.5, harshWinterNoClothingMult: 1.2,
    dieOffMult: 0.2,
    maxYear: 10000,
  },

  timeline: { keyframeEveryYears: 200, memoryCapMB: 150, progressEveryYears: 50 },

  perf: { maxIndividuals: 30000 },

  log: { maxEntries: 50000 },

  render: {
    grain: 0.10,
    maxPeopleSprites: 6000,
    maxAnimalSprites: 400, animalBlock: 4, animalsPerBlockMax: 2,
    villageWalkersPer: 10, villageWalkersMax: 40, villageWalkRadius: 3,
    walkSpeedPx: 24, fastWalkMult: 4, walkFrameMs: 250, idleStepMs: 2000, personOffsetPx: 3,
    maxHutsDrawnBand: 12, maxBuildingsDrawn: 30, cityShare: 0.3, maxCityDrawn: 12,
    herdPerSprite: 10, maxHerdDrawn: 12,
    herdRadiusTiles: 2,          // added in step 5: herd goats wander within 2 tiles of home ("near home", §18.5)
    waterShimmerMs: 500, riverFlowMs: 300,
    fogAlpha: 0.6, rainOverlayAlpha: 0.6, areaHoverAlpha: 0.2,
    elevationOverlayAlpha: 0.75, // F4: the height view while the Elevation brush is selected
    riskOverlayAlpha: 0.8,       // F5: fire / flood risk views (alpha = risk × 0.8); F7 heatmaps too
    // F7 heatmaps (§13): the value that shows at full strength.
    heat: { populationFull: 10, foodFull: 6, conflictYears: 50, conflictFull: 5 },
    territoryAlpha: 0.3,         // F7 territory fills
    relationLineAlpha: 0.8,      // F7 trade / war / alliance lines between homes
    trailYears: 150,             // F7 migration trails fade over this many years
    trailAlpha: 0.7,
    idleStepPx: 2,               // §18.6: idle people make a tiny random step of at most this many px
    childOffsetPx: [-3, 1],      // §18.6: children walk at mother's position + this offset
    pickRadiusPx: 3,             // §21.1: clicking within 3 px of a person selects them
    zoom: 2,                     // §18.8: Z toggles 2× zoom
    terrainBudgetMs: 6,          // max terrain redraw work per frame; the rest waits for the next frame
    panStepPx: 24,               // arrow keys / WASD pan this many map pixels per press
    // Added in step 1 (numbers from §18.3 / §18.7 that were inside formulas):
    darkColorMult: 0.7,          // lineage dark variant D = RGB × 0.7 (§18.1)
    mountainLightSpeck: 0.10, mountainDarkSpeck: 0.10,
    desertGrassMaxBlend: 0.4,    // grass on desert blends only up to 40%
    fruitSpeck: 0.08,
    resourceSpeckBase: 0.05, resourceSpeckScale: 0.25,
    mountainWallInkSpeck: 0.15, mountainWallLightSpeck: 0.05,
    mountainPassSpeck: 0.10,
    // Extra terrain detail (owner request, 14 Oct 2026). All sizes in screen pixels.
    detail: {
      // Water depth: tiles from the nearest land; 0 = shore. Colour goes shallow → water → deep.
      waterDeepAtTiles: 4,       // depth at which water is fully deep
      waterShallowBlend: 0.45,   // shallow colour = water blended this far toward waterLight
      waterShallowShare: 0.35,   // first 35% of the depth range goes shallow → water
      seaMinDepth: 0.5,          // sea walls never look shallower than this, so they read as walls
      seaDarken: 0.9,
      // Waves: one small ⌒ mark per cell, drifting 1 px per water step (row speeds alternate 1× / 0.5×).
      waveCellW: 14, waveCellH: 7, waveChance: 0.55, waveBlend: 0.6,
      foamLapChance: 0.5,        // second foam row flickers on with this share, like lapping water
      wetEdgeMult: [0.75, 0.88], // land pixels 0 and 1 px from water get darker (wet sand/soil)
      // Grass blades: at most one per cell; flowers rarer.
      tuftCell: 4, tuftBase: 0.3, tuftGrassBonus: 0.35, tuftLight: 1.18, tuftTip: 1.3, tuftShadow: 0.82,
      flowerCell: 6, flowerChance: 0.03,
      // Forest: one possible round crown per cell; existence chance grows with density.
      treeCell: 4, treeBase: 0.3, treeRadiusMin: 1.6, treeRadiusMax: 2.6,
      treeLightBlend: 0.4, treeShadowMult: 0.68, treeToneVar: 0.2, forestFloorMult: 0.55,
      treeLightBelow: -0.6, treeShadowAbove: 0.5, // (dx + dy) / r thresholds: lit top-left, shadow bottom-right
      // Mountains: one possible peak per cell, slope 1 px per px, snow on tall peaks.
      // peakMaxH must stay ≤ tilePx: redraws only reach one tile around a change.
      peakCellW: 9, peakCellH: 7, peakChance: 0.7, peakMinH: 5, peakMaxH: 8, snowMinH: 7, snowRows: 2,
      peakLightBlend: 0.6, wallPeakDarkBlend: 0.6,
      // Desert dunes: broken wavy crest lines, a lit row above each dark crest.
      dunePeriod: 9, duneAmp: 2, duneWavelength: 22, duneSegment: 16, duneKeep: 0.7, duneDark: 0.87, duneLight: 1.07,
      pebbleChance: 0.01,
    },
    farmSoilRowEvery: 3,         // every 3rd pixel row of farmland is soil
    areaOutlineAlpha: 0.55,      // §18.7 "1 px light outline"
    hoverOutlineAlpha: 0.9,
    founderSpreadPx: 10,         // placed founders stand within ±10 px of their home tile
    animalDensityDivisor: 4,     // §18.5: animals per block = floor(density sum / 4 + random)
    animalWanderMs: 1500,       // decorative animals pick a new spot about this often
    animalSpeedPx: 6,            // decorative animal walking speed
    // Added in step 4 (§18.5, §19.5):
    campfireFrameMs: 250,        // campfire alternates frames this often
    vesselSearchTiles: 3,        // raft / boat is drawn on the water tile nearest home, within 3 tiles
    // F4 marks on the land (terrain.ts markPixel).
    marks: { terraceDark: 0.75, ashSpeck: 0.25, pathBlend: 0.6, roadBlend: 0.8, pitRadius2: 4.5, ruinGap: 0.3,
      flameShare: 0.35, burnDark: 0.45 }, // F5: flames and char on burning tiles (F8: flood water is the effects layer, f8.effects.floodAlpha)
    // F8 graphics and sound (future blueprint §14). Visual only: nothing here reaches the simulation,
    // except `look`, which the worker uses to pack the look byte it sends with each tile.
    f8: {
      // The look byte (worker side): soil worn by farming, salt, ash stage. Levels 1–3 start below/above these.
      look: { wornBelow: [0.75, 0.5, 0.25], saltAbove: [0.15, 0.4, 0.8] },
      // Seasons (§14.1): a tint per tile class and season, eased in real time so 8× (8 years a
      // second) blurs toward the yearly average instead of flashing. Colours are palette keys.
      season: {
        easeMs: 150,             // time constant of the tint easing (1×: a year lasts 1,000 ms, ~70% of the swing shows; 8×: ~13%)
        snowElevation: 6,        // winter snow lies on Mountain ground and on land at least this high
        // [colour, alpha] per class: grass, forest, fruit, farmland, desert, cold (snow line)
        spring: { grass: ['grassLight', 0.14], forest: ['grassLight', 0.10], fruit: ['flowerWhite', 0.10], farm: ['grassLight', 0.55], desert: ['grassLight', 0.06], cold: ['snow', 0.25] },
        summer: { grass: ['sand', 0.20], forest: ['forest', 0.10], fruit: ['fruit', 0.18], farm: ['fireYellow', 0.55], desert: ['fireYellow', 0.08], cold: ['stoneLight', 0.0] },
        autumn: { grass: ['wood', 0.18], forest: ['copper', 0.40], fruit: ['fruit', 0.25], farm: ['wood', 0.55], desert: ['clay', 0.08], cold: ['snow', 0.20] },
        winter: { grass: ['frost', 0.28], forest: ['frost', 0.22], fruit: ['frost', 0.28], farm: ['frost', 0.45], desert: ['sand', 0.0], cold: ['snow', 0.82] },
      },
      // Height shading (§14.1, D7): light from the top-left; brightness changes this much per height step.
      shade: { perStep: 0.05, max: 0.3 },
      beachPx: 2,                // land pixels this close to a lake or the sea are beach (Grassland/Desert)
      river: { cornerRadius: 5, dashLen: 3, dashEvery: 6, shimmer: 0.04 }, // curved banks, flowing dashes, glints
      stumps: { cell: 4, belowPainted: 0.2, share: 0.6 }, // stumps where forest is this much below its painted density
      soil: { wornPale: [0.12, 0.25, 0.4], saltWhite: [0.15, 0.35, 0.7], ashGreen: 0.35, siltBlend: 0.5, puddle: 0.04 },
      trample: { radiusPx: 9, villagePerSqrtPop: 1.2, maxRadiusPx: 22, alpha: 0.55, ragged: 0.35 },
      // Weather (§14.2): clouds drift over the map; it rains (or snows) under clouds where rain is high.
      weather: {
        cellTiles: 2,            // cloud field resolution
        scaleCells: 9,           // size of a cloud, in cells
        windPxPerS: 6,           // cloud drift (map px per second at any speed)
        cover: 0.55,             // share of the sky clouded where rain is 100
        shadowAlpha: 0.22, shadowOffsetPx: 10,
        updateMs: 120,
        rainAbove: 35,           // no rain particles under clouds where rain now is below this
        maxDrops: 900, dropsPerCellPerS: 1.2, dropFallPx: 18, dropMs: 420,
        snowMs: 2200, snowFallPx: 14,
        droughtBelow: 0.6, wetAbove: 1.4, // rain now ÷ painted rain: cracks below, puddles above
        crackShare: 0.12, puddleShare: 0.06,
      },
      // Day and night (§14.2): a real-time cycle that runs while the world plays.
      light: { dayMs: 48000, nightShare: 0.3, dusk: 0.12, maxDark: 0.5, glowRadiusPx: 7, fireGlowRadiusPx: 12 }, // glows: lit windows, fires
      // People and animals (§14.3).
      people: {
        poseFrameMs: 380,        // work poses (bending, hoeing, chopping) alternate this often
        nightGatherTiles: 6,     // only people working this close to home walk to the fire at night
        walkerCarryShare: 0.4,   // village walkers carrying a basket, pot or wood
        fireRingPx: [5, 11],     // at night people sit this far from their campfire
        nightGatherAbove: 0.55,  // night darkness above which bands gather at the fire
        herdFollowers: 2, herdFollowPx: 6,
        huntDeerPx: 9,           // the hunted deer stays about this far from the hunters
        battleMax: 14, battleSpreadPx: 10, battleFrameMs: 140,
      },
      animals: { herdSpreadPx: 7, gallopMult: 3.5, gallopFrameMs: 110, wolfStalkMult: 0.5, wolfDashMult: 4, wolfSeekPx: 28, fleePx: 12 },
      // Settlements (§14.4).
      // Bands below era 2 build lean-tos; a village without Mud Brick draws every 4 huts as one longhouse.
      buildings: { leanToBelowEra: 2, longhouseHuts: 4, wallPostStepPx: 3, wallMarginTiles: 1, wallMinTiles: 2, gateHalfAngle: 0.35 },
      traffic: { boatsPer: 40, maxBoats: 3, boatRangeTiles: 6, boatSpeedPx: 5, cartsPer: 60, maxCarts: 2, cartRangeTiles: 8, cartSpeedPx: 7 },
      smoke: { houseEveryMs: 1800, fireEveryMs: 500, puffMs: 2600, risePx: 14, driftPx: 6, hazeAlpha: 0.12, hazeRadiusTiles: 4 },
      // Effects (§14.5).
      effects: {
        maxParticles: 1500,
        flamesPerTile: 2, flameFrameMs: 120, fireSmokeEveryMs: 400,
        floodSpreadMsPerTile: 160, floodFadeMs: 600, floodAlpha: 0.65, rippleShare: 0.05,
        quakeRocks: 24, quakeDust: 16, quakeMs: 1800,
        sickAlpha: 0.22, sickPulseMs: 1600, sickRadiusTiles: 3,
        sparkleMs: 2200, sparkles: 10, iconRisePx: 12, eraGlowMs: 1800, eraGlowRadiusPx: 40,
        maxBursts: 40,           // discovery / era / quake effects running at once (8× logs many)
      },
      // Camera (§14.6).
      camera: { zooms: [1, 2, 4], easeMs: 180, followEaseMs: 400, labelScaleFromZoom: 2 }, // labels drawn 2× once zoomed this far
      story: { holdMs: 4500, zoom: 2, queueMax: 6, idleAfterInputMs: 6000 },
      timelapseTicksPerLoop: 600, // F8 time-lapse: replay up to this many months per worker loop (bounded by maxWorkMsPerLoop)
      capture: { gifFps: 10, gifSeconds: 4, gifScale: 0.5, gifColours: 255 },
      // Ambient sound (§14.7, D8: on by default, mute button). Gains 0–1, rates per second.
      sound: {
        master: 0.5, updateMs: 250, rampS: 0.6,
        wind: 0.06, windMountain: 0.10, rain: 0.18, water: 0.04,
        birdsPerS: 1.6, birdGain: 0.05, crackleGain: 0.07, cracklePerFire: 0.5, workPerS: 2.5, workGain: 0.05,
      },
    },
  },

  // Editor and setup UI (step 1). Not used by the simulation.
  editor: {
    brushSizes: [1, 3, 5, 9, 15],
    defaultBrushSize: 3,
    defaultStrength: 100,        // percent
    rainSoftEdgeBlend: 0.5,      // outer ring of the rain brush blends 50%
    undoStrokes: 50,
    areaDebounceMs: 200,
    areaLabelMinTiles: 30,       // only label areas at least this big, so tiny pockets don't clutter the map
    newMap: { ground: 0, rain: 50 },  // Ground.Grassland, rain 50
    maxElevation: 9,             // F4 (D7): the Elevation brush paints height 0–9
    defaultSeed: 1,
    maxSeed: 4294967295,         // seeds are uint32 (§7.2)
  },

  ui: {
    toolbarPx: 72,
    rightPanelPx: 320,
    bottomBarPx: 80,
    hoverInfoRefreshMs: 50,
    inspectRefreshMs: 250,       // §21.1: inspector refreshes about 4 times per second
    logRowPx: 20,                // event log: height of one row (the list is virtualised, §21.3)
    graphs: { width: 292, height: 112, maxPoints: 2000, redrawMs: 250 }, // §21.2: draw every n-th year past 2,000 points
    eventDialog: { year: 100, length: 20, strength: 50 }, // a new event's starting values
    toastMs: 2500,
    peopleDialog: {
      men: 2, women: 2, minCount: 0, maxCount: 20,
      ageMin: 18, ageMax: 30, ageLimitMin: 0, ageLimitMax: 60,
      intelligence: 100, cooperation: 50, strength: 50,
      maxPeople: 40, nameMaxLength: 20,
    },
    smallGroupWarnBelow: 10,
    storyMaxEvents: 200,         // F7: life-story lines kept for the followed person     // setup warning: smaller founder groups often die out by chance (F0)
  },
} as const;
