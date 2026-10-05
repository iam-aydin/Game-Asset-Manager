import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { ActionIcon, Button, Group, Center, Loader, Stack, Text } from '@mantine/core';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { disposeObject, loadModel, ThreeMFEmbeddedOnlyError } from './loaders';
import { frameObject, objectCenter, objectRadius } from './framing';
import { DEFAULT_LIGHTING_STYLE, LightingRig, type LightingStyle } from './lighting';
import { applyViewMode, releaseViewMode } from './view-modes'; // VIEW MODE (1/4): new import
import { applyOrientation } from './orientation';
import { DEFAULT_HDRI, type HdriId } from '@shared/hdri'; // HDRI (1/3)
import { getHdriPreset } from './hdri-presets';
import { loadHdri } from './hdri-loader';
import { createViewerGrid, type ViewerGrid } from './grid'; // GRID (1/4)
import { AxisGizmo } from './axis-gizmo'; // GIZMO (1/3)
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

function readViewportBgColor(): THREE.Color {
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue('--wh3d-viewport-bg')
    .trim();
  return new THREE.Color(raw || '#101113');
}

function clampZoom(value: number): number {
  return Math.min(IMAGE_ZOOM_MAX, Math.max(IMAGE_ZOOM_MIN, value));
}

// --- 3D preview WASD tuning --------------------------------------------
const MODEL_KEY_ZOOM_STEP = 1.08;
const MODEL_KEY_ROTATE_STEP = THREE.MathUtils.degToRad(4);
const MODEL_KEY_PAN_STEP = 0.1;
// Zoom limits are multiples of the model's bounding radius, NOT absolute
// distances. Absolute limits (the old 0.1 / 500) teleported the camera on any
// model whose scale didn't happen to fit them — e.g. a mansion with radius
// ~1000 got clamped from 3500 straight down to 500, i.e. inside the mesh.
const MODEL_MIN_DISTANCE_FACTOR = 0.02;
const MODEL_MAX_DISTANCE_FACTOR = 50;
// How close (as a fraction of radius) keyboard zoom-in may get to a surface
// before it stops instead of tunnelling through it.
const MODEL_SURFACE_MARGIN_FACTOR = 0.01;
// How long the camera swing takes after clicking an axis on the gizmo.
const GIZMO_SNAP_MS = 280;

interface Props {
  libraryId: string | null;
  file: FileRecord;
  lightingStyle?: LightingStyle;
  hdri?: HdriId;
  showGrid?: boolean;
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
    hdri = DEFAULT_HDRI,
    showGrid = false,
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

  // VIEW MODE (2/4): always-current mode for the async model loader, so a model
  // that finishes loading after the user switched modes still gets the right one.
  const viewModeRef = useRef<LightingStyle>(lightingStyle);
  viewModeRef.current = lightingStyle;

  // GRID (2/4): reference grid at the world origin. The ref mirrors the prop so
  // the async model loader sees the current value.
  const showGridRef = useRef(showGrid);
  showGridRef.current = showGrid;
  const gridRef = useRef<ViewerGrid | null>(null);
  const [gridStep, setGridStep] = useState<number | null>(null);

