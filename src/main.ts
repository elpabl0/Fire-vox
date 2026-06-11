import { Game } from './game';

function pickSeed(): number {
  const param = new URLSearchParams(window.location.search).get('seed');
  if (param) {
    const n = Number(param);
    if (Number.isFinite(n) && n > 0) return Math.floor(n);
  }
  return (Date.now() % 1000000) + 1;
}

const seed = pickSeed();
// reflect the seed in the URL so maps are shareable
const url = new URL(window.location.href);
if (url.searchParams.get('seed') !== String(seed)) {
  url.searchParams.set('seed', String(seed));
  window.history.replaceState(null, '', url.toString());
}

const game = new Game(seed);
// exposed for debugging and scripted browser verification
(window as unknown as { game: Game }).game = game;
