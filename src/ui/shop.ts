import { Economy } from '../meta/economy';
import { UPGRADES, UpgradeContext, UpgradeShop } from '../meta/upgrades';
import { EventBus } from '../core/events';

/** Upgrade shop panel: declarative rows from UPGRADES, buy buttons wired to the economy. */
export class ShopUi {
  private panel = document.getElementById('shop-panel')!;
  private itemsRoot = document.getElementById('shop-items')!;
  private buttons = new Map<string, { btn: HTMLButtonElement; name: HTMLElement }>();

  constructor(
    private shop: UpgradeShop,
    private economy: Economy,
    private ctx: UpgradeContext,
    private events: EventBus,
  ) {
    document.getElementById('shop-toggle')!.addEventListener('click', () => {
      this.panel.classList.toggle('open');
    });
    for (const def of UPGRADES) {
      const row = document.createElement('div');
      row.className = 'shop-item';
      const info = document.createElement('div');
      info.className = 'info';
      const name = document.createElement('div');
      name.className = 'iname';
      const desc = document.createElement('div');
      desc.className = 'idesc';
      desc.textContent = def.desc;
      info.append(name, desc);
      const btn = document.createElement('button');
      btn.addEventListener('click', () => this.buy(def.id));
      row.append(info, btn);
      this.itemsRoot.appendChild(row);
      this.buttons.set(def.id, { btn, name });
    }
    this.refresh();
  }

  private buy(id: string): void {
    const def = UPGRADES.find((d) => d.id === id)!;
    if (!this.shop.canBuy(def)) return;
    const cost = this.shop.costOf(def);
    if (!this.economy.spend(cost)) {
      this.events.emit('toast', { text: 'Not enough cash', kind: 'warn' });
      return;
    }
    this.shop.buy(def, this.ctx);
    this.events.emit('toast', { text: `${def.name} purchased`, kind: 'good' });
    this.refresh();
  }

  /** Refresh prices/affordability. Cheap; called ~10 Hz with the HUD. */
  refresh(): void {
    for (const def of UPGRADES) {
      const { btn, name } = this.buttons.get(def.id)!;
      const level = this.shop.levelOf(def.id);
      const maxed = !this.shop.canBuy(def);
      name.textContent = def.maxLevel > 1 ? `${def.name} (${level}/${def.maxLevel})` : def.name;
      if (maxed) {
        btn.textContent = 'MAX';
        btn.disabled = true;
      } else {
        const cost = this.shop.costOf(def);
        btn.textContent = `$${cost}`;
        btn.disabled = this.economy.cash < cost;
      }
    }
  }
}
