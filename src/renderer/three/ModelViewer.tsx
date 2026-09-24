import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Center, Loader, Stack, Text } from '@mantine/core';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { disposeObject, loadModel, ThreeMFEmbeddedOnlyError } from './loaders';
import { frameObject, objectCenter } from './framing';
import { DEFAULT_LIGHTING_STYLE, LightingRig, type LightingStyle } from './lighting';
import { applyOrientation } from './orientation';
import type { CameraState, FileRecord } from '@shared/types';
import { isImageExtension } from '@shared/formats';
import {
  DEFAULT_RENDER_QUALITY,
  getRenderQualityPreset,
  type RenderQuality,
  type RenderQualityPreset
} from '@shared/render-quality';

// --- Image preview zoom tuning ---------------------------------------------
const IMAGE_ZOOM_MIN = 0.25;
const IMAGE_ZOOM_MAX = 8;
const IMAGE_WHEEL_SENSITIVITY = 0.0015;
const IMAGE_KEY_ZOOM_STEP = 1.15;
const IMAGE_KEY_PAN_STEP = 40;

function clampZoom(value: number): number {
  return Math.min(IMAGE_ZOOM_MAX, Math.max(IMAGE_ZOOM_MIN, value));
}

// --- 3D preview WASD tuning --------------------------------------------
const MODEL_KEY_ZOOM_STEP = 1.08;
const MODEL_KEY_ROTATE_STEP = THREE.MathUtils.degToRad(4);
const MODEL_KEY_PAN_STEP = 0.1;
const MODEL_MIN_DISTANCE = 0.1;
const MODEL_MAX_DISTANCE = 500;

interface Props {
  libraryId: string | null;
  file: FileRecord;
  lightingStyle?: LightingStyle;
  renderQuality?: RenderQuality;
}

function shadowFilterToThree(filter: 'basic' | 'pcf' | 'pcfsoft'): THREE.ShadowMapType {
  switch (filter) {
    case 'pcfsoft':
      return THREE.PCFSoftShadowMap;
    case 'pcf':
      return THREE.PCFShadowMap;
    case 'basic':
    default:
      return THREE.BasicShadowMap;
  }
}

function applyShadowFlags(root: THREE.Object3D, enabled: boolean): void {
  root.traverse((node) => {
    if ((node as THREE.Mesh).isMesh) {
      node.castShadow = enabled;
      node.receiveShadow = enabled;
    }
  });
}

function applyAnisotropy(root: THREE.Object3D, anisotropy: number, max: number): void {
  if (anisotropy <= 1) return;
  const target = Math.min(anisotropy, max);
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      if (!m) continue;
      for (const v of Object.values(m)) {
        if (v && (v as THREE.Texture).isTexture) {
          (v as THREE.Texture).anisotropy = target;
          (v as THREE.Texture).needsUpdate = true;
        }
      }
    }
  });
}

interface ViewerCtx {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  lighting: LightingRig;
  currentObject: THREE.Object3D | null;
  rafId: number | null;
  resizeObserver: ResizeObserver | null;
}

export interface ModelViewerHandle {
  hasModel(): boolean;
  captureCurrentFrame(): Promise<Uint8Array | null>;
  getCameraState(): CameraState | null;
  setCameraState(state: CameraState): void;
  onCameraChange(cb: () => void): () => void;
}

