// Carrying out this month's actions (§11.6), in person id order, then predator attacks.

import { CONFIG } from '../../config';
import { Action, Species } from '../../shared/ids';
import { Discovery } from '../../shared/discoveries';
import { chance, int } from '../../shared/rng';
import type { Group, SimState } from '../state';
import type { BandContext } from './brain';
import { frontierInRange, hasActive, revealAround, revealRadius } from './explore';
import { fishWork, gather, hunt, yieldMult } from './food';
import { ensureFarmTiles, farmWork, growHerd, herdWork, type HerdMonth } from './farming';
import { strengthNow } from './inheritance';
import { wearWall } from '../society/walls';
import { cutWood, payBuilding } from './wood';

const P = CONFIG.people;

export interface ActionResult {
  carers: Set<number>;           // slots caring this month
  killed: number[];              // slots killed by predators
}

export function doActions(s: SimState, g: Group, ctx: BandContext): ActionResult {
  const p = s.persons;
  const home = g.homeY * s.width + g.homeX;
  const carers = new Set<number>();
  const killed: number[] = [];
  let teachers = 0;
  let farmers = 0;
  let herders = 0;
  const herdMonth: HerdMonth = { capacity: ctx.herdCapacity, tended: 0 };
  // Clear any new fields this month's farmers need before anyone works them.
  if (ctx.chosen[Action.Farm]! > 0) ensureFarmTiles(s, g, ctx.chosen[Action.Farm]!, ctx.farmCandidates);
  const mudBrick = hasActive(g, Discovery.mudBrick);

  for (const slot of g.members) {
    const action = p.action[slot]!;
    let tile = home;
    switch (action) {
      case Action.Gather: tile = gather(s, g, slot, ctx.range); break;
      case Action.Hunt: tile = hunt(s, g, slot, ctx.range, ctx.avgCoop); break;
      case Action.Farm: {
        const field = farmWork(s, g, slot, farmers++);
        if (field >= 0) tile = field;
        break;
      }
      case Action.Herd: tile = herdWork(s, g, yieldMult(s, g, slot), ctx.range, herdMonth); herders++; break;
      case Action.Explore: {
        const options = ctx.frontierInRange;
        if (options.length > 0) {
          tile = options[int(s.rng, options.length)]!;
          revealAround(s, g, tile % s.width, Math.floor(tile / s.width), revealRadius(p.actInt[slot]!));
          // Later explorers this month see the frontier as it is now.
          ctx.frontierInRange = frontierInRange(s, g);
        }
        break;
      }
      case Action.Care: carers.add(slot); break;
      case Action.Build:
      {
        // A hut takes 2 worker-months; with Mud Brick a house (3 families) takes 6. Each needs its
        // wood (and a house its clay) when it is finished; until then the work waits (F1).
        const months = mudBrick ? P.build.houseMonths : P.build.hutMonths;
        g.buildProgress += 1;
        if (g.buildProgress >= months && payBuilding(s, g, mudBrick)) {
          g.buildProgress -= months;
          if (mudBrick) g.houses += 1; else g.huts += 1;
        } else g.buildProgress = Math.min(g.buildProgress, months);
        break;
      }
      case Action.Teach: teachers++; break;
      case Action.Fish: tile = fishWork(s, g, yieldMult(s, g, slot), ctx.waters); break;
      case Action.CutWood: {
        const cut = cutWood(s, g, ctx.range);
        if (cut >= 0) tile = cut;
        break;
      }
      case Action.Wall:
        if (g.wallTarget) {
          wearWall(s, g, strengthNow(p, slot), 1);
          tile = g.wallTarget.tile;
        }
        break;
      default: break; // Rest, Child: stay home
    }
    p.workTile[slot] = tile;

    // Predators attack people working out in the land (§11.6).
    if (action === Action.Gather || action === Action.Hunt || action === Action.Herd || action === Action.Explore
      || action === Action.CutWood) {
      const pred = s.animal[Species.Predator][tile]!;
      if (pred > 0) {
        const Pr = P.predators;
        const risk = Pr.attackBase * pred
          * (hasActive(g, Discovery.spear) ? Pr.spearMult : 1)
          * (action === Action.Hunt ? Pr.hunterExposure : 1)
          * (1 - strengthNow(p, slot) / Pr.strDivisor)
          * (1 - ctx.avgCoop / Pr.coopDivisor);
        if (chance(s.rng, risk)) {
          if (chance(s.rng, Pr.deathShare)) killed.push(slot);
          else {
            p.health[slot] = Math.max(0, p.health[slot]! - P.health.injuryLoss);
            p.injured[slot] = 1;
          }
        }
      }
    }
  }
  g.carers = carers.size;
  g.teacherMonths += teachers;
  g.herders = herders;
  if (hasActive(g, Discovery.taming)) growHerd(g, ctx.herdCapacity);
  for (const slot of killed) p.alive[slot] = 0;
  return { carers, killed };
}
