# 🔥 Fire-Vox

A web-based firefighting resource strategy game: a procedurally generated, top-down 3D **voxel city** where fires break out and spread organically — and you direct a limited fire department to contain them.

![Fire-Vox](https://img.shields.io/badge/engine-Three.js-orange) ![](https://img.shields.io/badge/sim-deterministic-blue) ![](https://img.shields.io/badge/assets-100%25%20procedural-green)

## Playing

```bash
npm install
npm run dev      # then open the printed URL
```

**You are the dispatcher** — engines never self-deploy across the city. Watch for outbreak alerts, click a unit (or its card), then click the fire. A coloured beacon marks each unit's ordered destination, and units can be re-deployed at any time the same way. Units close to a blaze will pitch in on their own.

- **Left-click a fire** — dispatch the selected (or nearest idle) unit; a beacon tracks the order
- **Click a unit / unit card** — select it; **Esc** deselects
- **WASD / arrows** pan · **right-drag / Q,E** rotate · **wheel** zoom
- **🔧 Repair tool** (or **R**) — click a damaged building to rebuild it; cost scales with damage
- **⛲ Hydrant tool** — place purchased hydrants near roads; engines refill at the nearest water point
- **H** — heat vision (once purchased) · **Space** — pause · **`** — debug panel
- `?seed=N` in the URL replays the same city

Survive escalating waves of outbreaks. Cash earned from extinguishing fires and saving buildings buys upgrades: more engines, firefighter crews that run hand lines on foot, a water-bombing helicopter (lands back at HQ between calls), heat vision, hydrants, and better hoses/tanks/pumps. Lose too many buildings and the city falls.

*Psst — click the wind compass three times quickly.*

## How it works

- **World** — a seeded 256×256×40 voxel grid. City generation lays a jittered road grid, then fills blocks with wooden houses (floors, chimneys), brick/concrete offices and towers (slabs, partitions, parapets, rooftop clutter), industrial yards (fuel tanks, racking, pipework), parks, a pond, and a proper red-brick fire HQ with garage bays and a watchtower. Every material has flammability, ignition threshold, fuel, heat output and smoke values (`src/world/materials.ts`).
- **Fire** — a 6 Hz discrete simulation over a sparse *active set* (never full-grid scans). Burning voxels radiate heat to neighbours with wind-direction, vertical and wetness multipliers; ignition is probabilistic so fronts stay ragged and organic. Strong wind throws embers that start spot fires downwind. Burned voxels char, may be destroyed, collapse layer by layer, and drop rubble.
- **Weather** — random clear/rain/storm/snow with a day-night cycle, sun shadows and moonlight. Rain douses exposed fire and suppresses spread (roads take on a wet sheen afterwards); storms force gale-strength wind — prime ember weather; snow settles white on rooftops.
- **Water** — hose streams are ballistic arcs; impacts cool and wet voxels (wet fuel resists ignition — spray ahead of the front to cut firebreaks). Helicopters refill at the pond and drop on the hottest core.
- **Unit AI** — burning voxels are clustered ~1×/s; a coordinator hands each unit a *distinct, spaced* perimeter target with a road standing spot, so units fighting the same blaze fan out along its edge. Firefighter crews hop off and run tethered hand lines fed by the engine's tank.
- **Driving** — engines accelerate, brake into corners and drift when pushed, leaving tyre marks. Civilian cars cruise the roads (pulling over for sirens) and pedestrians wander the sidewalks — both flee approaching fire, though some stop to gawk from a safe distance.
- **Rendering** — chunked per-face-culled voxel meshes with budgeted dirty-chunk rebuilds; GPU-animated smoke/flame/ember/rain/snow particles; damage, charring and wet states baked into vertex colours; heat vision projects a per-column thermal map directly onto the voxels.
- **Determinism** — the sim is pure TypeScript with no Three.js imports, fully seeded (`Math.random` is banned outside `src/core/rng.ts`), and unit-tested headless.

## Development

```bash
npm test                        # vitest: determinism, fire invariants, A*, claims, repair, weather, economy
npm run build                   # tsc + vite production build
node scripts/verify.mjs         # headless-browser player session (needs playwright chromium)
node scripts/verify-upgrades.mjs
node scripts/verify-tools.mjs   # crew / hydrant / repair tools
node scripts/verify-stress.mjs  # city-wide inferno perf check
```

All gameplay tunables live in `src/config.ts`. Note: headless Chromium uses software rendering and runs the render loop well below 60 fps, so wall-clock timings in the verify scripts are slower than real gameplay on a GPU.
