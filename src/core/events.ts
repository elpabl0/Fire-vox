/** Typed event bus connecting the sim to rendering/UI without direct coupling. */

export interface GameEvents {
  ignited: { idx: number };
  extinguished: { idx: number };
  burnedOut: { idx: number };
  voxelDestroyed: { idx: number };
  buildingSettled: { buildingId: number; outcome: 'saved' | 'damaged' | 'lost'; damageRatio: number };
  outbreak: { x: number; z: number };
  /** A fire has been called in (after the detection delay) — alerts may now show it. */
  fireReported: { x: number; z: number };
  /** Monthly budget settled. */
  monthEnd: { month: number; tax: number; upkeep: number; net: number };
  waveStarted: { wave: number };
  waveCleared: { wave: number; bonus: number };
  toast: { text: string; kind: 'info' | 'warn' | 'good' };
  gameOver: { score: number; wave: number };
  cashChanged: { cash: number };
}

type Handler<T> = (payload: T) => void;

export class EventBus {
  private handlers = new Map<keyof GameEvents, Set<Handler<never>>>();

  on<K extends keyof GameEvents>(event: K, fn: Handler<GameEvents[K]>): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(fn as Handler<never>);
    return () => set!.delete(fn as Handler<never>);
  }

  emit<K extends keyof GameEvents>(event: K, payload: GameEvents[K]): void {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const fn of set) (fn as Handler<GameEvents[K]>)(payload);
  }

  clear(): void {
    this.handlers.clear();
  }
}
