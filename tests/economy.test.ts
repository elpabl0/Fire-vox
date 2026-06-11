import { describe, expect, it } from 'vitest';
import { ECONOMY } from '../src/config';
import { EventBus } from '../src/core/events';
import { Economy } from '../src/meta/economy';
import { UPGRADES, UpgradeShop } from '../src/meta/upgrades';
import { Building, makeBuilding } from '../src/world/buildings';

function setup() {
  const events = new EventBus();
  const buildings: Building[] = [makeBuilding(0, 'house', 0, 0, 0, 0, 0), makeBuilding(1, 'office', 2, 0, 0, 5, 5)];
  const economy = new Economy(buildings, events, { wave: 3 });
  return { events, economy, buildings };
}

describe('Economy', () => {
  it('accumulates fractional extinguish rewards into whole dollars', () => {
    const { events, economy } = setup();
    const start = economy.cash;
    const n = 50;
    for (let i = 0; i < n; i++) events.emit('extinguished', { idx: i });
    const expected = Math.floor(n * ECONOMY.CASH_PER_EXTINGUISHED_VOXEL);
    expect(economy.cash - start).toBeGreaterThanOrEqual(expected - 1);
    expect(economy.cash - start).toBeLessThanOrEqual(expected);
  });

  it('pays save bonuses scaled by lot value', () => {
    const { events, economy } = setup();
    const start = economy.cash;
    events.emit('buildingSettled', { buildingId: 1, outcome: 'saved', damageRatio: 0.1 });
    expect(economy.cash - start).toBe(Math.round(ECONOMY.SAVE_BONUS * 2));
    expect(economy.buildingsSaved).toBe(1);
  });

  it('drains integrity on lost buildings and fires gameOver at zero', () => {
    const { events, economy } = setup();
    let over = false;
    events.on('gameOver', () => (over = true));
    const losses = Math.ceil(ECONOMY.STARTING_INTEGRITY / (ECONOMY.INTEGRITY_LOSS * 2));
    for (let i = 0; i < losses; i++) {
      events.emit('buildingSettled', { buildingId: 1, outcome: 'lost', damageRatio: 0.9 });
    }
    expect(economy.integrity).toBe(0);
    expect(over).toBe(true);
    expect(economy.isGameOver).toBe(true);
  });

  it('spend() refuses overdrafts', () => {
    const { economy } = setup();
    expect(economy.spend(economy.cash + 1)).toBe(false);
    expect(economy.spend(10)).toBe(true);
  });
});

describe('UpgradeShop', () => {
  it('applies the cost curve per level', () => {
    const shop = new UpgradeShop();
    const def = UPGRADES.find((u) => u.id === 'hoseRange')!;
    const c0 = shop.costOf(def);
    expect(c0).toBe(def.baseCost);
    shop.levels.set(def.id, 1);
    expect(shop.costOf(def)).toBe(Math.round(def.baseCost * def.costMult));
    shop.levels.set(def.id, 2);
    expect(shop.costOf(def)).toBe(Math.round(def.baseCost * def.costMult * def.costMult));
  });

  it('enforces max level', () => {
    const shop = new UpgradeShop();
    const def = UPGRADES.find((u) => u.id === 'heatVision')!;
    expect(shop.canBuy(def)).toBe(true);
    shop.levels.set(def.id, def.maxLevel);
    expect(shop.canBuy(def)).toBe(false);
  });
});
