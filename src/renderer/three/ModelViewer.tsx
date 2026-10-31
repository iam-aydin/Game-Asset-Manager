import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { ActionIcon, Button, Group, Center, Loader, Stack, Text } from '@mantine/core';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { disposeObject, loadModel, ThreeMFEmbeddedOnlyError } from './loaders';
import { frameObject, objectCenter, objectRadius } from './framing';
import { DEFAULT_LIGHTING_STYLE, LightingRig, type LightingStyle } from './lighting';
import { applyViewMode, releaseViewMode } from './view-modes'; // VIEW MODE (1/4): new import
import { applyOrientation } from './orientation';
import { DEFAULT_HDRI_ADJUST, type HdriAdjust } from './hdri-adjust';
import { DEFAULT_HDRI, type HdriId } from '@shared/hdri'; // HDRI (1/3)
import { HDRI_PRESETS, getHdriPreset } from './hdri-presets';
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

// --- 3D preview navigation tuning (Unreal-style) ------------------------
// WASD / Q / E (cursor over viewport): fly, Shift = fast
// Right mouse button (hold) : adds mouse-look to the fly keys
// Mouse wheel               : eased zoom along the view direction
// Middle mouse (hold)       : pan the view (grab it and move left / right / up / down)
// Wheel while RMB held      : changes the navigation speed (fly AND zoom)
// Left mouse drag           : orbit around the pivot, Shift/Ctrl + drag pans
// F                         : frame the model
const NAV_FLY_SPEED = 0.6;                       // WASD speed, in model radii per second (at speed x1)
const NAV_FAST_MULTIPLIER = 3;                   // hold Shift to fly faster
const NAV_KEY_SMOOTHING = 10;                    // higher = snappier key response
const NAV_WHEEL_SENSITIVITY = 0.0015;            // wheel delta -> zoom amount
const NAV_WHEEL_SMOOTHING = 12;                  // higher = wheel eases out faster
const NAV_MIN_STEP_FACTOR = 0.02;                // minimum zoom reference (x radius), prevents stalling
const NAV_SURFACE_MARGIN_FACTOR = 0.005;
const NAV_LOOK_SENSITIVITY = 0.0025;             // radians per pixel of mouse-look
const NAV_LOOK_POLE_EPS = 0.01;                  // keep the look direction off the exact poles
const NAV_SPEED_MIN = 0.05;                      // speed multiplier range
const NAV_SPEED_MAX = 20;
const NAV_ZOOM_MAX_FORWARD = 0.85;               // max fraction of the surface distance covered per frame (never overshoots)
const NAV_ZOOM_MAX_BACK = 2;                     // max zoom-out step per frame, in distances
const NAV_FOCUS_MS = 260;                        // F key: duration of the frame-model animation
const NAV_FOCUS_MARGIN = 1.1;                    // F key: breathing room around the model
const NAV_SPEED_WHEEL_SENSITIVITY = 0.002;       // RMB + wheel: per delta unit (exponential)
const NAV_SPEED_HUD_MS = 1400;                   // how long the speed readout stays visible
// How long the camera swing takes after clicking an axis on the gizmo.
const GIZMO_SNAP_MS = 280;

// HDRI SWITCH: decode the other HDRIs in the background (one at a time, after the
// first one is on screen), so switching later doesn't stall on loading a 4K file.
let hdriPreloadStarted = false;
function preloadOtherHdris(): void {
  if (hdriPreloadStarted) return;
  hdriPreloadStarted = true;
  const list = HDRI_PRESETS.filter((p) => p.url);
  let i = 0;
  const next = () => {
    if (i >= list.length) return;
    const p = list[i++];
    void loadHdri(p.id, p.url as string)
      .catch(() => undefined)
      .then(() => window.setTimeout(next, 600));
  };
  window.setTimeout(next, 2500);
}
interface Props {
  libraryId: string | null;
  file: FileRecord;
  lightingStyle?: LightingStyle;
  hdri?: HdriId;
  showGrid?: boolean;
  renderQuality?: RenderQuality;
  hdriAdjust?: HdriAdjust;
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
    renderQuality = DEFAULT_RENDER_QUALITY,
    hdriAdjust = DEFAULT_HDRI_ADJUST
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

