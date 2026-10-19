# Pixel Ages

A browser god-sim experiment. Paint a world, place small groups of people, plan a few events, pick a seed and press Run. Then watch, hands-off, for up to 10,000 years. Groups explore, make discoveries, grow from bands into villages and cities, and meet each other to trade, fight or merge, or they collapse. Graphs, an event log and a timeline let you compare what happened and look at any past year.

The same setup with the same seed always replays the same history, so you can change one thing and run the experiment again.

The full design is in [pixel-ages-blueprint.md](pixel-ages-blueprint.md). Choices made where the blueprint was silent are in [DECISIONS.md](DECISIONS.md), and every tuning change is in [TUNING.md](TUNING.md).

## Run it

You need [Node.js](https://nodejs.org/) 20 or newer.

```bash
npm install
npm run dev
```

Open the address it prints (usually http://localhost:5173) in desktop Chrome, Edge or Firefox. The window should be at least 1680 × 820.

On first launch a short tutorial appears. **Load the example** sets up "Smart desert vs rich forest" (two groups, one river, seed 48213). Press **Run ▶**, then **8×**.

### Controls

| Key | Action |
|---|---|
| Space | Play / pause |
| 1 / 8 | 1 year per second / 8 years per second |
| . | Step one month (paused) |
| Z / mouse wheel | Zoom 1× / 2× / 4× on the cursor; pan with right-drag or arrows / WASD |
| C | Follow cam: keep the selected group in the middle |
| M | Story mode: the camera jumps to big moments as they happen |
| T | Time-lapse: replay the whole history fast from year 0 up to now |
| P | Photo mode: hide everything but the map (Esc leaves it too) |
| Ctrl+Z / Ctrl+Shift+Z | Undo / redo painting |
| [ / ] | Brush size |
| F | Fill bucket |
| I / G / L | Inspect / Graphs / Log tab |
| Esc | Cancel picking, deselect |

The strip at the right of the bottom bar holds the same camera tools plus **Shot** (save a PNG of the map), **GIF** (record 4 seconds as an animated GIF), and the look switches: **Day/night**, **Weather**, **Sound** (ambient sound, on by default) and **Colour-blind** (lineage colours that colour-blind eyes tell apart). The look switches are remembered in the browser. Seasons, day and night, weather and every effect are drawn only: they never change the simulation.

## Presets

The **Maps** tab lists built-in scenarios: load one and press **Run ▶**. **Four Realms** is the showcase: four peoples in three walled lands, with contact, trade, wars, breached walls and a drought. The test scenarios below are built in too, and `presets/` also holds them as run files (**Maps → Import run**).

| File | What it is |
|---|---|
| `four-realms.run.json` | The showcase world |
| `scenario-a-garden.run.json` | The baseline: one group in a rich garden world |
| `scenario-b-smart-desert-vs-rich-forest.run.json` | The owner's experiment: intelligence 70 in a rich forest vs intelligence 140 in a desert, across a river |
| `scenario-c-collapse.run.json` | The garden with a drought (year 500) and a plague (year 800) |
| `scenario-d-performance.run.json` | Three walled areas, six groups, strong climate drift |
| `scenario-e-fire-season.run.json` | Dry forest with a careful, an average and a careless group (v2) |
| `scenario-f-floodplain-city.run.json` | A river valley that floods in wet centuries, beside a dry upland (v2) |
| `scenario-g-overgrazed-steppe.run.json` | Dry grassland full of wild goats and horses, two herding groups (v2) |
| `scenario-h-island-isolation.run.json` | Six people on a small island, four groups on a mainland across the sea (v2) |

The A–D files are version 1 files from Pixel Ages 1.0; version 2 still loads and replays them exactly (a test checks this).

## Build

```bash
npm run build
```

This type-checks and writes a static site to `dist/`. Paths are relative, so `dist/` works from any folder.

## Test

```bash
npm test
```

The unit, determinism and short scenario tests run in about 2 minutes. The long runs (Scenarios A–D to their target years, up to 10,000) are opt-in and take 1–1.5 hours:

```bash
LONG=1 npm test            # bash
$env:LONG=1; npm test      # PowerShell
```

## Publish on itch.io

1. `npm run build`
2. Zip the **contents** of `dist/`, so that `index.html` is at the top of the zip. In PowerShell:
   `Compress-Archive -Path dist/* -DestinationPath pixel-ages-itch.zip -Force`
3. On itch.io create a project with **Kind of project: HTML** and upload the zip. Tick **This file will be played in the browser**.
4. Set the embed size to at least **1680 × 820** (or tick *Click to launch in fullscreen*) and save.

## Project layout

- `src/sim/`: the simulation. It runs in a Web Worker, is deterministic (seeded RNG, no `Math.random`, no clocks) and never touches the DOM.
- `src/render/`: Canvas 2D drawing. It reads frames and never changes the simulation (it imports only `shared/` and `config`; a test checks this).
- `src/audio/`: ambient sound, made in code with the Web Audio API.
- `src/editor/`, `src/ui/`: painting tools and panels.
- `src/config.ts`: every tunable number.
- `src/presets/scenarios.ts`: the §26 scenarios in code, shared by the game and the tests.
- `src/presets/builtins.ts`: the built-in scenarios of the Maps tab (the showcase Four Realms plus A–D).
- `tests/`: Vitest tests.

Only Vite, TypeScript and Vitest are used; there are no other dependencies.
