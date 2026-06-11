import * as THREE from 'three';
import { RENDER } from '../config';
import { VoxelGrid, CHUNKS_X, CHUNKS_Z } from '../world/voxelGrid';
import { meshChunk } from './chunkMesher';
import { heatVisionUniform } from './heatVision';

/**
 * Owns one mesh per chunk. Drains the grid's dirty set with a per-frame budget;
 * persistent attribute buffers grow by power-of-two so steady-state rebuilds
 * reuse allocations and just re-upload.
 */
export class ChunkManager {
  private meshes: THREE.Mesh[] = [];
  private capacities: number[] = []; // vertex capacity per chunk
  private material: THREE.MeshLambertMaterial;

  constructor(
    private grid: VoxelGrid,
    scene: THREE.Scene,
  ) {
    this.material = new THREE.MeshLambertMaterial({ vertexColors: true });
    // heat-vision mute: desaturate and darken the city so the heat plane pops
    this.material.onBeforeCompile = (shader) => {
      shader.uniforms.uHeatVision = heatVisionUniform;
      shader.fragmentShader = shader.fragmentShader
        .replace(
          'void main() {',
          'uniform float uHeatVision;\nvoid main() {',
        )
        .replace(
          '#include <dithering_fragment>',
          [
            'float hvLum = dot(gl_FragColor.rgb, vec3(0.299, 0.587, 0.114));',
            'gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(hvLum) * vec3(0.25, 0.33, 0.45), uHeatVision);',
            '#include <dithering_fragment>',
          ].join('\n'),
        );
    };

    for (let cx = 0; cx < CHUNKS_X; cx++) {
      for (let cz = 0; cz < CHUNKS_Z; cz++) {
        const geometry = new THREE.BufferGeometry();
        const mesh = new THREE.Mesh(geometry, this.material);
        mesh.frustumCulled = true;
        scene.add(mesh);
        this.meshes.push(mesh);
        this.capacities.push(0);
      }
    }
  }

  /** Rebuild up to the per-frame budget of dirty chunks. */
  update(): void {
    let budget = RENDER.MAX_CHUNK_REBUILDS_PER_FRAME;
    for (const chunkId of this.grid.dirtyChunks) {
      if (budget-- <= 0) break;
      this.grid.dirtyChunks.delete(chunkId);
      this.rebuild(chunkId);
    }
  }

  rebuildAll(): void {
    for (let c = 0; c < this.meshes.length; c++) {
      this.grid.dirtyChunks.delete(c);
      this.rebuild(c);
    }
  }

  get dirtyCount(): number {
    return this.grid.dirtyChunks.size;
  }

  private rebuild(chunkId: number): void {
    const cx = Math.floor(chunkId / CHUNKS_Z);
    const cz = chunkId % CHUNKS_Z;
    const result = meshChunk(this.grid, cx, cz);
    const mesh = this.meshes[chunkId];
    const geometry = mesh.geometry;

    if (result.vertexCount > this.capacities[chunkId]) {
      // grow: next power-of-two-ish capacity, fresh attributes
      let cap = Math.max(1024, this.capacities[chunkId] * 2);
      while (cap < result.vertexCount) cap *= 2;
      this.capacities[chunkId] = cap;
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(cap * 3), 3));
      geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(cap * 3), 3));
      geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(cap * 3), 3));
    }
    const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
    const nor = geometry.getAttribute('normal') as THREE.BufferAttribute;
    const col = geometry.getAttribute('color') as THREE.BufferAttribute;
    (pos.array as Float32Array).set(result.positions.subarray(0, result.vertexCount * 3));
    (nor.array as Float32Array).set(result.normals.subarray(0, result.vertexCount * 3));
    (col.array as Float32Array).set(result.colors.subarray(0, result.vertexCount * 3));
    pos.needsUpdate = true;
    nor.needsUpdate = true;
    col.needsUpdate = true;
    geometry.setDrawRange(0, result.vertexCount);
    geometry.computeBoundingSphere();
  }

  get chunkMeshes(): THREE.Mesh[] {
    return this.meshes;
  }
}
