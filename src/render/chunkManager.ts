import * as THREE from 'three';
import { GRID, RENDER } from '../config';
import { VoxelGrid, CHUNKS_X, CHUNKS_Z } from '../world/voxelGrid';
import { meshChunk } from './chunkMesher';
import { heatVisionUniform, heatTextureUniform } from './heatVision';

/** Global ground-snow amount (0..1), driven by the weather system. */
export const snowUniform = { value: 0 };

/**
 * Owns one mesh per chunk. Drains the grid's dirty set with a per-frame budget;
 * persistent attribute buffers grow by power-of-two so steady-state rebuilds
 * reuse allocations and just re-upload.
 */
export class ChunkManager {
  private meshes: THREE.Mesh[] = [];
  private capacities: number[] = []; // vertex capacity per chunk
  readonly material: THREE.MeshPhongMaterial;

  constructor(
    private grid: VoxelGrid,
    scene: THREE.Scene,
  ) {
    // Phong so rain-wetness can drive a specular sheen (weather module mutates
    // specular/shininess directly); dry default is near-matte.
    this.material = new THREE.MeshPhongMaterial({ vertexColors: true, specular: 0x0a0a0a, shininess: 18 });
    this.material.onBeforeCompile = (shader) => {
      shader.uniforms.uHeatVision = heatVisionUniform;
      shader.uniforms.uHeatTex = heatTextureUniform;
      shader.uniforms.uSnow = snowUniform;
      // chunk meshes sit at the origin, so vertex positions ARE world coords
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          '#include <common>\nvarying vec3 vWorldPos;\nvarying float vTopness;',
        )
        .replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\nvWorldPos = position;\nvTopness = normal.y;',
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          [
            '#include <common>',
            'uniform float uHeatVision;',
            'uniform float uSnow;',
            'uniform sampler2D uHeatTex;',
            'varying vec3 vWorldPos;',
            'varying float vTopness;',
            'vec3 hvRamp(float t) {',
            '  vec3 a = vec3(0.05, 0.02, 0.18);',
            '  vec3 b = vec3(0.65, 0.12, 0.30);',
            '  vec3 c = vec3(0.98, 0.55, 0.08);',
            '  vec3 d = vec3(1.0, 0.98, 0.65);',
            '  if (t < 0.33) return mix(a, b, t / 0.33);',
            '  if (t < 0.66) return mix(b, c, (t - 0.33) / 0.33);',
            '  return mix(c, d, (t - 0.66) / 0.34);',
            '}',
          ].join('\n'),
        )
        .replace(
          '#include <color_fragment>',
          [
            '#include <color_fragment>',
            // snow settles on upward faces
            'diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.93, 0.95, 1.0), uSnow * smoothstep(0.55, 1.0, vTopness));',
          ].join('\n'),
        )
        .replace(
          '#include <dithering_fragment>',
          [
            // heat vision: mute the city to dark monochrome, then glow per-column heat onto it
            'if (uHeatVision > 0.001) {',
            `  vec2 hvUv = vec2(vWorldPos.x / ${GRID.W.toFixed(1)}, vWorldPos.z / ${GRID.D.toFixed(1)});`,
            '  float hvHeat = texture2D(uHeatTex, hvUv).r;',
            '  float hvLum = dot(gl_FragColor.rgb, vec3(0.299, 0.587, 0.114));',
            '  vec3 hvMuted = vec3(hvLum) * vec3(0.25, 0.33, 0.45);',
            '  hvMuted += hvRamp(min(1.0, hvHeat * 1.5)) * min(1.0, hvHeat * 2.2);',
            '  gl_FragColor.rgb = mix(gl_FragColor.rgb, hvMuted, uHeatVision);',
            '}',
            '#include <dithering_fragment>',
          ].join('\n'),
        );
    };

    for (let cx = 0; cx < CHUNKS_X; cx++) {
      for (let cz = 0; cz < CHUNKS_Z; cz++) {
        const geometry = new THREE.BufferGeometry();
        const mesh = new THREE.Mesh(geometry, this.material);
        mesh.frustumCulled = true;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
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
