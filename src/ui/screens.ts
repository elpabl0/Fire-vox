import { SaveData } from '../meta/persistence';

/** Title / game-over overlays. */
export class Screens {
  private overlay = document.getElementById('screen-overlay')!;

  showTitle(save: SaveData, seed: number, onStart: () => void): void {
    this.overlay.innerHTML = `
      <h1><span class="fire">FIRE</span>-VOX</h1>
      <p>Fires are breaking out across the city. Direct your engines, manage water,
      and watch the wind — it carries embers to new rooftops. Earn cash for every
      blaze contained and invest in your fire department to survive escalating waves.</p>
      <p>
        <b>Tap/click</b> a fire to dispatch &nbsp;·&nbsp; <b>tap a unit</b> to select &nbsp;·&nbsp;
        <b>drag / WASD</b> pan &nbsp;·&nbsp; <b>pinch / wheel</b> zoom &nbsp;·&nbsp;
        <b>twist / right-drag / Q,E</b> rotate &nbsp;·&nbsp;
        <b>H</b> heat vision (once purchased) &nbsp;·&nbsp; <b>Space</b> pause
      </p>
      ${save.highScore > 0 ? `<div id="screen-stats">High score: ${save.highScore} · Best wave: ${save.bestWave}</div>` : ''}
      <p style="font-size:12px">City seed: ${seed} (set ?seed=N in the URL to replay a map)</p>
      <button class="big-btn" id="start-btn">Start Shift</button>
    `;
    this.overlay.classList.add('open');
    document.getElementById('start-btn')!.addEventListener('click', () => {
      this.hide();
      onStart();
    });
  }

  showGameOver(score: number, wave: number, save: SaveData, isRecord: boolean): void {
    this.overlay.innerHTML = `
      <h1>CITY <span class="fire">LOST</span></h1>
      <p>The city's integrity has collapsed under the flames.</p>
      <div id="screen-stats">
        Final score: <b>${score}</b> · Reached wave <b>${wave}</b><br/>
        ${isRecord ? '🏆 New high score!' : `High score: ${save.highScore}`}
      </div>
      <button class="big-btn" id="restart-btn">New Shift</button>
    `;
    this.overlay.classList.add('open');
    document.getElementById('restart-btn')!.addEventListener('click', () => {
      const url = new URL(window.location.href);
      url.searchParams.delete('seed');
      window.location.href = url.toString();
    });
  }

  hide(): void {
    this.overlay.classList.remove('open');
  }
}
