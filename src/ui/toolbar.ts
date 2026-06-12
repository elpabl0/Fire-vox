export type Tool = 'order' | 'repair' | 'hydrant' | 'fireBrush' | 'waterBrush';

/**
 * Bottom-left tool selector (dispatch / repair / hydrant placement) plus the
 * hidden dev-mode brushes (triple-click the wind compass to unlock).
 */
export class Toolbar {
  tool: Tool = 'order';
  /** Hydrants bought but not yet placed. */
  hydrantStock = 0;
  devMode = false;

  private buttons: Record<string, HTMLButtonElement> = {
    order: document.getElementById('tool-order') as HTMLButtonElement,
    repair: document.getElementById('tool-repair') as HTMLButtonElement,
    hydrant: document.getElementById('tool-hydrant') as HTMLButtonElement,
    fireBrush: document.getElementById('dev-fire') as HTMLButtonElement,
    waterBrush: document.getElementById('dev-water') as HTMLButtonElement,
  };
  private hydrantBadge = document.getElementById('hydrant-count')!;
  private devPanel = document.getElementById('dev-panel')!;
  private windClicks: number[] = [];

  constructor(onDevCash: () => void) {
    this.buttons.order.addEventListener('click', () => this.select('order'));
    this.buttons.repair.addEventListener('click', () => this.select('repair'));
    this.buttons.hydrant.addEventListener('click', () => this.select('hydrant'));
    this.buttons.fireBrush.addEventListener('click', () => this.select(this.tool === 'fireBrush' ? 'order' : 'fireBrush'));
    this.buttons.waterBrush.addEventListener('click', () => this.select(this.tool === 'waterBrush' ? 'order' : 'waterBrush'));
    document.getElementById('dev-cash')!.addEventListener('click', onDevCash);

    // dev mode: three quick clicks on the wind compass
    document.getElementById('wind-panel')!.addEventListener('click', () => {
      const now = performance.now();
      this.windClicks = this.windClicks.filter((t) => now - t < 1600);
      this.windClicks.push(now);
      if (this.windClicks.length >= 3) {
        this.windClicks = [];
        this.devMode = !this.devMode;
        this.devPanel.classList.toggle('open', this.devMode);
        if (!this.devMode && (this.tool === 'fireBrush' || this.tool === 'waterBrush')) this.select('order');
      }
    });
    this.refresh();
  }

  select(tool: Tool): void {
    if (tool === 'hydrant' && this.hydrantStock === 0) return;
    this.tool = tool;
    this.refresh();
  }

  addHydrant(): void {
    this.hydrantStock++;
    this.refresh();
  }

  /** Consume one hydrant from stock; returns false if empty. */
  useHydrant(): boolean {
    if (this.hydrantStock === 0) return false;
    this.hydrantStock--;
    if (this.hydrantStock === 0 && this.tool === 'hydrant') this.select('order');
    this.refresh();
    return true;
  }

  private refresh(): void {
    for (const [name, btn] of Object.entries(this.buttons)) {
      btn.classList.toggle('active', this.tool === name);
    }
    this.buttons.hydrant.disabled = this.hydrantStock === 0;
    this.hydrantBadge.style.display = this.hydrantStock > 0 ? 'block' : 'none';
    this.hydrantBadge.textContent = `${this.hydrantStock}`;
  }
}
