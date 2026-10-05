import * as THREE from 'three';
import type { LightingStyle } from '@shared/lighting-types';

/**
 * Viewport material modes (Unreal-style). The light rig is handled by
 * LightingRig; this file only deals with swapping a loaded model's materials:
 *
 *   lit        original materials (nothing is swapped)
 *   unlit      MeshBasicMaterial that keeps color / map / alpha / vertex colors
 *   wireframe  edges only, one shared material
 *   normals    world-space normals as colors, one shared material
 *
 * Original materials are stashed on `mesh.userData` and put back by
 * `releaseViewMode`. Textures are shared with the originals, so disposing the
 * generated materials never frees a texture the original still needs.
 *
 * Call `releaseViewMode(root)` BEFORE `disposeObject(root)` so the original
 * materials (not the temporary ones) are what get disposed with the model.
 */

const ORIGINAL_KEY = '__wh3dOriginalMaterial';
const GENERATED_KEY = '__wh3dViewGenerated';

// Mid blue-grey: readable on both the dark and the light viewport background.
const WIREFRAME_COLOR = 0x7f93b8;

type SourceMaterial = THREE.Material & {
  color?: THREE.Color;
  map?: THREE.Texture | null;
  alphaMap?: THREE.Texture | null;
  vertexColors?: boolean;
};

function makeUnlit(src: THREE.Material): THREE.Material {
  const s = src as SourceMaterial;
  return new THREE.MeshBasicMaterial({
    color: s.color ? s.color.clone() : new THREE.Color(0xffffff),
    map: s.map ?? null,
    alphaMap: s.alphaMap ?? null,
    vertexColors: s.vertexColors ?? false,
    transparent: s.transparent,
    opacity: s.opacity,
    alphaTest: s.alphaTest,
    side: s.side,
    depthWrite: s.depthWrite,
    // Show the exact texture colors, not ACES-tinted ones.
    toneMapped: false
  });
}

function makeWireframe(): THREE.Material {
  return new THREE.MeshBasicMaterial({
    color: WIREFRAME_COLOR,
    wireframe: true,
    side: THREE.DoubleSide,
    toneMapped: false
  });
}

/**
 * MeshNormalMaterial reports normals in camera space, so the colors would
 * shift as you orbit. The patch below converts them to world space (colors
 * stay fixed per direction, like the old axis-colored Normals look). If a
 * future three.js version changes that shader line, the replace is a no-op and
 * you simply get camera-space normals instead of a broken shader.
 */
function makeNormals(): THREE.Material {
  const mat = new THREE.MeshNormalMaterial({
    side: THREE.DoubleSide,
    toneMapped: false
  });
  mat.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      'packNormalToRGB( normal )',
      'packNormalToRGB( normalize( ( vec4( normal, 0.0 ) * viewMatrix ).xyz ) )'
    );
  };
  mat.customProgramCacheKey = () => 'wh3d-world-normals';
  return mat;
}

/** Put the original materials back and dispose the temporary ones. */
export function releaseViewMode(root: THREE.Object3D): void {
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    const original = mesh.userData[ORIGINAL_KEY] as THREE.Material | THREE.Material[] | undefined;
    if (original !== undefined) {
      mesh.material = original;
      delete mesh.userData[ORIGINAL_KEY];
    }
  });
  const generated = root.userData[GENERATED_KEY] as THREE.Material[] | undefined;
  if (generated) {
    for (const m of generated) m.dispose();
    delete root.userData[GENERATED_KEY];
  }
}

/** Switch a loaded model to the given mode. Safe to call repeatedly. */
export function applyViewMode(root: THREE.Object3D, mode: LightingStyle): void {
  releaseViewMode(root);
  if (mode === 'lit') return;

  const generated: THREE.Material[] = [];
  const unlitCache = new Map<THREE.Material, THREE.Material>();
  let shared: THREE.Material | null = null;

  const materialFor = (src: THREE.Material): THREE.Material => {
    if (mode === 'unlit') {
      let m = unlitCache.get(src);
      if (!m) {
        m = makeUnlit(src);
        unlitCache.set(src, m);
        generated.push(m);
      }
      return m;
    }
    if (!shared) {
      shared = mode === 'wireframe' ? makeWireframe() : makeNormals();
      generated.push(shared);
    }
    return shared;
  };

  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    const original = mesh.material;
    mesh.userData[ORIGINAL_KEY] = original;
    mesh.material = Array.isArray(original) ? original.map(materialFor) : materialFor(original);
  });

  root.userData[GENERATED_KEY] = generated;
}