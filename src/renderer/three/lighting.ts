import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import type { LightingStyle } from '@shared/lighting-types';
import {
  DEFAULT_RENDER_QUALITY,
  getRenderQualityPreset,
  type RenderQuality,
  type RenderQualityPreset
} from '@shared/render-quality';
import { getLightingPreset, type LightingPresetDefinition } from './lighting-presets';

export { DEFAULT_LIGHTING_STYLE, type LightingStyle } from '@shared/lighting-types';
export { LIGHTING_PRESETS, type LightingPresetDefinition } from './lighting-presets';

/**
 * Widest HDRI kept on the GPU. three.js sizes its background cube and its
 * lighting map from the HDRI's height, so VRAM grows with the SQUARE of the
 * resolution. The full-size file stays in the loader cache (CPU) so switching
 * stays fast. 2048 is plenty for lighting and a blurred sky; raise to 4096 if
 * you want a sharper sky (about 4x more VRAM).
 */
const HDRI_MAX_WIDTH = 4096;
const ENV_MAX_WIDTH = 512; // lighting map: blurry anyway, tiny is fine

/**
 * An HDRI the rig should use. The texture is owned by the caller (see
 * hdri-loader.ts) and is never disposed here. Deliberately NOT imported from
 * hdri-presets.ts so the thumbnail worker, which also uses this file, doesn't
 * pull the HDRI assets into its bundle.
 */
export interface HdriSetup {
  /** Equirectangular texture (mapping = EquirectangularReflectionMapping). */
  texture: THREE.Texture;
  environmentIntensity: number;
  backgroundIntensity: number;
  backgroundBlurriness: number;
  exposure: number;
  /** Multiplier on the preset's own lights while the HDRI lights the model. */
  lightScale: number;
}

/**
 * Generic applier of LightingPresetDefinitions. Knows nothing about specific
 * presets; tweaks happen in `lighting-presets.ts` as pure data.
 *
 * Lights live under a single Group so swapping presets is a clear/re-add of
 * one subtree; the PMREM-generated env map is owned here too so it gets
 * disposed alongside.
 *
 * HDRI: when an HDRI is set (`setHdri`), it is shown as the background in every
 * view mode, but it only LIGHTS the model in Lit mode (it replaces the built-in
 * RoomEnvironment and dims the preset's lights by `lightScale`). Unlit,
 * Wireframe and Normals use materials that ignore lights anyway.
 *
 * Quality-tier-aware: when the active `RenderQualityPreset` enables shadows,
 * the FIRST directional in the lighting preset becomes the shadow caster.
 * `fitToModel(box)` must be called after loading a model so the shadow
 * camera + light distance match the model's actual scale. The last box is
 * remembered and re-applied whenever the lights are rebuilt.
 */
