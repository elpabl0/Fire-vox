import { EventBus } from '../core/events';
import { Economy } from '../meta/economy';
import { UnitBase } from '../units/unit';
import { UnitManager } from '../units/unitManager';

/** DOM HUD: cash/score/wave/integrity, unit cards with water gauges, toasts. */
export class Hud {
  private cashEl = document.getElementById('cash-value')!;
  private scoreEl = document.getElementById('score-value')!;
  private waveEl = document.getElementById('wave-value')!;
  private integrityEl = document.getElementById('integrity-fill')!;
  private unitPanel = document.getElementById('unit-panel')!;
  private toastArea = document.getElementById('toast-area')!;
  private cards = new Map<UnitBase, { root: HTMLElement; state: HTMLElement; fill: HTMLElement }>();

  constructor(
    private economy: Economy,
    private units: UnitManager,
    private waveRef: { wave: number },
    events: EventBus,
  ) {
    events.on('toast', ({ text, kind }) => this.toast(text, kind));
  }

  toast(text: string, kind: 'info' | 'warn' | 'good'): void {
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.textContent = text;
    this.toastArea.appendChild(el);
    setTimeout(() => el.remove(), 3800);
    while (this.toastArea.children.length > 4) this.toastArea.firstChild?.remove();
  }

  update(): void {
    this.cashEl.textContent = `$${Math.floor(this.economy.cash)}`;
    this.scoreEl.textContent = `${Math.floor(this.economy.score)}`;
    this.waveEl.textContent = `${this.waveRef.wave}`;
    const integrity = this.economy.integrity;
    this.integrityEl.style.width = `${integrity}%`;
    this.integrityEl.style.background = integrity > 60 ? '#7fe08a' : integrity > 30 ? '#f0c050' : '#e85040';

    // unit cards
    for (const unit of this.units.units) {
      if (!this.cards.has(unit)) {
        const root = document.createElement('div');
        root.className = 'unit-card';
        const name = document.createElement('div');
        name.className = 'name';
        name.textContent = unit.kind === 'engine' ? `🚒 ${unit.name}` : `🚁 ${unit.name}`;
        const state = document.createElement('div');
        state.className = 'state';
        const bar = document.createElement('div');
        bar.className = 'water-bar';
        const fill = document.createElement('div');
        fill.className = 'water-fill';
        bar.appendChild(fill);
        root.append(name, state, bar);
        root.addEventListener('click', () => {
          this.units.selected = this.units.selected === unit ? null : unit;
        });
        this.unitPanel.appendChild(root);
        this.cards.set(unit, { root, state, fill });
      }
      const card = this.cards.get(unit)!;
      card.root.classList.toggle('selected', this.units.selected === unit);
      card.state.textContent = unit.state;
      card.fill.style.width = `${unit.waterFraction * 100}%`;
    }
  }
}
