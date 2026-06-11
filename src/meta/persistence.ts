/** localStorage persistence: high score + last seed. Fails quietly (e.g. private browsing). */

const KEY = 'fire-vox-save-v1';

export interface SaveData {
  highScore: number;
  bestWave: number;
  lastSeed: number;
}

export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const data = JSON.parse(raw) as Partial<SaveData>;
      return {
        highScore: data.highScore ?? 0,
        bestWave: data.bestWave ?? 0,
        lastSeed: data.lastSeed ?? 0,
      };
    }
  } catch {
    // ignore
  }
  return { highScore: 0, bestWave: 0, lastSeed: 0 };
}

export function storeSave(data: SaveData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // ignore
  }
}

export function recordRun(score: number, wave: number, seed: number): SaveData {
  const save = loadSave();
  const updated: SaveData = {
    highScore: Math.max(save.highScore, score),
    bestWave: Math.max(save.bestWave, wave),
    lastSeed: seed,
  };
  storeSave(updated);
  return updated;
}
