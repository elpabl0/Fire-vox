# 🔥 Fire-Vox

A web-based firefighting resource strategy game: a procedurally generated, top-down 3D **voxel city** where fires break out and spread organically — and you direct a limited fire department to contain them.

![Fire-Vox](https://img.shields.io/badge/engine-Three.js-orange) ![](https://img.shields.io/badge/sim-deterministic-blue) ![](https://img.shields.io/badge/assets-100%25%20procedural-green)

## Playing

```bash
npm install
npm run dev      # then open the printed URL
```

- **Left-click a fire** — dispatch the selected (or nearest idle) engine
- **Click a unit / unit card** — select it; **Esc** deselects
- **WASD / arrows** pan · **right-drag / Q,E** rotate · **wheel** zoom
- **H** — toggle heat vision (once purchased)
- **Space** — pause · **`** (backtick) — debug panel · **Shift+click** — ignite (debug)
- `?seed=N` in the URL replays the same city; the title screen shows your current seed

Survive escalating waves of outbreaks. Cash earned from extinguishing fires and saving buildings buys upgrades: more engines, a water-bombing helicopter, heat vision, and better hoses/tanks/pumps. Lose too many buildings and the city falls.

## How it works

- **World** — a seeded 128×128×32 voxel grid. City generation lays a jittered road grid, then fills blocks with wooden houses, brick/concrete offices, towers, industrial yards (fuel tanks!), parks and a pond. Every material has flammability, ignition threshold, fuel, heat output and smoke values (`src/world/materials.ts`).
- **Fire** — a 6 Hz discrete simulation over a sparse *active set* (never full-grid scans). Burning voxels radiate heat to neighbours with wind-direction, vertical and wetness multipliers; ignition is probabilistic so fronts stay ragged and organic. Strong wind throws embers that start spot fires downwind. Burned voxels char, may be destroyed, and unsupported voxels collapse layer by layer.
- **Water** — hose streams are ballistic arcs; impacts cool and wet voxels (wet fuel resists ignition — spray ahead of the front to cut firebreaks). Helicopters refill at the pond and drop on the hottest core.
- **Unit AI** — burning voxels are clustered ~1×/s; a coordinator hands each engine a *distinct, spaced* perimeter target with a road standing spot, so units fighting the same blaze fan out along its edge instead of cross-spraying.
- **Rendering** — chunked per-face-culled voxel meshes with budgeted dirty-chunk rebuilds; GPU-animated smoke/flame/ember particles (the CPU only writes spawns); damage, charring and wet states baked into vertex colours.
- **Determinism** — the sim is pure TypeScript with no Three.js imports, fully seeded (`Math.random` is banned outside `src/core/rng.ts`), and unit-tested headless.

## Development

```bash
npm test                       # vitest: determinism, fire invariants, A*, claims, economy
npm run build                  # tsc + vite production build
node scripts/verify.mjs        # headless-browser smoke test (needs playwright chromium)
node scripts/verify-upgrades.mjs
node scripts/verify-stress.mjs # city-wide inferno perf check
```

All gameplay tunables live in `src/config.ts`.
