import { GRID } from '../config';
import { Mat, MATERIALS, Flag } from './materials';

const { W, D, H, CHUNK } = GRID;
export const CHUNKS_X = W / CHUNK;
export const CHUNKS_Z = D / CHUNK;

/**
 * Structure-of-arrays voxel storage. Index layout: idx = (x*D + z)*H + y
 * (y fastest, making column scans cache-friendly).
 */
export class VoxelGrid {
  readonly material = new Uint8Array(W * D * H);
  readonly fuel = new Uint8Array(W * D * H);
  readonly heat = new Float32Array(W * D * H);
  readonly flags = new Uint8Array(W * D * H);
  /** Building/lot id per voxel; 0 = none. */
  readonly owner = new Uint16Array(W * D * H);
  /** Pristine post-generation state, captured once — the repair tool restores from these. */
  readonly originalMaterial = new Uint8Array(W * D * H);
  readonly originalOwner = new Uint16Array(W * D * H);

  /** Capture the pristine city state. Call once at the end of generation. */
  snapshotOriginal(): void {
    this.originalMaterial.set(this.material);
    this.originalOwner.set(this.owner);
  }

  /** Chunk ids needing a mesh rebuild, drained by the renderer. */
  readonly dirtyChunks = new Set<number>();

  idx(x: number, y: number, z: number): number {
    return (x * D + z) * H + y;
  }

  xOf(idx: number): number {
    return Math.floor(idx / (D * H));
  }

  zOf(idx: number): number {
    return Math.floor(idx / H) % D;
  }

  yOf(idx: number): number {
    return idx % H;
  }

  inBounds(x: number, y: number, z: number): boolean {
    return x >= 0 && x < W && z >= 0 && z < D && y >= 0 && y < H;
  }

  /** Set material + derived fuel, clear flags. Used during generation and destruction. */
  setVoxel(x: number, y: number, z: number, mat: Mat, owner = 0): void {
    const i = this.idx(x, y, z);
    this.material[i] = mat;
    this.fuel[i] = MATERIALS[mat].fuelTicks;
    this.flags[i] = 0;
    this.owner[i] = owner;
  }

  isSolid(idx: number): boolean {
    return this.material[idx] !== Mat.AIR;
  }

  isBurning(idx: number): boolean {
    return (this.flags[idx] & Flag.BURNING) !== 0;
  }

  /** Highest solid voxel y in the column at (x,z), or -1 if empty. */
  topY(x: number, z: number): number {
    const base = (x * D + z) * H;
    for (let y = H - 1; y >= 0; y--) {
      if (this.material[base + y] !== Mat.AIR) return y;
    }
    return -1;
  }

  chunkIdAt(x: number, z: number): number {
    return Math.floor(x / CHUNK) * CHUNKS_Z + Math.floor(z / CHUNK);
  }

  /** Mark the chunk containing (x,z) dirty, plus border-adjacent neighbours (face culling looks across boundaries). */
  markDirty(x: number, z: number): void {
    const cx = Math.floor(x / CHUNK);
    const cz = Math.floor(z / CHUNK);
    this.dirtyChunks.add(cx * CHUNKS_Z + cz);
    const lx = x % CHUNK;
    const lz = z % CHUNK;
    if (lx === 0 && cx > 0) this.dirtyChunks.add((cx - 1) * CHUNKS_Z + cz);
    if (lx === CHUNK - 1 && cx < CHUNKS_X - 1) this.dirtyChunks.add((cx + 1) * CHUNKS_Z + cz);
    if (lz === 0 && cz > 0) this.dirtyChunks.add(cx * CHUNKS_Z + cz - 1);
    if (lz === CHUNK - 1 && cz < CHUNKS_Z - 1) this.dirtyChunks.add(cx * CHUNKS_Z + cz + 1);
  }

  markDirtyIdx(idx: number): void {
    this.markDirty(this.xOf(idx), this.zOf(idx));
  }

  markAllDirty(): void {
    for (let c = 0; c < CHUNKS_X * CHUNKS_Z; c++) this.dirtyChunks.add(c);
  }

  /** FNV-1a hash of material+flags state — used by determinism tests. */
  stateHash(): number {
    let h = 0x811c9dc5;
    const m = this.material;
    const f = this.flags;
    for (let i = 0; i < m.length; i++) {
      h ^= m[i];
      h = Math.imul(h, 0x01000193);
      h ^= f[i];
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }
}
