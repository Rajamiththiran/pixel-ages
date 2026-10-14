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
