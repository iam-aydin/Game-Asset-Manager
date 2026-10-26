import * as THREE from 'three';

/**
 * Support for the old KHR_materials_pbrSpecularGlossiness glTF extension.
 * Newer three.js versions dropped it, so models that use it came out plain white.
 *
 * This converts it to a standard material: diffuse color / diffuse texture become
 * the base color, and roughness = 1 - glossiness. (The combined specular+glossiness
 * texture is not used, so highlights are an approximation.)
 */
const NAME = 'KHR_materials_pbrSpecularGlossiness';

/* eslint-disable @typescript-eslint/no-explicit-any */
class SpecGlossPlugin {
  name = NAME;
  private parser: any;

  constructor(parser: any) {
    this.parser = parser;
  }

  private ext(materialIndex: number): any {
    const def = this.parser.json?.materials?.[materialIndex];
    return def?.extensions?.[NAME] ?? null;
  }

  getMaterialType(materialIndex: number): any {
    return this.ext(materialIndex) ? THREE.MeshStandardMaterial : null;
  }

  extendMaterialParams(materialIndex: number, materialParams: any): Promise<unknown> {
    const ext = this.ext(materialIndex);
    if (!ext) return Promise.resolve();

    const diffuse: number[] = ext.diffuseFactor ?? [1, 1, 1, 1];
    materialParams.color = new THREE.Color(diffuse[0], diffuse[1], diffuse[2]);
    materialParams.opacity = diffuse[3] ?? 1;
    materialParams.metalness = 0;
    materialParams.roughness = 1 - (ext.glossinessFactor ?? 1);

    const pending: Promise<unknown>[] = [];
    if (ext.diffuseTexture) {
      pending.push(
        this.parser.assignTexture(materialParams, 'map', ext.diffuseTexture, THREE.SRGBColorSpace)
      );
    }
    return Promise.all(pending);
  }
}

/** Call once on every GLTFLoader you create. */
export function registerSpecGloss(loader: any): void {
  loader.register((parser: any) => new SpecGlossPlugin(parser));
}