import { EventBus } from '../core/events';
import { Budget, Focus, TaxRate } from '../meta/budget';

const TAX_OPTIONS: Array<{ id: TaxRate; label: string; desc: string }> = [
  { id: 'low', label: 'Low', desc: '70% income, citizens happier (+integrity)' },
  { id: 'normal', label: 'Normal', desc: 'Balanced income' },
  { id: 'high', label: 'High', desc: '135% income, citizens grumble (−integrity)' },
];
const FOCUS_OPTIONS: Array<{ id: Focus; label: string; desc: string }> = [
  { id: 'training', label: '🎓 Training', desc: '+12% hose throughput' },
  { id: 'maintenance', label: '🔧 Maintenance', desc: '+12% vehicle speed' },
  { id: 'community', label: '🏘 Community', desc: 'Faster fire reports, +integrity' },
  { id: 'savings', label: '🏦 Savings', desc: '−15% running costs' },
];

/** Monthly strategy panel: last month's books plus next month's tax rate and funding focus. */
export class BudgetUi {
  private panel = document.getElementById('budget-panel')!;
  private toggle = document.getElementById('budget-toggle')!;
  private report = document.getElementById('budget-report')!;
  private taxRoot = document.getElementById('budget-tax')!;
  private focusRoot = document.getElementById('budget-focus')!;
  private taxButtons = new Map<TaxRate, HTMLButtonElement>();
  private focusButtons = new Map<Focus, HTMLButtonElement>();

  constructor(
    private budget: Budget,
    events: EventBus,
  ) {
    this.toggle.addEventListener('click', () => this.panel.classList.toggle('open'));
    for (const opt of TAX_OPTIONS) {
      const btn = document.createElement('button');
      btn.className = 'budget-opt';
      btn.innerHTML = `<b>${opt.label}</b><span>${opt.desc}</span>`;
      btn.addEventListener('click', () => {
        budget.taxRate = opt.id;
        budget.applyPolicy();
        this.refresh();
      });
      this.taxRoot.appendChild(btn);
      this.taxButtons.set(opt.id, btn);
    }
    for (const opt of FOCUS_OPTIONS) {
      const btn = document.createElement('button');
      btn.className = 'budget-opt';
      btn.innerHTML = `<b>${opt.label}</b><span>${opt.desc}</span>`;
      btn.addEventListener('click', () => {
        budget.focus = opt.id;
        budget.applyPolicy();
        this.refresh();
      });
      this.focusRoot.appendChild(btn);
      this.focusButtons.set(opt.id, btn);
    }
    events.on('monthEnd', ({ month, tax, upkeep, net }) => {
      const sign = net >= 0 ? '+' : '−';
      events.emit('toast', {
        text: `Month ${month}: +$${tax} tax, −$${upkeep} upkeep (${sign}$${Math.abs(net)})`,
        kind: net >= 0 ? 'good' : 'warn',
      });
      this.refresh();
    });
    this.refresh();
  }

  /** Called ~10 Hz with the HUD for the countdown + projections. */
  refresh(): void {
    const b = this.budget;
    this.toggle.textContent = `📋 Month ${b.month} · ${Math.ceil(b.timeLeft)}s`;
    if (!this.panel.classList.contains('open')) return;
    const exp = b.expenses();
    const lines: string[] = [];
    if (b.lastReport) {
      const r = b.lastReport;
      lines.push(`<div class="b-row b-head">Month ${r.month} books</div>`);
      lines.push(`<div class="b-row"><span>Tax income</span><b class="pos">+$${r.tax}</b></div>`);
      lines.push(`<div class="b-row"><span>Total upkeep</span><b class="neg">−$${r.upkeep}</b></div>`);
      lines.push(`<div class="b-row b-net"><span>Net</span><b class="${r.net >= 0 ? 'pos' : 'neg'}">${r.net >= 0 ? '+' : '−'}$${Math.abs(r.net)}</b></div>`);
    }
    lines.push(`<div class="b-row b-head">Next month projection</div>`);
    lines.push(`<div class="b-row"><span>Tax income</span><b class="pos">+$${b.taxIncome()}</b></div>`);
    lines.push(`<div class="b-row"><span>Engine maintenance</span><b class="neg">−$${exp.engineUpkeep}</b></div>`);
    if (exp.heliUpkeep > 0) lines.push(`<div class="b-row"><span>Helicopter maintenance</span><b class="neg">−$${exp.heliUpkeep}</b></div>`);
    if (exp.salaries > 0) lines.push(`<div class="b-row"><span>Crew salaries</span><b class="neg">−$${exp.salaries}</b></div>`);
    if (exp.hydrantUpkeep > 0) lines.push(`<div class="b-row"><span>Hydrant upkeep</span><b class="neg">−$${exp.hydrantUpkeep}</b></div>`);
    if (exp.equipmentUpkeep > 0) lines.push(`<div class="b-row"><span>Equipment</span><b class="neg">−$${exp.equipmentUpkeep}</b></div>`);
    this.report.innerHTML = lines.join('');
    for (const [id, btn] of this.taxButtons) btn.classList.toggle('active', b.taxRate === id);
    for (const [id, btn] of this.focusButtons) btn.classList.toggle('active', b.focus === id);
  }
}
