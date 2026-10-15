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
    forest: { dieBelowRain: 25, fullAtRain: 50, spreadMinRain: 55, spreadChance: 0.02, groundMult: [1, 0, 0, 0.5] },
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
      huntMaxSuccess: 0.95, huntYield: 3.0, huntDepletion: 0.01,
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
      gatherBase: 15,
      huntBase: 15, huntNoToolsMult: 0.5, huntSpearMult: 1.3,
      farmBase: 25, farmHungerWeight: 0.8, farmSeasonBonus: 20,
      herdBase: 20, herdHungerWeight: 0.5,
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
    migrate: { hungerAbove: 60, months: 3, plantAvailBelow: 0.4, farmerHungerAbove: 80, farmerMonths: 12, logMinDistance: 10, distancePenalty: 0.5, sampleStep: 2 },
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
    // Age window for pairing (DECISIONS 3.2): the man may be up to 20 years older or 5 years
    // younger. Without it, older widows pair for life with young men and young women find nobody.
    pairMaxOlderMan: 20,
    pairMaxOlderWoman: 5,
  },

  discoveries: {
    baseChanceByEra: [0.02, 0.015, 0.01, 0.007, 0.005, 0.003],
    forgetLimitByEra: [5, 10, 20, 40, 80, 150],
    forgetYears: 10,
    writingChanceMult: 1.3,
    resourceUsePer: 50,
    cityMinPop: 500,
    // Added in step 4 (numbers inside the §12.3 formula):
    spareFoodFrom: 0.5,          // spareFood = clamp((fed12 − 0.5) × 2, 0, 1)
    spareFoodScale: 2,
    popSqrtDivisor: 5,           // × sqrt(population) / 5
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
    warMult: { riding: 1.3, copperWorking: 1.2, ironWorking: 1.4 },
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
    riverStreakEvery: 5,         // (px + py + t) % 5 === 0 → waterLight
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
    defaultSeed: 1,
    maxSeed: 4294967295,         // seeds are uint32 (§7.2)
  },

  ui: {
    toolbarPx: 72,
    rightPanelPx: 320,
    bottomBarPx: 80,
    hoverInfoRefreshMs: 50,
    inspectRefreshMs: 250,       // §21.1: inspector refreshes about 4 times per second
    logRowsShown: 500,           // basic log tab: newest rows rendered (virtualised list in step 6)
    toastMs: 2500,
    peopleDialog: {
      men: 2, women: 2, minCount: 0, maxCount: 20,
      ageMin: 18, ageMax: 30, ageLimitMin: 0, ageLimitMax: 60,
      intelligence: 100, cooperation: 50, strength: 50,
      maxPeople: 40, nameMaxLength: 20,
    },
  },
} as const;