export const ModelViewer = forwardRef<ModelViewerHandle, Props>(function ModelViewer(
  {
    libraryId: _libraryId,
    file,
    lightingStyle = DEFAULT_LIGHTING_STYLE,
    renderQuality = DEFAULT_RENDER_QUALITY
  },
  ref
) {
  const qualityPreset: RenderQualityPreset = getRenderQualityPreset(renderQuality);
  const containerRef = useRef<HTMLDivElement>(null);
  const ctxRef = useRef<ViewerCtx | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [embeddedPngUrl, setEmbeddedPngUrl] = useState<string | null>(null);
  const [plainImageMode, setPlainImageMode] = useState(false);
  const [imageZoom, setImageZoom] = useState(1);
  const [imagePanX, setImagePanX] = useState(0);
  const [imagePanY, setImagePanY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const imageWrapRef = useRef<HTMLDivElement>(null);

  // Store original/default camera state for 3D reset
  const defaultCameraStateRef = useRef<CameraState | null>(null);

  const dragStateRef = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startPanX: number;
    startPanY: number;
  } | null>(null);

  const panRef = useRef({ x: imagePanX, y: imagePanY });
  useEffect(() => {
    panRef.current = { x: imagePanX, y: imagePanY };
  }, [imagePanX, imagePanY]);

  const cameraListenersRef = useRef<Set<() => void>>(new Set());
  const suppressChangeRef = useRef(false);

  // Reset view handler (Works for both Image mode & 3D model mode)
  const resetView = useCallback(() => {
    if (plainImageMode) {
      setImageZoom(1);
      setImagePanX(0);
      setImagePanY(0);
      return;
    }

    const ctx = ctxRef.current;
    if (ctx && defaultCameraStateRef.current) {
      const { position, target, zoom } = defaultCameraStateRef.current;
      ctx.camera.position.set(position[0], position[1], position[2]);
      ctx.controls.target.set(target[0], target[1], target[2]);
      ctx.camera.zoom = zoom;
      ctx.camera.updateProjectionMatrix();
      ctx.controls.update();
    }
  }, [plainImageMode]);

  useImperativeHandle(
    ref,
    () => ({
      hasModel() {
        return ctxRef.current?.currentObject != null;
      },
      async captureCurrentFrame() {
        const ctx = ctxRef.current;
        if (!ctx || !ctx.currentObject) return null;
        ctx.renderer.render(ctx.scene, ctx.camera);

        const src = ctx.renderer.domElement;
        const srcW = src.width;
        const srcH = src.height;
        const cropPx = Math.min(srcW, srcH);
        if (cropPx <= 0) return null;
        const offsetX = Math.floor((srcW - cropPx) / 2);
        const offsetY = Math.floor((srcH - cropPx) / 2);
        const outSize = Math.min(cropPx, 1024);

        const out = document.createElement('canvas');
        out.width = outSize;
        out.height = outSize;
        const ctx2d = out.getContext('2d');
        if (!ctx2d) return null;
        ctx2d.drawImage(src, offsetX, offsetY, cropPx, cropPx, 0, 0, outSize, outSize);

        const blob = await new Promise<Blob | null>((resolve) =>
          out.toBlob(resolve, 'image/png')
        );
        if (!blob) return null;
        return new Uint8Array(await blob.arrayBuffer());
      },
      getCameraState() {
        const ctx = ctxRef.current;
        if (!ctx) return null;
        return {
          position: [ctx.camera.position.x, ctx.camera.position.y, ctx.camera.position.z],
          target: [ctx.controls.target.x, ctx.controls.target.y, ctx.controls.target.z],
          zoom: ctx.camera.zoom
        };
      },
      setCameraState(state) {
        const ctx = ctxRef.current;
        if (!ctx) return;
        suppressChangeRef.current = true;
        ctx.camera.position.set(state.position[0], state.position[1], state.position[2]);
        ctx.controls.target.set(state.target[0], state.target[1], state.target[2]);
        ctx.camera.zoom = state.zoom;
        ctx.camera.updateProjectionMatrix();
        ctx.controls.update();
        queueMicrotask(() => {
          suppressChangeRef.current = false;
        });
      },
      onCameraChange(cb) {
        cameraListenersRef.current.add(cb);
        return () => {
          cameraListenersRef.current.delete(cb);
        };
      }
    }),
    []
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const { width, height } = container.getBoundingClientRect();
    const w = Math.max(width, 1);
    const h = Math.max(height, 1);

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true
    });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(w, h);
    renderer.setClearColor(0x101113, 1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = qualityPreset.shadows.enabled;
    renderer.shadowMap.type = shadowFilterToThree(qualityPreset.shadows.filter);
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const lighting = new LightingRig(scene, renderer);
    lighting.apply(lightingStyle, qualityPreset);

    const camera = new THREE.PerspectiveCamera(38, w / h, 0.1, 1000);
    camera.position.set(0, 0, 5);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.addEventListener('change', () => {
      if (suppressChangeRef.current) return;
      for (const cb of cameraListenersRef.current) cb();
    });

    const ctx: ViewerCtx = {
      renderer,
      scene,
      camera,
      controls,
      lighting,
      currentObject: null,
      rafId: null,
      resizeObserver: null
    };
    ctxRef.current = ctx;

    const tick = () => {
      controls.update();
      renderer.render(scene, camera);
      ctx.rafId = requestAnimationFrame(tick);
    };
    tick();

    const ro = new ResizeObserver(() => {
      const rect = container.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      renderer.setSize(rect.width, rect.height);
      camera.aspect = rect.width / rect.height;
      camera.updateProjectionMatrix();
    });
    ro.observe(container);
    ctx.resizeObserver = ro;

    return () => {
      if (ctx.rafId !== null) cancelAnimationFrame(ctx.rafId);
      ctx.resizeObserver?.disconnect();
      controls.dispose();
      if (ctx.currentObject) {
        scene.remove(ctx.currentObject);
        disposeObject(ctx.currentObject);
      }
      ctx.lighting.dispose();
      scene.clear();
      if (renderer.domElement.parentNode) {
        renderer.domElement.parentNode.removeChild(renderer.domElement);
      }
      renderer.dispose();
      ctxRef.current = null;
    };
  }, [renderQuality]);

  useEffect(() => {
    ctxRef.current?.lighting.apply(lightingStyle, qualityPreset);
  }, [lightingStyle, qualityPreset]);

  useEffect(() => {
    const ctx = ctxRef.current;
    if (!ctx?.currentObject) return;
    applyOrientation(ctx.currentObject, file.orientation);
    frameObject(ctx.camera, ctx.currentObject);
    ctx.controls.target.copy(objectCenter(ctx.currentObject));
    ctx.controls.update();
  }, [file.orientation.upAxis]);

  useEffect(() => {
    const ctx = ctxRef.current;
    if (!ctx?.currentObject) return;
    applyOrientation(ctx.currentObject, file.orientation);
    ctx.controls.target.copy(objectCenter(ctx.currentObject));
  }, [file.orientation.yaw]);

  useEffect(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;

    let canceled = false;
    const abort = new AbortController();
    setLoading(true);
    setError(null);
    setPlainImageMode(false);
    setImageZoom(1);
    setImagePanX(0);
    setImagePanY(0);
    defaultCameraStateRef.current = null;
    setEmbeddedPngUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });

    if (ctx.currentObject) {
      ctx.scene.remove(ctx.currentObject);
      disposeObject(ctx.currentObject);
      ctx.currentObject = null;
    }

    const load = async () => {
      try {
        const res = await fetch(`wh3d-file://${file.libraryId}/${file.id}`, {
          signal: abort.signal
        });
        if (!res.ok) throw new Error(`Failed to load model (${res.status})`);
        const buffer = await res.arrayBuffer();
        if (canceled) return;

        if (isImageExtension(file.ext)) {
          const mime =
            file.ext === 'png' ? 'image/png' :
            file.ext === 'jpg' || file.ext === 'jpeg' ? 'image/jpeg' :
            file.ext === 'bmp' ? 'image/bmp' :
            'application/octet-stream';
          const blob = new Blob([buffer], { type: mime });
          const url = URL.createObjectURL(blob);
          if (canceled) {
            URL.revokeObjectURL(url);
            return;
          }
          setPlainImageMode(true);
          setEmbeddedPngUrl(url);
          setLoading(false);
          return;
        }

        const obj = await loadModel(
          buffer,
          file.ext,
          (relativeUrl) => {
            const decoded = decodeURIComponent(relativeUrl);
            const relPath = file.parentDir ? `${file.parentDir}/${decoded}` : decoded;
            return `wh3d-file://${file.libraryId}/rel/${encodeURIComponent(relPath)}`;
          },
          file.orientation
        );
        if (canceled) {
          disposeObject(obj);
          return;
        }

        ctx.scene.add(obj);
        ctx.currentObject = obj;

        applyShadowFlags(obj, qualityPreset.shadows.enabled);
        applyAnisotropy(
          obj,
          qualityPreset.anisotropy,
          ctx.renderer.capabilities.getMaxAnisotropy()
        );

        const box = new THREE.Box3().setFromObject(obj);
        ctx.lighting.fitToModel(box);

        if (file.camera) {
          ctx.camera.position.set(
            file.camera.position[0],
            file.camera.position[1],
            file.camera.position[2]
          );
          ctx.controls.target.set(
            file.camera.target[0],
            file.camera.target[1],
            file.camera.target[2]
          );
          ctx.camera.zoom = file.camera.zoom;
          ctx.camera.updateProjectionMatrix();
          ctx.controls.update();
        } else {
          frameObject(ctx.camera, obj);
          ctx.controls.target.copy(objectCenter(obj));
          ctx.controls.update();
        }

        // Cache initial camera state for reset
        defaultCameraStateRef.current = {
          position: [ctx.camera.position.x, ctx.camera.position.y, ctx.camera.position.z],
          target: [ctx.controls.target.x, ctx.controls.target.y, ctx.controls.target.z],
          zoom: ctx.camera.zoom
        };

        setLoading(false);
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        if (err instanceof ThreeMFEmbeddedOnlyError && err.png) {
          const blob = new Blob([err.png as BlobPart], { type: 'image/png' });
          setEmbeddedPngUrl(URL.createObjectURL(blob));
          setLoading(false);
          return;
        }
        setError((err as Error).message ?? String(err));
        setLoading(false);
      }
    };

    void load();

    return () => {
      canceled = true;
      abort.abort();
    };
  }, [file.libraryId, file.id, file.ext, renderQuality]);

  useEffect(() => {
    return () => {
      if (embeddedPngUrl) URL.revokeObjectURL(embeddedPngUrl);
    };
  }, [embeddedPngUrl]);

  // Global 'R' key listener to reset view position
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return;

      if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        resetView();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [resetView]);

  useEffect(() => {
    const el = imageWrapRef.current;
    if (!el || !plainImageMode) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = Math.exp(-e.deltaY * IMAGE_WHEEL_SENSITIVITY);
      setImageZoom((z) => clampZoom(z * factor));
    };

    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [plainImageMode]);

  useEffect(() => {
    const el = imageWrapRef.current;
    if (!el || !plainImageMode) return;

    const handlePointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      dragStateRef.current = {
        pointerId: e.pointerId,
        startClientX: e.clientX,
        startClientY: e.clientY,
        startPanX: panRef.current.x,
        startPanY: panRef.current.y
      };
      setIsDragging(true);
    };

    const handlePointerMove = (e: PointerEvent) => {
      const drag = dragStateRef.current;
      if (!drag || drag.pointerId !== e.pointerId) return;
      const dx = e.clientX - drag.startClientX;
      const dy = e.clientY - drag.startClientY;
      setImagePanX(drag.startPanX + dx);
      setImagePanY(drag.startPanY + dy);
    };

    const endDrag = (e: PointerEvent) => {
      const drag = dragStateRef.current;
      if (!drag || drag.pointerId !== e.pointerId) return;
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
      dragStateRef.current = null;
      setIsDragging(false);
    };

    el.addEventListener('pointerdown', handlePointerDown);
    el.addEventListener('pointermove', handlePointerMove);
    el.addEventListener('pointerup', endDrag);
    el.addEventListener('pointercancel', endDrag);
    return () => {
      el.removeEventListener('pointerdown', handlePointerDown);
      el.removeEventListener('pointermove', handlePointerMove);
      el.removeEventListener('pointerup', endDrag);
      el.removeEventListener('pointercancel', endDrag);
    };
  }, [plainImageMode]);

  useEffect(() => {
    if (!plainImageMode) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return;

      const key = e.key.toLowerCase();

      if (key === 'w') {
        e.preventDefault();
        if (e.shiftKey) {
          setImagePanY((y) => y + IMAGE_KEY_PAN_STEP); // Pan up
        } else {
          setImageZoom((z) => clampZoom(z * IMAGE_KEY_ZOOM_STEP)); // Zoom in
        }
      } else if (key === 's') {
        e.preventDefault();
        if (e.shiftKey) {
          setImagePanY((y) => y - IMAGE_KEY_PAN_STEP); // Pan down
        } else {
          setImageZoom((z) => clampZoom(z / IMAGE_KEY_ZOOM_STEP)); // Zoom out
        }
      } else if (key === 'a') {
        e.preventDefault();
        setImagePanX((x) => x - IMAGE_KEY_PAN_STEP);
      } else if (key === 'd') {
        e.preventDefault();
        setImagePanX((x) => x + IMAGE_KEY_PAN_STEP);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [plainImageMode]);

  useEffect(() => {
    const show3D = !plainImageMode && !embeddedPngUrl;
    if (!show3D) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return;

      const ctx = ctxRef.current;
      if (!ctx) return;

      const key = e.key.toLowerCase();
      if (key === 'w' || key === 's') {
        e.preventDefault();

        if (e.shiftKey) {
          // Shift + W / S -> Move camera and target up / down locally
          const upVector = new THREE.Vector3(0, 1, 0).applyQuaternion(ctx.camera.quaternion);
          const distance = ctx.camera.position.distanceTo(ctx.controls.target);
          const panAmount = MODEL_KEY_PAN_STEP * Math.max(1, distance * 0.1);
          const shiftVector = upVector.multiplyScalar(key === 'w' ? panAmount : -panAmount);

          ctx.camera.position.add(shiftVector);
          ctx.controls.target.add(shiftVector);
          ctx.controls.update();
        } else {
          // W / S -> Zoom in / out (Dolly)
          const factor = key === 'w' ? 1 / MODEL_KEY_ZOOM_STEP : MODEL_KEY_ZOOM_STEP;
          const offset = ctx.camera.position.clone().sub(ctx.controls.target);
          const newDist = Math.min(
            MODEL_MAX_DISTANCE,
            Math.max(MODEL_MIN_DISTANCE, offset.length() * factor)
          );
          offset.setLength(newDist);
          ctx.camera.position.copy(ctx.controls.target).add(offset);
          ctx.controls.update();
        }
      } else if (key === 'a' || key === 'd') {
        e.preventDefault();
        const deltaTheta = key === 'a' ? MODEL_KEY_ROTATE_STEP : -MODEL_KEY_ROTATE_STEP;
        const offset = ctx.camera.position.clone().sub(ctx.controls.target);
        const spherical = new THREE.Spherical().setFromVector3(offset);
        spherical.theta += deltaTheta;
        offset.setFromSpherical(spherical);
        ctx.camera.position.copy(ctx.controls.target).add(offset);
        ctx.camera.lookAt(ctx.controls.target);
        ctx.controls.update();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [plainImageMode, embeddedPngUrl]);

  // Middle-mouse click handler to reset view
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button === 1) { // Middle click
      e.preventDefault();
      resetView();
    }
  };

  const handleAuxClick = (e: React.MouseEvent) => {
    if (e.button === 1) { // Prevent default middle click scroll icon
      e.preventDefault();
    }
  };

  return (
    <div
      ref={containerRef}
      onMouseDown={handleMouseDown}
      onAuxClick={handleAuxClick}
      style={{
        position: 'absolute',
        inset: 0,
        background: '#101113',
        overflow: 'hidden'
      }}
    >
      {embeddedPngUrl && (
        <div
          ref={imageWrapRef}
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#101113',
            overflow: 'hidden',
            cursor: plainImageMode ? (isDragging ? 'grabbing' : 'grab') : undefined,
            touchAction: plainImageMode ? 'none' : undefined
          }}
        >
          <img
            src={embeddedPngUrl}
            alt={plainImageMode ? file.filename : 'Embedded slicer preview'}
            style={{
              maxWidth: '100%',
              maxHeight: '100%',
              objectFit: 'contain',
              transform: plainImageMode
                ? `translate(${imagePanX}px, ${imagePanY}px) scale(${imageZoom})`
                : undefined,
              transformOrigin: 'center center',
              userSelect: 'none',
              pointerEvents: 'none'
            }}
          />
          {plainImageMode && imageZoom !== 1 && (
            <Text
              size="xs"
              c="dimmed"
              style={{
                position: 'absolute',
                right: 8,
                bottom: 6,
                background: 'rgba(0,0,0,0.45)',
                padding: '2px 6px',
                borderRadius: 3
              }}
            >
              {Math.round(imageZoom * 100)}%
            </Text>
          )}
          {!plainImageMode && (
            <Text
              size="xs"
              c="dimmed"
              style={{
                position: 'absolute',
                left: 8,
                bottom: 6,
                background: 'rgba(0,0,0,0.45)',
                padding: '2px 6px',
                borderRadius: 3
              }}
            >
              Slicer preview (live 3D unavailable for this multi-part 3MF)
            </Text>
          )}
        </div>
      )}
      {loading && (
        <Center style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
          <Loader size="sm" />
        </Center>
      )}
      {error && (
        <Center style={{ position: 'absolute', inset: 0, padding: 8 }}>
          <Stack gap={2} align="center">
            <Text size="xs" c="red">
              Preview failed
            </Text>
            <Text size="xs" c="dimmed" ta="center" style={{ wordBreak: 'break-word' }}>
              {error}
            </Text>
          </Stack>
        </Center>
      )}
    </div>
  );
});