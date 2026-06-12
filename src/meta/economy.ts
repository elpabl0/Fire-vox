import { ECONOMY } from '../config';
import { EventBus } from '../core/events';
import { Building } from '../world/buildings';

/**
 * Cash/score/integrity ledger. Listens to sim events: extinguishing earns,
 * buildings settling as saved earns bonuses, lost buildings drain city
 * integrity; integrity 0 ends the run.
 */
export class Economy {
  cash = ECONOMY.STARTING_CASH;
  score = 0;
  integrity: number = ECONOMY.STARTING_INTEGRITY;
  buildingsSaved = 0;
  buildingsLost = 0;
  private extinguishedFraction = 0;
  private over = false;

  constructor(
    private buildings: Building[],
    private events: EventBus,
    private waveRef: { wave: number },
  ) {
    events.on('extinguished', () => {
      // fractional accumulator so per-voxel rewards < $1 still add up
      this.extinguishedFraction += ECONOMY.CASH_PER_EXTINGUISHED_VOXEL;
      if (this.extinguishedFraction >= 1) {
        const whole = Math.floor(this.extinguishedFraction);
        this.extinguishedFraction -= whole;
        this.earn(whole);
      }
    });
    events.on('buildingSettled', ({ buildingId, outcome }) => {
      const b = this.buildings[buildingId];
      if (outcome === 'saved') {
        this.buildingsSaved++;
        const bonus = Math.round(ECONOMY.SAVE_BONUS * b.lotValue);
        this.earn(bonus);
        this.events.emit('toast', { text: `${kindLabel(b)} saved! +$${bonus}`, kind: 'good' });
      } else if (outcome === 'lost') {
        this.buildingsLost++;
        this.events.emit('toast', { text: `${kindLabel(b)} lost!`, kind: 'warn' });
        this.adjustIntegrity(-ECONOMY.INTEGRITY_LOSS * Math.max(1, b.lotValue));
      }
    });
    events.on('waveCleared', ({ wave, bonus }) => {
      this.earn(bonus);
      this.events.emit('toast', { text: `Wave ${wave} contained! +$${bonus}`, kind: 'good' });
    });
  }

  get isGameOver(): boolean {
    return this.over;
  }

  /** Clamped integrity change; hitting zero ends the run. */
  adjustIntegrity(delta: number): void {
    this.integrity = Math.max(0, Math.min(100, this.integrity + delta));
    if (this.integrity <= 0 && !this.over) {
      this.over = true;
      this.events.emit('gameOver', { score: this.score, wave: this.waveRef.wave });
    }
  }

  earn(amount: number): void {
    this.cash += amount;
    this.score += amount;
    this.events.emit('cashChanged', { cash: this.cash });
  }

  /** Returns false if unaffordable. */
  spend(amount: number): boolean {
    if (this.cash < amount) return false;
    this.cash -= amount;
    this.events.emit('cashChanged', { cash: this.cash });
    return true;
  }
}

function kindLabel(b: Building): string {
  switch (b.kind) {
    case 'house':
      return 'House';
    case 'office':
      return 'Office';
    case 'tower':
      return 'Tower';
    case 'industrial':
      return 'Industrial site';
    default:
      return 'Building';
  }
}
