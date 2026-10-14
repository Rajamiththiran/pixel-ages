// Carrying out this month's actions (§11.6), in person id order, then predator attacks.

import { CONFIG } from '../../config';
import { Action, Species } from '../../shared/ids';
import { Discovery } from '../../shared/discoveries';
import { chance, int } from '../../shared/rng';
import type { Group, SimState } from '../state';
import type { BandContext } from './brain';
import { frontierInRange, hasActive, revealAround, revealRadius } from './explore';
import { gather, hunt } from './food';
import { strengthNow } from './inheritance';

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

  for (const slot of g.members) {
    const action = p.action[slot]!;
    let tile = home;
    switch (action) {
      case Action.Gather: tile = gather(s, g, slot, ctx.range); break;
      case Action.Hunt: tile = hunt(s, g, slot, ctx.range, ctx.avgCoop); break;
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
        g.buildProgress += 1;
        if (g.buildProgress >= P.build.hutMonths) {
          g.buildProgress -= P.build.hutMonths;
          g.huts += 1;
        }
        break;
      case Action.Teach: teachers++; break;
      default: break; // Rest, Child: stay home
    }
    p.workTile[slot] = tile;

    // Predators attack people working out in the land (§11.6).
    if (action === Action.Gather || action === Action.Hunt || action === Action.Herd || action === Action.Explore) {
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
  for (const slot of killed) p.alive[slot] = 0;
  return { carers, killed };
}
