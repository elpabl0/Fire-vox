import { BUDGET } from '../config';
import { EventBus } from '../core/events';
import { Building } from '../world/buildings';
import { UnitManager } from '../units/unitManager';
import { DetectionSystem } from '../sim/detection';
import { Engine } from '../units/engine';
import { Economy } from './economy';
import { UpgradeShop } from './upgrades';

export type TaxRate = 'low' | 'normal' | 'high';
export type Focus = 'training' | 'maintenance' | 'community' | 'savings';

export interface MonthReport {
  month: number;
  tax: number;
  engineUpkeep: number;
  heliUpkeep: number;
  salaries: number;
  hydrantUpkeep: number;
  equipmentUpkeep: number;
  upkeep: number;
  net: number;
}

/**
 * The strategic/economic layer: every in-game month, tax income from the
 * surviving city is collected and the department's running costs (vehicle
 * maintenance, salaries, equipment) are paid. The player sets a monthly
 * strategy: tax rate (income vs civic goodwill) and a funding focus
 * (training / maintenance / community / savings).
 */
export class Budget {
  taxRate: TaxRate = 'normal';
  focus: Focus = 'training';
  month = 1;
  timeLeft: number = BUDGET.MONTH_S;
  lastReport: MonthReport | null = null;
  /** Base detection multiplier from the alarm-network upgrade (set by the shop). */
  upgradeDetectionMul = 1;

  constructor(
    private buildings: Building[],
    private economy: Economy,
    private units: UnitManager,
    private shop: UpgradeShop,
    private detection: DetectionSystem,
    private events: EventBus,
  ) {
    this.applyPolicy();
  }

  update(dt: number): void {
    this.timeLeft -= dt;
    if (this.timeLeft <= 0) {
      this.timeLeft += BUDGET.MONTH_S;
      this.settle();
    }
  }

  /** Continuous policy effects — call after changing taxRate/focus or upgrades. */
  applyPolicy(): void {
    this.units.policy.hosePowerMul = this.focus === 'training' ? BUDGET.FOCUS_POWER_MUL : 1;
    this.units.policy.speedMul = this.focus === 'maintenance' ? BUDGET.FOCUS_SPEED_MUL : 1;
    this.detection.delayMul = this.upgradeDetectionMul * (this.focus === 'community' ? BUDGET.FOCUS_DETECTION_MUL : 1);
  }

  /** Preview of next month's expense lines at current staffing. */
  expenses(): Omit<MonthReport, 'month' | 'tax' | 'net'> {
    let engines = 0;
    let helis = 0;
    let crew = 0;
    for (const u of this.units.units) {
      if (u.kind === 'engine') {
        engines++;
        crew += (u as Engine).crew.length;
      } else if (u.kind === 'helicopter') {
        helis++;
      }
    }
    let levels = 0;
    for (const lvl of this.shop.levels.values()) levels += lvl;
    const mul = this.focus === 'savings' ? BUDGET.FOCUS_EXPENSE_MUL : 1;
    const engineUpkeep = Math.round(engines * BUDGET.ENGINE_UPKEEP * mul);
    const heliUpkeep = Math.round(helis * BUDGET.HELI_UPKEEP * mul);
    const salaries = Math.round(crew * BUDGET.CREW_SALARY * mul);
    const hydrantUpkeep = Math.round(this.units.hydrants.length * BUDGET.HYDRANT_UPKEEP * mul);
    const equipmentUpkeep = Math.round(levels * BUDGET.EQUIPMENT_UPKEEP_PER_LEVEL * mul);
    return {
      engineUpkeep,
      heliUpkeep,
      salaries,
      hydrantUpkeep,
      equipmentUpkeep,
      upkeep: engineUpkeep + heliUpkeep + salaries + hydrantUpkeep + equipmentUpkeep,
    };
  }

  /** Tax base: surviving building stock, scaled by city integrity and the tax rate. */
  taxIncome(): number {
    let lotValue = 0;
    for (let i = 1; i < this.buildings.length; i++) {
      const b = this.buildings[i];
      if (b.kind === 'station') continue;
      // a building counts while it keeps most of its structure
      if (b.totalVoxels > 0 && b.damagedVoxels / b.totalVoxels > 0.7) continue;
      lotValue += b.lotValue;
    }
    const integrityFactor = 0.5 + (this.economy.integrity / 100) * 0.5;
    return Math.round(lotValue * BUDGET.TAX_PER_LOT_VALUE * BUDGET.TAX_RATES[this.taxRate] * integrityFactor);
  }

  private settle(): void {
    const tax = this.taxIncome();
    const exp = this.expenses();
    const net = tax - exp.upkeep;
    if (net >= 0) {
      this.economy.earn(net);
    } else if (!this.economy.spend(-net)) {
      // can't make payroll: pay what we can, the city loses confidence
      const shortfall = -net - this.economy.cash;
      this.economy.spend(this.economy.cash);
      this.events.emit('toast', { text: `Underfunded! Short $${shortfall} — city confidence drops`, kind: 'warn' });
      this.economy.adjustIntegrity(-Math.ceil(shortfall / 10));
    }
    // civic drift: tax rate goodwill + community programmes + slow recovery
    this.economy.adjustIntegrity(
      BUDGET.INTEGRITY_REGEN + BUDGET.TAX_INTEGRITY[this.taxRate] + (this.focus === 'community' ? BUDGET.FOCUS_INTEGRITY_BONUS : 0),
    );

    this.lastReport = { month: this.month, tax, ...exp, net };
    this.events.emit('monthEnd', { month: this.month, tax, upkeep: exp.upkeep, net });
    this.month++;
  }
}
