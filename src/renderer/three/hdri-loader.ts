import * as THREE from 'three';
// If your three version has no HDRLoader, use RGBELoader from
// 'three/examples/jsm/loaders/RGBELoader.js' instead; the API is identical.
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import type { HdriId } from '@shared/hdri';

/**
 * Loads each .hdr once and keeps it for the lifetime of the app, so switching
 * between Day / Sunset / Night is instant after the first load.
 *
 * The texture is equirectangular. three.js uses it directly as the scene
 * background and converts it to a prefiltered environment map by itself when
 * it is set as `scene.environment`, so no PMREMGenerator is needed here.
 *
 * The cache owns the textures; the lighting rig never disposes them.
 */
const cache = new Map<HdriId, Promise<THREE.Texture>>();

export function loadHdri(id: HdriId, url: string): Promise<THREE.Texture> {
  let pending = cache.get(id);
  if (!pending) {
    pending = new HDRLoader().loadAsync(url).then((texture) => {
      texture.mapping = THREE.EquirectangularReflectionMapping;
      // Handy to confirm which file really loaded (DevTools console, Ctrl+Shift+I).
      const img = texture.image as { width: number; height: number };
      console.info(`[hdri] ${id} loaded ${img.width}x${img.height} from ${url}`);
      return texture as THREE.Texture;
    });
    // A failed load must not poison the cache; allow a retry next time.
    pending.catch(() => cache.delete(id));
    cache.set(id, pending);
  }
  return pending;
}