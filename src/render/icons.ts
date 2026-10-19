// Pixel icons (F8 §14.7) for discoveries, eras, events, hazards and log lines. Each icon is a
// 7×7 grid in spriteData (icon_*); this file only says which icon stands for what.

import { Discovery, DISCOVERIES } from '../shared/discoveries';
import type { LogEntry, PlannedEvent } from '../shared/types';
import { getSprite } from './sprites';

export type IconName =
  | 'fire' | 'tool' | 'weapon' | 'boat' | 'cloth' | 'animal' | 'wheat' | 'pot' | 'house' | 'wheel' | 'metal'
  | 'scroll' | 'drop' | 'fish' | 'wave' | 'rock' | 'dust' | 'skull' | 'bug' | 'leaf' | 'sun' | 'cloud' | 'snow'
  | 'hand' | 'berry' | 'trade' | 'shield' | 'arrow' | 'eye' | 'star' | 'people';

const D = Discovery;
/** One icon per discovery, by family (fire, tools, weapons, boats, farming, building, metal…). */
const DISCOVERY_ICON: Record<number, IconName> = {
  [D.fire]: 'fire', [D.fireSafety]: 'fire', [D.firebreaks]: 'fire',
  [D.stoneTools]: 'tool', [D.diggingStick]: 'tool', [D.sickle]: 'tool', [D.plough]: 'tool',
  [D.spear]: 'weapon', [D.bow]: 'weapon',
  [D.raft]: 'boat', [D.boat]: 'boat', [D.sails]: 'boat',
  [D.clothing]: 'cloth',
  [D.taming]: 'animal', [D.dogs]: 'animal', [D.riding]: 'animal',
  [D.farming]: 'wheat', [D.cropRotation]: 'wheat', [D.terraces]: 'wheat',
  [D.pottery]: 'pot', [D.granary]: 'pot', [D.salting]: 'pot',
  [D.mudBrick]: 'house', [D.stoneBuilding]: 'house', [D.city]: 'house', [D.palisade]: 'shield',
  [D.wheel]: 'wheel', [D.cart]: 'wheel',
  [D.copperWorking]: 'metal', [D.bronzeWorking]: 'metal', [D.ironWorking]: 'metal', [D.mining]: 'metal',
  [D.writing]: 'scroll',
  [D.irrigation]: 'drop', [D.wells]: 'drop', [D.drainage]: 'drop', [D.levees]: 'drop', [D.sewers]: 'drop',
  [D.fishing]: 'fish', [D.fishingNets]: 'fish',
};

export const discoveryIcon = (id: number): IconName => DISCOVERY_ICON[id] ?? 'star';

/** One icon per era (0 Early people … 6 Iron & Writing). */
export const ERA_ICONS: readonly IconName[] = ['hand', 'berry', 'weapon', 'wheat', 'house', 'metal', 'scroll'];

export const EVENT_ICONS: Record<PlannedEvent['kind'], IconName> = {
  drought: 'sun', wetPeriod: 'cloud', plague: 'skull', harshWinters: 'snow', animalDieOff: 'skull', earthquake: 'rock',
};

/** Hazard icons by the words in a hazard log line. */
const HAZARD_WORDS: ReadonlyArray<readonly [RegExp, IconName]> = [
  [/fire|burn/i, 'fire'], [/flood/i, 'wave'], [/landslide|slide|collapse/i, 'rock'], [/dust/i, 'dust'],
  [/outbreak|sick|disease|plague/i, 'skull'], [/pest|rat/i, 'bug'], [/blight/i, 'leaf'], [/wolves|predator/i, 'animal'],
];

/** The discovery named in a log line ("… discovered Copper Working …"), longest name first. */
const BY_NAME = [...DISCOVERIES].sort((a, b) => b.name.length - a.name.length);
export function discoveryInText(text: string): number | null {
  for (const d of BY_NAME) if (text.includes(d.name)) return d.id;
  return null;
}

/** The icon of a log line. */
export function logIcon(e: LogEntry): IconName {
  switch (e.type) {
    case 'discovery': case 'lostDiscovery': {
      const d = discoveryInText(e.text);
      return d === null ? 'star' : discoveryIcon(d);
    }
    case 'eraUp': case 'eraDown': {
      const m = /era (\d)/.exec(e.text);
      return ERA_ICONS[m ? Number(m[1]) : 0] ?? 'star';
    }
    case 'ranOut': return 'metal';
    case 'split': case 'migrate': return 'arrow';
    case 'becameVillage': return 'house';
    case 'becameBand': return 'hand';
    case 'firstContact': return 'eye';
    case 'tradeStart': return 'trade';
    case 'war': case 'conquered': case 'raid': return 'weapon';
    case 'absorbed': return 'people';
    case 'alliance': return 'shield';
    case 'society': return 'people';
    case 'breach': return 'rock';
    case 'event': {
      for (const [kind, icon] of Object.entries(EVENT_ICONS)) {
        const word = kind === 'wetPeriod' ? /wet/i : kind === 'harshWinters' ? /winter/i : kind === 'animalDieOff' ? /die/i : new RegExp(kind, 'i');
        if (word.test(e.text)) return icon;
      }
      return 'star';
    }
    case 'intervention': return 'star';
    case 'animalsGone': return 'animal';
    case 'hazard': {
      for (const [re, icon] of HAZARD_WORDS) if (re.test(e.text)) return icon;
      return 'skull';
    }
    case 'groupExtinct': case 'lineageExtinct': case 'cannotReproduce': return 'skull';
    case 'perf': return 'star';
  }
}

export const iconSprite = (name: IconName): HTMLCanvasElement => getSprite(`icon_${name}`);

/** A data URL of the icon at `scale`, for <img> in the DOM (cached). */
const urls = new Map<string, string>();
export function iconUrl(name: IconName, scale = 2): string {
  const key = `${name}|${scale}`;
  let u = urls.get(key);
  if (u) return u;
  const src = iconSprite(name);
  const c = document.createElement('canvas');
  c.width = src.width * scale;
  c.height = src.height * scale;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(src, 0, 0, c.width, c.height);
  u = c.toDataURL();
  urls.set(key, u);
  return u;
}