  // Navigation speed multiplier (changed with the middle mouse button).
  // It scales both WASD fly speed and mouse-wheel zoom. Lives in a ref so it
  // survives the navigation effect being re-created.
  const navSpeedRef = useRef(1);
  const [speedHud, setSpeedHud] = useState<number | null>(null);
  const speedHudTimerRef = useRef<number | null>(null);
  // While the right/middle button is held the readout stays up instead of fading.
  const holdSpeedHudRef = useRef(false);
  const showSpeedHud = useCallback(() => {
    setSpeedHud(navSpeedRef.current);
    if (speedHudTimerRef.current !== null) window.clearTimeout(speedHudTimerRef.current);
    if (holdSpeedHudRef.current) {
      speedHudTimerRef.current = null;
      return;
    }
    speedHudTimerRef.current = window.setTimeout(() => {
      setSpeedHud(null);
      speedHudTimerRef.current = null;
    }, NAV_SPEED_HUD_MS);
  }, []);
  useEffect(() => {
    return () => {
      if (speedHudTimerRef.current !== null) window.clearTimeout(speedHudTimerRef.current);
    };
  }, []);

  // VIEW MODE (2/4): always-current mode for the async model loader, so a model
  // that finishes loading after the user switched modes still gets the right one.
  const viewModeRef = useRef<LightingStyle>(lightingStyle);
  viewModeRef.current = lightingStyle;