  // Removes the old grid and, if the grid is on and a model is loaded, builds a
  // new one sized to that model. Cheap; call whenever either input changes.
  const syncGrid = () => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    if (gridRef.current) {
      ctx.scene.remove(gridRef.current.group);
      gridRef.current.dispose();
      gridRef.current = null;
    }
    if (!showGridRef.current || !ctx.currentObject) {
      setGridStep(null);
      return;
    }
    const grid = createViewerGrid(modelRadiusRef.current);
    ctx.scene.add(grid.group);
    gridRef.current = grid;
    setGridStep(grid.step);
  };

  // Store original/default camera state for 3D reset
  const defaultCameraStateRef = useRef<CameraState | null>(null);

  // Bounding radius of the currently loaded model — drives the zoom limits.
  const modelRadiusRef = useRef(1);
  // Reused for keyboard zoom-in surface checks (avoids allocating per keypress).
  const zoomRaycasterRef = useRef(new THREE.Raycaster());

  // Recomputes the model radius and pushes size-relative min/max distances
  // into OrbitControls, so mouse-wheel zoom respects the same limits.
  const applyDistanceLimits = (ctx: ViewerCtx, obj: THREE.Object3D) => {
    const r = objectRadius(obj);
    modelRadiusRef.current = r;
    ctx.controls.minDistance = r * MODEL_MIN_DISTANCE_FACTOR;
    ctx.controls.maxDistance = r * MODEL_MAX_DISTANCE_FACTOR;
  };

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
        // GRID (3/4): never bake the grid into a thumbnail. The drawing buffer
        // is preserved, so it is safe to show the grid again right after.
        const grid = gridRef.current;
        if (grid) grid.group.visible = false;
        ctx.renderer.render(ctx.scene, ctx.camera);
        if (grid) grid.group.visible = true;

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
    renderer.setClearColor(readViewportBgColor(), 1);
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

    // GIZMO (2/3): XYZ indicator in the bottom-right corner, only while a model is shown.
    const gizmo = new AxisGizmo();

    // GIZMO click: smoothly swing the camera to look along the clicked axis,
    // keeping the current target and distance.
    let snapRaf: number | null = null;
    const cancelSnap = () => {
      if (snapRaf !== null) {
        cancelAnimationFrame(snapRaf);
        snapRaf = null;
      }
    };
    const snapToDirection = (dir: THREE.Vector3) => {
      cancelSnap();
      const target = controls.target.clone();
      const offset = camera.position.clone().sub(target);
      const dist = offset.length();
      if (dist === 0) return;

      // Animate in spherical coordinates (azimuth + polar angle) instead of
      // slerping the direction. At the poles (top / bottom view) the azimuth
      // is undefined, so a straight slerp ends with a sudden 90-degree flip
      // of the picture when the last frame snaps the azimuth to 0. Here the
      // azimuth turns smoothly to its final value, and top / bottom views
      // always end in the same canonical orientation.
      const from = new THREE.Spherical().setFromVector3(offset);
      const to = new THREE.Spherical().setFromVector3(dir.clone().normalize());
      const POLE_EPS = 1e-4;
      to.phi = Math.min(Math.PI - POLE_EPS, Math.max(POLE_EPS, to.phi));
      // Shortest way around for the azimuth.
      let dTheta = to.theta - from.theta;
      dTheta = THREE.MathUtils.euclideanModulo(dTheta + Math.PI, Math.PI * 2) - Math.PI;
      const dPhi = to.phi - from.phi;

      const cur = new THREE.Spherical(dist, from.phi, from.theta);
      const t0 = performance.now();
      const step = (now: number) => {
        const t = Math.min(1, (now - t0) / GIZMO_SNAP_MS);
        const eased = 1 - Math.pow(1 - t, 3);
        cur.phi = from.phi + dPhi * eased;
        cur.theta = from.theta + dTheta * eased;
        camera.position.copy(target).add(offset.setFromSpherical(cur));
        controls.update();
        snapRaf = t < 1 ? requestAnimationFrame(step) : null;
      };
      snapRaf = requestAnimationFrame(step);
    };
    // The user grabbing the view always wins over a running swing.
    controls.addEventListener('start', cancelSnap);

    const canvasEl = renderer.domElement;
    let downX = 0;
    let downY = 0;
    const localPoint = (e: MouseEvent) => {
      const r = canvasEl.getBoundingClientRect();
      return { x: e.clientX - r.left, y: r.height - (e.clientY - r.top) };
    };
    const onGizmoPointerDown = (e: PointerEvent) => {
      downX = e.clientX;
      downY = e.clientY;
    };
    const onGizmoClick = (e: MouseEvent) => {
      if (e.button !== 0 || !ctx.currentObject) return;
      if (Math.hypot(e.clientX - downX, e.clientY - downY) > 4) return; // it was a drag
      const p = localPoint(e);
      const hit = gizmo.hitTest(p.x, p.y);
      if (hit) snapToDirection(hit.dir);
    };
    const onGizmoPointerMove = (e: PointerEvent) => {
      if (e.buttons !== 0) return; // dragging the view
      const p = localPoint(e);
      const hit = ctx.currentObject ? gizmo.hitTest(p.x, p.y) : null;
      gizmo.setHover(hit ? hit.key : null);
      canvasEl.style.cursor = hit ? 'pointer' : '';
    };
    const onGizmoPointerLeave = () => {
      gizmo.setHover(null);
      canvasEl.style.cursor = '';
    };
    canvasEl.addEventListener('pointerdown', onGizmoPointerDown);
    canvasEl.addEventListener('click', onGizmoClick);
    canvasEl.addEventListener('pointermove', onGizmoPointerMove);
    canvasEl.addEventListener('pointerleave', onGizmoPointerLeave);

    const tick = () => {
      controls.update();
      renderer.render(scene, camera);
      if (ctx.currentObject) gizmo.render(renderer, camera);
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
      cancelSnap();
      controls.removeEventListener('start', cancelSnap);
      canvasEl.removeEventListener('pointerdown', onGizmoPointerDown);
      canvasEl.removeEventListener('click', onGizmoClick);
      canvasEl.removeEventListener('pointermove', onGizmoPointerMove);
      canvasEl.removeEventListener('pointerleave', onGizmoPointerLeave);
      gizmo.dispose(); // GIZMO (3/3)
      if (ctx.currentObject) {
        scene.remove(ctx.currentObject);
        releaseViewMode(ctx.currentObject); // VIEW MODE (3/4): restore originals before disposing
        disposeObject(ctx.currentObject);
      }
      if (gridRef.current) {
        gridRef.current.dispose();
        gridRef.current = null;
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

  // Live theme switching: WebGL can't read CSS variables, so re-read the
  // viewport background whenever App.tsx announces a theme change.
  useEffect(() => {
    const applyBg = () => {
      ctxRef.current?.renderer.setClearColor(readViewportBgColor(), 1);
    };
    window.addEventListener('wh3d:themechange', applyBg);
    return () => window.removeEventListener('wh3d:themechange', applyBg);
  }, []);

  // VIEW MODE (4/4): switching modes updates the lights AND swaps the model's materials.
  useEffect(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    ctx.lighting.apply(lightingStyle, qualityPreset);
    if (ctx.currentObject) applyViewMode(ctx.currentObject, lightingStyle);
  }, [lightingStyle, qualityPreset]);

  // GRID (4/4): toggle on/off. `renderQuality` rebuilds the renderer, which
  // drops the grid with the old scene (the model reloads and re-syncs it).
  useEffect(() => {
    syncGrid();
  }, [showGrid, renderQuality]);

  // HDRI (2/3): background + image-based lighting. The rig keeps the setup, so
  // later view-mode changes re-apply it (lights the model in Lit only, the
  // background shows in every mode). `renderQuality` is a dep because that
  // change rebuilds the renderer and the rig with it.
  useEffect(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    const preset = getHdriPreset(hdri);
    if (!preset.url) {
      ctx.lighting.setHdri(null);
      return;
    }
    let canceled = false;
    loadHdri(preset.id, preset.url)
      .then((texture) => {
        if (canceled || ctxRef.current !== ctx) return;
        ctx.lighting.setHdri({
          texture,
          environmentIntensity: preset.environmentIntensity,
          backgroundIntensity: preset.backgroundIntensity,
          backgroundBlurriness: preset.backgroundBlurriness,
          exposure: preset.exposure,
          lightScale: preset.lightScale
        });
      })
      .catch((err) => {
        if (canceled) return;
        console.error(`HDRI "${preset.id}" failed to load`, err);
        ctx.lighting.setHdri(null);
      });
    return () => {
      canceled = true;
    };
  }, [hdri, renderQuality]);

  useEffect(() => {
    const ctx = ctxRef.current;
    if (!ctx?.currentObject) return;
    applyOrientation(ctx.currentObject, file.orientation);
    frameObject(ctx.camera, ctx.currentObject);
    ctx.controls.target.copy(objectCenter(ctx.currentObject));
    applyDistanceLimits(ctx, ctx.currentObject);
    ctx.controls.update();
  }, [file.orientation.upAxis]);

  useEffect(() => {
    const ctx = ctxRef.current;
    if (!ctx?.currentObject) return;
    applyOrientation(ctx.currentObject, file.orientation);
    ctx.controls.target.copy(objectCenter(ctx.currentObject));
    applyDistanceLimits(ctx, ctx.currentObject);
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
      releaseViewMode(ctx.currentObject); // VIEW MODE: restore originals before disposing
      disposeObject(ctx.currentObject);
      ctx.currentObject = null;
      syncGrid();
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
        applyDistanceLimits(ctx, obj);
        syncGrid(); // GRID: build it for this model

        applyShadowFlags(obj, qualityPreset.shadows.enabled);
        applyAnisotropy(
          obj,
          qualityPreset.anisotropy,
          ctx.renderer.capabilities.getMaxAnisotropy()
        );
        // VIEW MODE: apply whichever mode is active right now (read from the ref, not the
        // closure, so a mode change made while the model was loading isn't lost).
        applyViewMode(obj, viewModeRef.current);

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
          const radius = modelRadiusRef.current;
          const minDist = radius * MODEL_MIN_DISTANCE_FACTOR;
          const maxDist = radius * MODEL_MAX_DISTANCE_FACTOR;
          const zoomingIn = key === 'w';
          const factor = zoomingIn ? 1 / MODEL_KEY_ZOOM_STEP : MODEL_KEY_ZOOM_STEP;

          const offset = ctx.camera.position.clone().sub(ctx.controls.target);
          const currentDist = offset.length();
          let newDist = currentDist * factor;

          // Zooming in: don't tunnel through geometry. Cast along the view
          // direction (camera -> target) and stop just short of the first
          // surface instead of flying inside the mesh.
          if (zoomingIn && ctx.currentObject && currentDist > 0) {
            const viewDir = offset.clone().negate().normalize();
            const raycaster = zoomRaycasterRef.current;
            raycaster.set(ctx.camera.position, viewDir);
            const hit = raycaster
              .intersectObject(ctx.currentObject, true)
              .find((h) => (h.object as THREE.Mesh).isMesh);
            if (hit) {
              const stopAt = Math.max(0, hit.distance - radius * MODEL_SURFACE_MARGIN_FACTOR);
              const wantedTravel = currentDist - newDist;
              if (wantedTravel > stopAt) newDist = currentDist - stopAt;
            }
          }

          // Clamp to the size-relative limits — but never move the camera in
          // the OPPOSITE direction of what was pressed. If we're already past
          // a limit (e.g. a saved camera), hold position rather than jump.
          newDist = zoomingIn
            ? Math.min(currentDist, Math.max(minDist, newDist))
            : Math.max(currentDist, Math.min(maxDist, newDist));

          if (newDist > 0) {
            offset.setLength(newDist);
            ctx.camera.position.copy(ctx.controls.target).add(offset);
            ctx.controls.update();
          }
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
        background: 'var(--wh3d-viewport-bg)',
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
            background: 'var(--wh3d-viewport-bg)',
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
                background: 'var(--wh3d-overlay-bg, rgba(16, 17, 19, 0.85))',
                padding: '2px 6px',
                borderRadius: 3
              }}
            >
              {Math.round(imageZoom * 100)}%
            </Text>
          )}
          {plainImageMode && (
            <Group
              gap={6}
              style={{
                position: 'absolute',
                bottom: 8,
                right: 8,
                background: 'var(--wh3d-overlay-bg, rgba(16, 17, 19, 0.85))',
                padding: '4px 8px',
                borderRadius: 8,
                border: '1px solid var(--wh3d-overlay-border, #2C2E33)',
                backdropFilter: 'blur(4px)',
                zIndex: 10
              }}
            >
              <ActionIcon
                variant="subtle"
                color="gray"
                size="sm"
                onClick={() => setImageZoom((z) => clampZoom(z / IMAGE_KEY_ZOOM_STEP))}
              >
                −
              </ActionIcon>
              <Text size="xs" c="dimmed" style={{ minWidth: 40, textAlign: 'center' }}>
                {Math.round(imageZoom * 100)}%
              </Text>
              <ActionIcon
                variant="subtle"
                color="gray"
                size="sm"
                onClick={() => setImageZoom((z) => clampZoom(z * IMAGE_KEY_ZOOM_STEP))}
              >
                +
              </ActionIcon>
              <Button
                variant="subtle"
                color="gray"
                size="xs"
                onClick={resetView}
                style={{ fontSize: 11, padding: '0 6px', height: 22 }}
              >
                Reset (R)
              </Button>
            </Group>
          )}
        </div>
      )}
      {gridStep !== null && !embeddedPngUrl && !plainImageMode && (
        <Text
          size="xs"
          c="dimmed"
          style={{
            position: 'absolute',
            left: 8,
            bottom: 6,
            background: 'var(--wh3d-overlay-bg, rgba(16, 17, 19, 0.85))',
            padding: '2px 6px',
            borderRadius: 3,
            pointerEvents: 'none'
          }}
        >
          Grid: 1 cell = {gridStep} units
        </Text>
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