import { GRID } from '../config';
import { Flag, Mat, MATERIALS } from '../world/materials';
import { VoxelGrid } from '../world/voxelGrid';

const { W, D, H, CHUNK } = GRID;

/** Baked directional shading per face (sun from +x/+y). */
const FACE_SHADE = [0.82, 0.68, 0.75, 0.62, 1.0, 0.45]; // +x, -x, +z, -z, +y, -y

/** Face vertex offsets (two CCW triangles per face), by face index. */
const FACE_VERTS: number[][][] = [
  // +x
  [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 0], [1, 1, 1], [1, 0, 1]],
  // -x
  [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 1], [0, 1, 0], [0, 0, 0]],
  // +z
  [[1, 0, 1], [1, 1, 1], [0, 1, 1], [1, 0, 1], [0, 1, 1], [0, 0, 1]],
  // -z
  [[0, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 0], [1, 1, 0], [1, 0, 0]],
  // +y
  [[0, 1, 0], [0, 1, 1], [1, 1, 1], [0, 1, 0], [1, 1, 1], [1, 1, 0]],
  // -y
  [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 0], [1, 0, 1], [0, 0, 1]],
];
const FACE_NORMALS = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 0, 1],
  [0, 0, -1],
  [0, 1, 0],
  [0, -1, 0],
];
const FACE_OFFSETS = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 0, 1],
  [0, 0, -1],
  [0, 1, 0],
  [0, -1, 0],
];

export interface MeshResult {
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  vertexCount: number;
}

// Shared scratch buffers (grown on demand) so rebuilds don't allocate.
const SCRATCH_FACES = 24000;
let positions = new Float32Array(SCRATCH_FACES * 18);
let normals = new Float32Array(SCRATCH_FACES * 18);
let colors = new Float32Array(SCRATCH_FACES * 18);

function ensureCapacity(verts: number): void {
  if (verts * 3 <= positions.length) return;
  const next = Math.ceil((verts * 3) / 18) * 2 * 18;
  positions = new Float32Array(next);
  normals = new Float32Array(next);
  colors = new Float32Array(next);
}

/** Deterministic small per-voxel brightness jitter so flat surfaces read as voxels. */
function voxelJitter(x: number, y: number, z: number): number {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0;
  h = (h ^ (h >> 13)) * 1274126177;
  return 0.94 + ((h >>> 16) % 100) / 100 * 0.12;
}

/**
 * Naive per-face-culled mesher: one quad per visible voxel face, with material
 * colour + fire state baked into vertex colours. Writes into shared scratch
 * buffers; the caller copies the used span into its persistent attributes.
 */
export function meshChunk(grid: VoxelGrid, chunkX: number, chunkZ: number): MeshResult {
  let v = 0; // vertex cursor
  const x0 = chunkX * CHUNK;
  const z0 = chunkZ * CHUNK;
  const { material, flags, heat } = grid;

  for (let x = x0; x < x0 + CHUNK; x++) {
    for (let z = z0; z < z0 + CHUNK; z++) {
      const colBase = (x * D + z) * H;
      for (let y = 0; y < H; y++) {
        const idx = colBase + y;
        const mat = material[idx];
        if (mat === Mat.AIR) continue;
        const def = MATERIALS[mat];
        const f = flags[idx];

        for (let face = 0; face < 6; face++) {
          const nx = x + FACE_OFFSETS[face][0];
          const ny = y + FACE_OFFSETS[face][1];
          const nz = z + FACE_OFFSETS[face][2];
          if (ny < 0) continue; // never draw the underside of the world
          if (nx >= 0 && nx < W && nz >= 0 && nz < D && ny < H) {
            if (material[(nx * D + nz) * H + ny] !== Mat.AIR) continue;
          }
          ensureCapacity(v + 6);

          // colour: material base, charred/burning/wet states override or tint
          const baseHex = face === 4 ? def.colorTop : def.colorSide;
          let r = ((baseHex >> 16) & 0xff) / 255;
          let g = ((baseHex >> 8) & 0xff) / 255;
          let b = (baseHex & 0xff) / 255;
          if (f & Flag.CHARRED) {
            const c = def.colorCharred;
            r = ((c >> 16) & 0xff) / 255;
            g = ((c >> 8) & 0xff) / 255;
            b = (c & 0xff) / 255;
          }
          if (f & Flag.BURNING) {
            // ember glow scaled by heat
            const glow = Math.min(1, 0.55 + heat[idx] * 0.004);
            r = r * 0.3 + 1.6 * glow;
            g = g * 0.3 + 0.55 * glow;
            b = b * 0.25;
          } else if (f & Flag.WET) {
            r *= 0.62;
            g *= 0.72;
            b *= 0.95;
          }
          const shade = FACE_SHADE[face] * voxelJitter(x, y, z);
          r *= shade;
          g *= shade;
          b *= shade;

          const verts = FACE_VERTS[face];
          const n = FACE_NORMALS[face];
          for (let i = 0; i < 6; i++) {
            const o = v * 3;
            positions[o] = x + verts[i][0];
            positions[o + 1] = y + verts[i][1];
            positions[o + 2] = z + verts[i][2];
            normals[o] = n[0];
            normals[o + 1] = n[1];
            normals[o + 2] = n[2];
            colors[o] = r;
            colors[o + 1] = g;
            colors[o + 2] = b;
            v++;
          }
        }
      }
    }
  }
  return { positions, normals, colors, vertexCount: v };
}