export class LightingRig {
  private group = new THREE.Group();
  private envMap: THREE.Texture | null = null;
  private envRT: THREE.WebGLRenderTarget | null = null;
  private currentStyle: LightingStyle | null = null;
  private currentQualityId: RenderQuality | null = null;
  private readonly pmrem: THREE.PMREMGenerator;
  /** Set by applyDefinition; consumed by fitToModel to scale shadow camera. */
  private shadowKey: THREE.DirectionalLight | null = null;
  private quality: RenderQualityPreset = getRenderQualityPreset(DEFAULT_RENDER_QUALITY);
  private hdri: HdriSetup | null = null;
  private lastBox: THREE.Box3 | null = null;
  /** GPU-sized copies of big HDRIs, keyed by the full-size source texture. */
  private small = new Map<string, THREE.WebGLRenderTarget>();
  private envTex: THREE.Texture | null = null;
  private srcTex: THREE.Texture | null = null;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly renderer: THREE.WebGLRenderer
  ) {
    this.group.name = 'wh3d-lighting';
    scene.add(this.group);
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.pmrem.compileEquirectangularShader();
    // ACES Filmic globally; preset intensities below are tuned against it.
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
  }

  apply(style: LightingStyle, quality?: RenderQualityPreset): void {
    const nextQuality = quality ?? this.quality;
    if (this.currentStyle === style && this.currentQualityId === nextQuality.id) return;
    this.currentStyle = style;
    this.currentQualityId = nextQuality.id;
    this.quality = nextQuality;
    this.applyDefinition(getLightingPreset(style));
  }

  /**
   * Set (or clear with null) the HDRI. Takes effect immediately if a style has
   * already been applied; otherwise it is picked up by the first `apply`.
   * Big HDRIs are shrunk on the GPU first; the previous HDRI's GPU memory is freed.
   */
  setHdri(hdri: HdriSetup | null): void {
    const prevSrc = this.srcTex;
    this.srcTex = hdri ? hdri.texture : null;
    this.envTex = hdri ? this.shrink(hdri.texture, ENV_MAX_WIDTH) : null;
    this.hdri = hdri ? { ...hdri, texture: this.shrink(hdri.texture, HDRI_MAX_WIDTH) } : null;
    if (this.currentStyle) this.applyDefinition(getLightingPreset(this.currentStyle));
    this.releaseUnusedSmall();
    // free the previous HDRI's GPU copies (decoded pixels stay cached in RAM)
    if (prevSrc && prevSrc !== this.srcTex) prevSrc.dispose();
  }

  /**
   * Copies a big equirect HDRI into a HDRI_MAX_WIDTH render target on the GPU
   * (mip-filtered so a small bright sun doesn't vanish), then frees the
   * full-size GPU upload. The CPU data stays in the loader cache.
   */
  private shrink(src: THREE.Texture, maxW: number): THREE.Texture {
    const img = src.image as { width?: number; height?: number } | undefined;
    const sw = img?.width ?? 0;
    const sh = img?.height ?? 0;
    if (sw <= maxW || sh <= 0) return src;
    const key = src.uuid + ':' + maxW;
    const cached = this.small.get(key);
    if (cached) return cached.texture;

    const w = maxW;
    const h = Math.max(1, Math.round((w * sh) / sw));
    const rt = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      generateMipmaps: false,
      depthBuffer: false
    });
    rt.texture.mapping = THREE.EquirectangularReflectionMapping;
    rt.texture.colorSpace = THREE.LinearSRGBColorSpace;

    const prevGen = src.generateMipmaps;
    const prevMin = src.minFilter;
    if (this.renderer.extensions.has('EXT_color_buffer_float')) {
      src.generateMipmaps = true;
      src.minFilter = THREE.LinearMipmapLinearFilter;
    }
    src.needsUpdate = true;

    const mat = new THREE.MeshBasicMaterial({
      map: src,
      toneMapped: false,
      depthTest: false,
      depthWrite: false
    });
    const quad = new FullScreenQuad(mat);
    const prevTarget = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(rt);
    quad.render(this.renderer);
    this.renderer.setRenderTarget(prevTarget);
    quad.dispose();
    mat.dispose();

    src.generateMipmaps = prevGen;
    src.minFilter = prevMin;
    src.dispose(); // frees the full-size GPU copy; CPU pixels stay for the next use

    this.small.set(key, rt);
    return rt.texture;
  }

  private releaseUnusedSmall(): void {
    const keepA = this.hdri?.texture;
    for (const [key, rt] of this.small) {
      if (rt.texture === keepA || rt.texture === this.envTex) continue;
      rt.texture.dispose(); // also drops three's cached cube / PMREM copies of it
      rt.dispose();
      this.small.delete(key);
    }
  }

  /**
   * Apply a definition directly. Useful for live-tweaking presets in dev or
   * for tests that don't want to register a new ID just to try a variant.
   */
  applyDefinition(def: LightingPresetDefinition): void {
    this.clear();

    const hdri = this.hdri;
    // The HDRI only lights the model in Lit mode.
    const hdriLights = hdri !== null && def.id === 'lit';
    const lightScale = hdriLights ? hdri.lightScale : 1;

    this.renderer.toneMappingExposure = hdri ? hdri.exposure : def.exposure;

    if (hdri) {
      // Sky behind the model, in every view mode.
      this.scene.background = hdri.texture;
      this.scene.backgroundIntensity = hdri.backgroundIntensity;
      this.scene.backgroundBlurriness = hdri.backgroundBlurriness;
    } else {
      this.scene.background = null;
    }

    if (hdriLights) {
      this.scene.environment = this.envTex ?? hdri.texture;
      this.scene.environmentIntensity = hdri.environmentIntensity;
    } else if (!hdri && def.environmentIntensity > 0) {
      const room = new RoomEnvironment();
      this.envRT = this.pmrem.fromScene(room, this.quality.envMapRoughness);
      this.envMap = this.envRT.texture;
      // The room's geometry/materials were uploaded to the GPU; free them.
      (room as unknown as { dispose?: () => void }).dispose?.();
      this.scene.environment = this.envMap;
      this.scene.environmentIntensity = def.environmentIntensity;
    }

    if (def.ambient) {
      this.group.add(
        new THREE.AmbientLight(def.ambient.color, def.ambient.intensity * lightScale)
      );
    }
    if (def.hemisphere) {
      this.group.add(
        new THREE.HemisphereLight(
          def.hemisphere.skyColor,
          def.hemisphere.groundColor,
          def.hemisphere.intensity * lightScale
        )
      );
    }
    if (def.directionals) {
      def.directionals.forEach((d, i) => {
        const light = new THREE.DirectionalLight(d.color, d.intensity * lightScale);
        light.position.set(d.position[0], d.position[1], d.position[2]);
        // First directional becomes the shadow caster when quality permits.
        if (i === 0 && this.quality.shadows.enabled) {
          light.castShadow = true;
          light.shadow.mapSize.set(this.quality.shadows.mapSize, this.quality.shadows.mapSize);
          // Defaults, overwritten in fitToModel once we know the model size.
          light.shadow.camera.near = 0.1;
          light.shadow.camera.far = 50;
          light.shadow.bias = -0.0005;
          light.shadow.normalBias = 0.02;
          // Target must be in the scene graph for OrbitControls-driven moves
          // to take effect; we re-aim it at the model in fitToModel.
          this.scene.add(light.target);
          this.shadowKey = light;
        }
        this.group.add(light);
      });
    }

    // The lights were just rebuilt: re-fit the shadow caster to the model.
    if (this.lastBox) this.fitToModel(this.lastBox);
  }

  /**
   * Re-anchor the shadow caster to the model's bounding sphere so shadows
   * render correctly regardless of model scale.
   *   - Light direction is preserved (visual character of the preset stays).
   *   - Light distance is set proportional to model radius so the light sits
   *     outside the model.
   *   - Shadow ortho camera is sized to enclose the model with padding.
   *   - Target moves to the model center so directional lighting hits
   *     correctly even for off-origin models.
   */
  fitToModel(box: THREE.Box3): void {
    if (box.isEmpty()) return;
    this.lastBox = box.clone();
    if (!this.shadowKey) return;
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    if (sphere.radius === 0) return;

    const light = this.shadowKey;
    // Keep the preset's directional angle; only adjust magnitude + offset.
    const dir = light.position.clone().normalize();
    if (dir.lengthSq() === 0) dir.set(0, 1, 0);
    const distance = sphere.radius * 3;
    light.position.copy(sphere.center).addScaledVector(dir, distance);
    light.target.position.copy(sphere.center);
    light.target.updateMatrixWorld();

    const cam = light.shadow.camera as THREE.OrthographicCamera;
    const r = sphere.radius * 1.25;
    cam.left = -r;
    cam.right = r;
    cam.top = r;
    cam.bottom = -r;
    cam.near = Math.max(0.01, distance - sphere.radius * 2);
    cam.far = distance + sphere.radius * 3;
    cam.updateProjectionMatrix();

    // Bias scales with model size to avoid acne on tiny models / over-darkening on huge ones.
    light.shadow.bias = -0.0005 * Math.max(1, sphere.radius);
    light.shadow.normalBias = 0.02 * Math.max(1, sphere.radius);
    light.shadow.needsUpdate = true;
  }

  /** Free GPU resources owned by the rig. Idempotent. */
  dispose(): void {
    this.clear();
    for (const rt of this.small.values()) {
      rt.texture.dispose();
      rt.dispose();
    }
    this.small.clear();
    this.srcTex?.dispose();
    this.scene.remove(this.group);
    this.pmrem.dispose();
  }

  private clear(): void {
    while (this.group.children.length > 0) {
      this.group.remove(this.group.children[0]);
    }
    // Only the RoomEnvironment map is ours; HDRI textures belong to the cache / small map.
    if (this.envMap) {
      this.envMap.dispose();
      this.envMap = null;
    }
    if (this.envRT) {
      this.envRT.dispose();
      this.envRT = null;
    }
    if (this.shadowKey) {
      this.scene.remove(this.shadowKey.target);
      this.shadowKey = null;
    }
    this.scene.environment = null;
    this.scene.environmentIntensity = 1.0;
    this.scene.background = null;
    this.scene.backgroundIntensity = 1.0;
    this.scene.backgroundBlurriness = 0;
  }
}