import { UNITS } from '../config';
import { UnitManager } from '../units/unitManager';

export interface UpgradeContext {
  units: UnitManager;
  /** Toggles availability of the heat-vision overlay (render layer reads this). */
  unlockHeatVision(): void;
}

export interface UpgradeDef {
  id: string;
  name: string;
  desc: string;
  baseCost: number;
  /** Cost multiplier per level purchased. */
  costMult: number;
  maxLevel: number;
  apply(ctx: UpgradeContext, level: number): void;
}

export const UPGRADES: UpgradeDef[] = [
  {
    id: 'engine',
    name: 'Fire Engine',
    desc: 'An additional engine crew',
    baseCost: 150,
    costMult: 1.6,
    maxLevel: 3,
    apply: (ctx) => void ctx.units.spawnEngine(),
  },
  {
    id: 'helicopter',
    name: 'Helicopter',
    desc: 'Water bomber — refills at the pond, hits fire cores',
    baseCost: 420,
    costMult: 1.8,
    maxLevel: 2,
    apply: (ctx) => void ctx.units.spawnHelicopter(),
  },
  {
    id: 'heatVision',
    name: 'Heat Vision',
    desc: 'Thermal overlay reveals smouldering interiors (press H)',
    baseCost: 200,
    costMult: 1,
    maxLevel: 1,
    apply: (ctx) => ctx.unlockHeatVision(),
  },
  {
    id: 'hoseRange',
    name: 'Hose Range',
    desc: '+2 hose range for all engines',
    baseCost: 90,
    costMult: 1.6,
    maxLevel: 4,
    apply: (ctx, level) => ctx.units.applyEngineStat('hoseRange', UNITS.ENGINE.hoseRange + 2 * level),
  },
  {
    id: 'hosePower',
    name: 'Pump Power',
    desc: '+30% water throughput',
    baseCost: 110,
    costMult: 1.6,
    maxLevel: 4,
    apply: (ctx, level) => ctx.units.applyEngineStat('hosePower', UNITS.ENGINE.hosePower * (1 + 0.3 * level)),
  },
  {
    id: 'waterCap',
    name: 'Water Tank',
    desc: '+50% tank capacity',
    baseCost: 100,
    costMult: 1.6,
    maxLevel: 3,
    apply: (ctx, level) => ctx.units.applyEngineStat('waterMax', Math.round(UNITS.ENGINE.waterMax * (1 + 0.5 * level))),
  },
  {
    id: 'refill',
    name: 'Station Pumps',
    desc: '+40% refill speed at the station',
    baseCost: 80,
    costMult: 1.5,
    maxLevel: 3,
    apply: (ctx, level) => ctx.units.applyEngineStat('refillRate', UNITS.ENGINE.refillRate * (1 + 0.4 * level)),
  },
  {
    id: 'speed',
    name: 'Turbo Diesel',
    desc: '+25% engine road speed',
    baseCost: 95,
    costMult: 1.5,
    maxLevel: 3,
    apply: (ctx, level) => ctx.units.applyEngineStat('speed', UNITS.ENGINE.speed * (1 + 0.25 * level)),
  },
];

/** Per-run purchase state + cost curve. */
export class UpgradeShop {
  readonly levels = new Map<string, number>();

  levelOf(id: string): number {
    return this.levels.get(id) ?? 0;
  }

  costOf(def: UpgradeDef): number {
    return Math.round(def.baseCost * Math.pow(def.costMult, this.levelOf(def.id)));
  }

  canBuy(def: UpgradeDef): boolean {
    return this.levelOf(def.id) < def.maxLevel;
  }

  buy(def: UpgradeDef, ctx: UpgradeContext): void {
    const level = this.levelOf(def.id) + 1;
    this.levels.set(def.id, level);
    def.apply(ctx, level);
  }
}