  // HDRI ADJUST: always-current values for async code.
  const hdriRef = useRef(hdri);
  hdriRef.current = hdri;
  const hdriAdjustRef = useRef(hdriAdjust);
  hdriAdjustRef.current = hdriAdjust;
  // HDRI SWITCH: the HDRI that is really on screen. The adjust values are only applied to
  // it, never to the previous sky while the next one is still loading (that was the dimming).
  const loadedHdriRef = useRef<HdriId | null>(null);
  const prevHdriRef = useRef<HdriId | null>(null);
  // Applies the Adjust-popover values on top of the preset. Reads refs only, so it
  // is safe to call from async code.
  const applyHdriAdjust = () => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    const preset = getHdriPreset(hdriRef.current);
    if (!preset.url) return;
    if (loadedHdriRef.current !== preset.id) return;
    const adj = hdriAdjustRef.current;
    const s = ctx.scene;
    s.backgroundBlurriness = THREE.MathUtils.clamp(preset.backgroundBlurriness + adj.blur, 0, 1);
    s.backgroundIntensity = preset.backgroundIntensity * adj.brightness;
    s.environmentIntensity = preset.environmentIntensity * adj.light;
    const rot = THREE.MathUtils.degToRad(adj.rotation);
    s.backgroundRotation.y = rot;
    s.environmentRotation.y = rot;
  };

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

  // Bounding radius of the currently loaded model — drives the zoom step sizes
  // and the camera clip planes.
  const modelRadiusRef = useRef(1);
  // Center of the loaded model (for the dynamic clip planes).
  const modelCenterRef = useRef(new THREE.Vector3());
  // Reused for zoom surface checks (avoids allocating per frame).
  const zoomRaycasterRef = useRef(new THREE.Raycaster());

  // Recomputes the model radius. There are no zoom distance limits anymore;
  // only the clip planes adapt to the model size, so you can get really close
  // or far away without the model being cut off.
  const applyDistanceLimits = (ctx: ViewerCtx, obj: THREE.Object3D) => {
    const r = objectRadius(obj);
    modelRadiusRef.current = r;
    modelCenterRef.current.copy(objectCenter(obj));
    ctx.controls.minDistance = 0;
    ctx.controls.maxDistance = Infinity;
    ctx.camera.near = Math.max(r * 0.001, 1e-4);
    ctx.camera.far = r * 100;
    ctx.camera.updateProjectionMatrix();
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
    controls.enableZoom = false; // zoom is handled by our own smooth, never-stalling zoom
    // Unreal-style: the right button (mouse-look + fly) and the middle button
    // (speed control) are handled by our own navigation code, so OrbitControls
    // must ignore both. Left button still orbits (Shift/Ctrl + drag pans).
    controls.mouseButtons.RIGHT = -1 as unknown as THREE.MOUSE;
    controls.mouseButtons.MIDDLE = -1 as unknown as THREE.MOUSE;
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

    // Clip planes follow the camera distance, so the model never gets cut off
    // (or z-fights / flickers) when you fly far away or very close.
    const updateClipPlanes = () => {
      if (!ctx.currentObject) return;
      const r = modelRadiusRef.current;
      const d = camera.position.distanceTo(modelCenterRef.current);
      const near = d > r * 1.5 ? Math.max((d - r) * 0.05, r * 0.001) : Math.max(r * 0.001, 1e-4);
      const far = Math.max(r * 100, (d + r) * 4);
      if (Math.abs(near - camera.near) > camera.near * 0.01 || Math.abs(far - camera.far) > camera.far * 0.01) {
        camera.near = near;
        camera.far = far;
        camera.updateProjectionMatrix();
      }
    };

    const tick = () => {
      controls.update();
      updateClipPlanes();
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
  //
  // HDRI SWITCH: when the environment changes, the view blurs (CSS) while the new HDRI
  // loads and is applied, then un-blurs smoothly. The old sky stays untouched until the
  // new one is ready (loadedHdriRef blocks the adjust values in the meantime).
  useEffect(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    const canvas = ctx.renderer.domElement;
    const preset = getHdriPreset(hdri);
    const animate = prevHdriRef.current !== null && prevHdriRef.current !== hdri;
    prevHdriRef.current = hdri;
    loadedHdriRef.current = null;
    let canceled = false;

    const BLUR_PX = 14;
    const BLUR_IN_MS = 160;
    const BLUR_OUT_MS = 450;
    const setBlur = (px: number, ms: number) => {
      canvas.style.transition = `filter ${ms}ms ease`;
      canvas.style.filter = px > 0 ? `blur(${px}px)` : '';
    };
    const unblur = () => {
      // two frames later, so the heavy first render of the new HDRI is already done
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (!canceled) setBlur(0, BLUR_OUT_MS);
        })
      );
    };
    const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

    if (!preset.url) {
      if (animate) {
        setBlur(BLUR_PX, BLUR_IN_MS);
        void wait(BLUR_IN_MS + 10).then(() => {
          if (canceled || ctxRef.current !== ctx) return;
          ctx.lighting.setHdri(null);
          unblur();
        });
      } else {
        ctx.lighting.setHdri(null);
      }
      return () => {
        canceled = true;
      };
    }

    if (animate) setBlur(BLUR_PX, BLUR_IN_MS);
    Promise.all([loadHdri(preset.id, preset.url), animate ? wait(BLUR_IN_MS + 10) : Promise.resolve()])
      .then(([texture]) => {
        if (canceled || ctxRef.current !== ctx) return;
        loadedHdriRef.current = preset.id;
        ctx.lighting.setHdri({
          texture,
          environmentIntensity: preset.environmentIntensity,
          backgroundIntensity: preset.backgroundIntensity,
          backgroundBlurriness: preset.backgroundBlurriness,
          exposure: preset.exposure,
          lightScale: preset.lightScale
        });
        applyHdriAdjust();
        if (animate) unblur();
        preloadOtherHdris();
      })
      .catch((err) => {
        if (canceled) return;
        console.error(`HDRI "${preset.id}" failed to load`, err);
        ctx.lighting.setHdri(null);
        if (animate) unblur();
      });
    return () => {
      canceled = true;
    };
  }, [hdri, renderQuality]);

  // HDRI ADJUST: re-apply the popover values (after lighting.apply on view-mode changes).
  useEffect(() => {
    applyHdriAdjust();
  }, [hdriAdjust, hdri, lightingStyle, renderQuality]);

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

  // 3D navigation, Unreal-style:
  //  - W/A/S/D fly, Q/E down/up, Shift = fast, while the cursor is over the viewport
  //  - hold RIGHT or MIDDLE mouse: adds mouse-look (pointer lock) on top of the
  //    fly keys, and shows the current speed
  //  - mouse wheel: eased, never-stalling zoom along the view direction
  //    (while RIGHT/MIDDLE is held the wheel changes the navigation speed instead,
  //    which scales both fly speed and wheel zoom)
  //  - F: fit the whole model in view, keeping the current viewing angle
  useEffect(() => {
    const show3D = !plainImageMode && !embeddedPngUrl;
    if (!show3D) return;
    const ctx = ctxRef.current;
    if (!ctx) return;

    const canvas = ctx.renderer.domElement;
    const keys = new Set<string>();
    const vel = { fwd: 0, side: 0, vert: 0 };
    let shiftHeld = false;
    const flyForward = new THREE.Vector3();
    const flyRight = new THREE.Vector3();
    const flyMove = new THREE.Vector3();
    let zoomImpulse = 0;
    let raf = 0;
    let last = performance.now();

    // Mouse-look / speed-drag state
    let lookActive = false;
    let lookButton = -1; // which mouse button started the look (1 = middle, 2 = right)

    // Middle-button pan state
    let panActive = false;
    const panRight = new THREE.Vector3();
    const panUp = new THREE.Vector3();
    let hovering = false; // cursor is over the 3D viewport
    const onEnter = () => {
      hovering = true;
    };
    const onLeave = () => {
      hovering = false;
    };
    const lookOffset = new THREE.Vector3();
    const lookSph = new THREE.Spherical();

    const viewDir = new THREE.Vector3();

    const changeSpeed = (factor: number) => {
      navSpeedRef.current = Math.min(
        NAV_SPEED_MAX,
        Math.max(NAV_SPEED_MIN, navSpeedRef.current * factor)
      );
      showSpeedHud();
    };

    // Moves camera AND orbit pivot along the view direction. Step size is based
    // on the distance to the surface ahead (with a floor), so it never stalls.
    const zoomAlongView = (amount: number) => {
      const obj = ctx.currentObject;
      if (!obj) return;
      const radius = modelRadiusRef.current;
      ctx.camera.getWorldDirection(viewDir);

      const raycaster = zoomRaycasterRef.current;
      raycaster.set(ctx.camera.position, viewDir);
      const hit = raycaster
        .intersectObject(obj, true)
        .find((h) => (h.object as THREE.Mesh).isMesh);

      const ref = Math.max(
        hit ? hit.distance : ctx.camera.position.distanceTo(objectCenter(obj)),
        radius * NAV_MIN_STEP_FACTOR
      );
      const move = ref * amount;
      ctx.camera.position.addScaledVector(viewDir, move);

      // Orbit around the surface you're looking at; otherwise keep the old distance.
      const remaining = hit ? hit.distance - move : null;
      if (remaining !== null && remaining > radius * NAV_SURFACE_MARGIN_FACTOR) {
        ctx.controls.target.copy(ctx.camera.position).addScaledVector(viewDir, remaining);
      } else {
        ctx.controls.target.addScaledVector(viewDir, move);
      }
    };

    // Turns the camera in place (camera position stays put, the orbit pivot
    // swings with the view so orbiting afterwards still feels right).
    const lookBy = (dx: number, dy: number) => {
      lookOffset.copy(ctx.controls.target).sub(ctx.camera.position);
      if (lookOffset.lengthSq() < 1e-12) {
        lookOffset.set(0, 0, -Math.max(modelRadiusRef.current, 1e-3));
      }
      lookSph.setFromVector3(lookOffset);
      lookSph.theta -= dx * NAV_LOOK_SENSITIVITY; // mouse right -> look right
      lookSph.phi = Math.min(
        Math.PI - NAV_LOOK_POLE_EPS,
        Math.max(NAV_LOOK_POLE_EPS, lookSph.phi + dy * NAV_LOOK_SENSITIVITY) // mouse down -> look down
      );
      lookOffset.setFromSpherical(lookSph);
      ctx.controls.target.copy(ctx.camera.position).add(lookOffset);
      ctx.controls.update();
    };

    // F: smoothly move to a distance where the whole model fits, centered on
    // the model, looking from the SAME direction as right now.
    let focusAnim: {
      t0: number;
      fromPos: THREE.Vector3;
      toPos: THREE.Vector3;
      fromTgt: THREE.Vector3;
      toTgt: THREE.Vector3;
    } | null = null;
    const cancelFocus = () => {
      focusAnim = null;
    };
    const focusModel = () => {
      const obj = ctx.currentObject;
      if (!obj) return;
      const center = objectCenter(obj).clone();
      const r = Math.max(modelRadiusRef.current, 1e-6);
      const dir = ctx.camera.position.clone().sub(ctx.controls.target);
      if (dir.lengthSq() < 1e-12) dir.set(0, 0, 1);
      dir.normalize();
      const vfov = THREE.MathUtils.degToRad(ctx.camera.fov);
      const hfov = 2 * Math.atan(Math.tan(vfov / 2) * ctx.camera.aspect);
      const half = Math.min(vfov, hfov) / 2;
      const dist = (r / Math.sin(half)) * NAV_FOCUS_MARGIN * ctx.camera.zoom;
      focusAnim = {
        t0: performance.now(),
        fromPos: ctx.camera.position.clone(),
        toPos: center.clone().addScaledVector(dir, dist),
        fromTgt: ctx.controls.target.clone(),
        toTgt: center
      };
    };

    // Middle button: grab the view and slide it left / right / up / down.
    // No rotation: the camera and its orbit pivot move together in the screen plane.
    const panBy = (dx: number, dy: number) => {
      const dist = Math.max(
        ctx.camera.position.distanceTo(ctx.controls.target),
        modelRadiusRef.current * NAV_MIN_STEP_FACTOR
      );
      const perPixel =
        (2 * dist * Math.tan(THREE.MathUtils.degToRad(ctx.camera.fov) / 2)) /
        Math.max(canvas.clientHeight, 1) /
        Math.max(ctx.camera.zoom, 1e-6);
      panRight.set(1, 0, 0).applyQuaternion(ctx.camera.quaternion);
      panUp.set(0, 1, 0).applyQuaternion(ctx.camera.quaternion);
      flyMove
        .set(0, 0, 0)
        .addScaledVector(panRight, -dx * perPixel) // drag right -> the scene follows to the right
        .addScaledVector(panUp, dy * perPixel); // drag down -> the scene follows down
      ctx.camera.position.add(flyMove);
      ctx.controls.target.add(flyMove);
      ctx.controls.update();
    };
    const startPan = () => {
      if (panActive || lookActive || !ctx.currentObject) return;
      panActive = true;
      cancelFocus();
      // Cancel a running gizmo swing (it listens for OrbitControls' 'start').
      ctx.controls.dispatchEvent({ type: 'start' } as never);
      canvas.style.cursor = 'grabbing';
    };
    const endPan = () => {
      if (!panActive) return;
      panActive = false;
      canvas.style.cursor = '';
    };

    const startLook = (button: number) => {
      if (lookActive || !ctx.currentObject) return;
      lookActive = true;
      lookButton = button;
      holdSpeedHudRef.current = true;
      showSpeedHud();
      // Cancel a running gizmo swing (it listens for OrbitControls' 'start').
      ctx.controls.dispatchEvent({ type: 'start' } as never);
      try {
        const p = canvas.requestPointerLock() as unknown as Promise<void> | undefined;
        if (p && typeof p.catch === 'function') p.catch(() => {});
      } catch {
        /* pointer lock not available: mouse-look still works while the cursor moves */
      }
    };
    const endLook = () => {
      if (!lookActive) return;
      lookActive = false;
      lookButton = -1;
      keys.clear();
      holdSpeedHudRef.current = false;
      showSpeedHud(); // let the readout fade out now
      if (document.pointerLockElement === canvas) document.exitPointerLock();
    };

    const onPointerDown = (e: PointerEvent) => {
      cancelFocus();
      if (e.button === 2 || e.button === 1) {
        e.preventDefault();
        if (e.buttons & 1) return; // left button is already orbiting: don't mix the two
        if (e.button === 1) {
          startPan(); // middle button: pan the view
          if (panActive) {
            try {
              canvas.setPointerCapture(e.pointerId);
            } catch {
              /* capture is optional */
            }
          }
        }
        else startLook(e.button); // right button: mouse-look + fly
      }
    };
    // While looking, a left click must not start an orbit at the same time
    // (that is what made the view fight itself). Runs before OrbitControls.
    const onWindowPointerDownCapture = (e: PointerEvent) => {
      if ((lookActive || panActive) && e.button === 0 && e.target === canvas) {
        e.stopPropagation();
        e.preventDefault();
      }
    };
    const onPointerUp = (e: PointerEvent) => {
      if (lookActive && e.button === lookButton) endLook();
      if (panActive && e.button === 1) endPan();
    };
    const onMouseMove = (e: MouseEvent) => {
      if (lookActive) lookBy(e.movementX, e.movementY);
      // pan moves are handled in onPointerMove below
    };
    // Pan runs on pointer events: after a preventDefault()-ed pointerdown,
    // Chromium stops sending mousemove, which can leave the pan dead.
    const onPointerMove = (e: PointerEvent) => {
      if (!panActive) return;
      if ((e.buttons & 4) === 0) {
        endPan(); // middle button was released somewhere we missed
        return;
      }
      panBy(e.movementX, e.movementY);
    };
    const onPointerLockChange = () => {
      // Esc (or the browser) can drop the lock while the button is still down.
      if (lookActive && document.pointerLockElement !== canvas && document.pointerLockElement) {
        endLook();
      }
    };
    const onContextMenu = (e: Event) => e.preventDefault();

    const isTyping = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      return t?.tagName === 'INPUT' || t?.tagName === 'TEXTAREA' || !!t?.isContentEditable;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      shiftHeld = e.shiftKey;
      if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e)) return;
      const k = e.key.toLowerCase();

      // F: frame the model (Unreal's "focus")
      if (k === 'f' && !e.repeat && ctx.currentObject) {
        e.preventDefault();
        focusModel();
        return;
      }

      // Fly keys work while the cursor is over the viewport (or while the right
      // mouse button is held, which also gives you mouse-look).
      if (!lookActive && !hovering) return;
      if (k.length === 1 && 'wasdqe'.includes(k)) {
        e.preventDefault();
        cancelFocus();
        keys.add(k);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      keys.delete(e.key.toLowerCase());
      shiftHeld = e.shiftKey;
    };
    const onBlur = () => {
      keys.clear();
      shiftHeld = false;
      endLook();
      endPan();
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      cancelFocus();
      const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
      if (lookActive) {
        // Unreal: wheel while flying = fly speed
        changeSpeed(Math.exp(-dy * NAV_SPEED_WHEEL_SENSITIVITY));
        return;
      }
      zoomImpulse = Math.max(-1.5, Math.min(1.5, zoomImpulse - dy * NAV_WHEEL_SENSITIVITY));
    };

    const axis = (pos: string, neg: string) => (keys.has(pos) ? 1 : 0) - (keys.has(neg) ? 1 : 0);

    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      // Smooth the key input so movement eases in and out.
      const blend = 1 - Math.exp(-dt * NAV_KEY_SMOOTHING);
      vel.fwd += (axis('w', 's') - vel.fwd) * blend;
      vel.side += (axis('d', 'a') - vel.side) * blend;
      vel.vert += (axis('e', 'q') - vel.vert) * blend;
      if (Math.abs(vel.fwd) < 1e-3) vel.fwd = 0;
      if (Math.abs(vel.side) < 1e-3) vel.side = 0;
      if (Math.abs(vel.vert) < 1e-3) vel.vert = 0;

      let moved = false;

      if (focusAnim) {
        const t = Math.min(1, (now - focusAnim.t0) / NAV_FOCUS_MS);
        const eased = 1 - Math.pow(1 - t, 3);
        ctx.camera.position.lerpVectors(focusAnim.fromPos, focusAnim.toPos, eased);
        ctx.controls.target.lerpVectors(focusAnim.fromTgt, focusAnim.toTgt, eased);
        if (t >= 1) focusAnim = null;
        moved = true;
      }

      if (vel.fwd !== 0 || vel.side !== 0 || vel.vert !== 0) {
        // Unreal-style fly: W/S forward/back, A/D left/right, E/Q up/down.
        // Speed depends on model size (not distance), so it never stalls.
        const speed =
          modelRadiusRef.current *
          NAV_FLY_SPEED *
          navSpeedRef.current *
          (shiftHeld ? NAV_FAST_MULTIPLIER : 1) *
          dt;
        ctx.camera.getWorldDirection(flyForward);
        flyRight.crossVectors(flyForward, ctx.camera.up).normalize();
        flyMove
          .set(0, 0, 0)
          .addScaledVector(flyForward, vel.fwd * speed)
          .addScaledVector(flyRight, vel.side * speed)
          .addScaledVector(ctx.camera.up, vel.vert * speed);
        ctx.camera.position.add(flyMove);
        ctx.controls.target.add(flyMove);
        moved = true;
      }

      // Mouse wheel (eased), scaled by the speed multiplier
      const wheelPart = zoomImpulse * (1 - Math.exp(-dt * NAV_WHEEL_SMOOTHING));
      zoomImpulse -= wheelPart;
      if (Math.abs(zoomImpulse) < 1e-4) zoomImpulse = 0;
      // Clamped so a high speed multiplier can't jump through the model or
      // fling the camera out of the clip range in a single frame.
      const zoomAmount = Math.min(
        NAV_ZOOM_MAX_FORWARD,
        Math.max(-NAV_ZOOM_MAX_BACK, wheelPart * navSpeedRef.current)
      );
      if (Math.abs(zoomAmount) > 1e-6) {
        zoomAlongView(zoomAmount);
        moved = true;
      }

      if (moved) ctx.controls.update();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerdown', onWindowPointerDownCapture, true);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onBlur);
    document.addEventListener('pointerlockchange', onPointerLockChange);
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointerenter', onEnter);
    canvas.addEventListener('pointerleave', onLeave);
    canvas.addEventListener('contextmenu', onContextMenu);
    canvas.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      cancelAnimationFrame(raf);
      endLook();
      endPan();
      window.removeEventListener('pointerdown', onWindowPointerDownCapture, true);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onBlur);
      document.removeEventListener('pointerlockchange', onPointerLockChange);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointerenter', onEnter);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('contextmenu', onContextMenu);
      canvas.removeEventListener('wheel', onWheel);
    };
  }, [plainImageMode, embeddedPngUrl, renderQuality, showSpeedHud]);

  // Middle button: in the 3D view it works like the right button (mouse-look +
  // fly, handled in the navigation effect above). Here we only block the browser's autoscroll,
  // and the plain image preview keeps middle-click-to-reset.
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 1) return;
    e.preventDefault();
    if (plainImageMode) resetView();
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
          className="gam-viewport-label"
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
      {speedHud !== null && !embeddedPngUrl && !plainImageMode && (
        <Text
          size="xs"
          c="dimmed"
          style={{
            position: 'absolute',
            top: 8,
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'var(--wh3d-overlay-bg, rgba(16, 17, 19, 0.85))',
            padding: '2px 10px',
            borderRadius: 3,
            pointerEvents: 'none'
          }}
        >
          Speed: ×{speedHud.toFixed(2)}
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