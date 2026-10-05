import * as THREE from 'three';

/**
 * Blender-style XYZ orientation gizmo, drawn in the bottom-right corner of the
 * viewer. It is a tiny second scene rendered into a corner of the SAME canvas
 * after the main scene, and it rotates with the main camera.
 *
 * Axis convention matches Blender / Unreal's Z-up look, expressed in three.js'
 * Y-up world (models are auto-oriented so their up is +Y):
 *
 *   X (red)    three +X
 *   Y (green)  three -Z   (right-handed Z-up: Blender Y = -three Z)
 *   Z (blue)   three +Y   (up)
 *
 * Clickable: `hitTest` tells ModelViewer which badge is under the pointer so it
 * can snap the camera to look along that axis (like Blender / Unreal). A
 * positive badge views FROM that side (Z = top view), a faded negative badge
 * views from the opposite side (bottom, back, left).
 *
 * Because `captureCurrentFrame` renders only the main scene, the gizmo never
 * ends up in captured thumbnails.
 */
const SIZE_PX = 96;
const MARGIN_PX = 10;
/** Never take more than this share of the shorter canvas side. */
const MAX_SHARE = 0.3;

interface AxisDef {
  label: string;
  dir: THREE.Vector3;
  color: number;
}

const AXES: AxisDef[] = [
  { label: 'X', dir: new THREE.Vector3(1, 0, 0), color: 0xe0524d },
  { label: 'Y', dir: new THREE.Vector3(0, 0, -1), color: 0x6cc24a },
  { label: 'Z', dir: new THREE.Vector3(0, 1, 0), color: 0x4d8fe0 }
];

function hex(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

/** Round badge, optionally with a letter. Faded when it has no letter. */
function makeBadgeTexture(color: number, label: string | null): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const g = canvas.getContext('2d');
  if (g) {
    g.globalAlpha = label ? 1 : 0.45;
    g.fillStyle = hex(color);
    g.beginPath();
    g.arc(32, 32, 26, 0, Math.PI * 2);
    g.fill();
    if (label) {
      g.globalAlpha = 1;
      g.fillStyle = '#101113';
      g.font = 'bold 36px sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(label, 32, 35);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export interface GizmoHit {
  /** Stable id such as '+Z' or '-X'. */
  key: string;
  /** World-space direction the camera should look FROM (unit vector). */
  dir: THREE.Vector3;
}

interface BadgeEntry {
  key: string;
  dir: THREE.Vector3;
  sprite: THREE.Sprite;
  baseScale: number;
  /** Hit radius in the gizmo's normalised (-1..1) viewport space. */
  hitRadius: number;
}

export class AxisGizmo {
  private readonly badges: BadgeEntry[] = [];
  private hoverKey: string | null = null;
  /** Last viewport used, in CSS px with y measured from the canvas bottom. */
  private rect: { x: number; y: number; px: number } | null = null;
  private readonly tmp = new THREE.Vector3();
  private readonly scene = new THREE.Scene();
  private readonly group = new THREE.Group();
  private readonly camera = new THREE.OrthographicCamera(-1.4, 1.4, 1.4, -1.4, 0.1, 10);
  private readonly size = new THREE.Vector2();

  constructor() {
    this.camera.position.set(0, 0, 5);
    this.camera.lookAt(0, 0, 0);
    this.scene.add(this.group);

    const shaftLength = 0.75;
    const badgeDistance = 0.95;
    const up = new THREE.Vector3(0, 1, 0);

    for (const axis of AXES) {
      const shaft = new THREE.Mesh(
        new THREE.CylinderGeometry(0.035, 0.035, shaftLength, 8),
        new THREE.MeshBasicMaterial({ color: axis.color, toneMapped: false })
      );
      shaft.quaternion.setFromUnitVectors(up, axis.dir);
      shaft.position.copy(axis.dir).multiplyScalar(shaftLength / 2);
      this.group.add(shaft);

      const positive = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: makeBadgeTexture(axis.color, axis.label),
          depthTest: false,
          toneMapped: false
        })
      );
      positive.scale.setScalar(0.5);
      positive.position.copy(axis.dir).multiplyScalar(badgeDistance);
      positive.renderOrder = 2;
      this.group.add(positive);
      this.badges.push({
        key: `+${axis.label}`,
        dir: axis.dir.clone(),
        sprite: positive,
        baseScale: 0.5,
        hitRadius: 0.2
      });

      const negative = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: makeBadgeTexture(axis.color, null),
          depthTest: false,
          toneMapped: false
        })
      );
      negative.scale.setScalar(0.3);
      negative.position.copy(axis.dir).multiplyScalar(-badgeDistance);
      negative.renderOrder = 1;
      this.group.add(negative);
      this.badges.push({
        key: `-${axis.label}`,
        dir: axis.dir.clone().negate(),
        sprite: negative,
        baseScale: 0.3,
        hitRadius: 0.14
      });
    }
  }

  /** Draw into the bottom-right corner. Call right after the main render. */
  render(renderer: THREE.WebGLRenderer, mainCamera: THREE.Camera): void {
    renderer.getSize(this.size);
    const px = Math.min(SIZE_PX, Math.floor(Math.min(this.size.x, this.size.y) * MAX_SHARE));
    if (px < 40) {
      this.rect = null;
      return;
    }

    // Rotate the axes the opposite way to the camera, so they show the world
    // orientation as seen from the main view.
    this.group.quaternion.copy(mainCamera.quaternion).invert();

    const x = this.size.x - px - MARGIN_PX;
    const y = MARGIN_PX;
    this.rect = { x, y, px };
    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setScissorTest(true);
    renderer.setViewport(x, y, px, px);
    renderer.setScissor(x, y, px, px);
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, this.size.x, this.size.y);
    renderer.autoClear = prevAutoClear;
  }

  /**
   * Which badge is under the pointer? `localX` / `localY` are CSS pixels
   * relative to the canvas, with Y measured from the BOTTOM edge. Returns null
   * when the pointer is not over a badge (or the gizmo isn't drawn).
   */
  hitTest(localX: number, localY: number): GizmoHit | null {
    const rect = this.rect;
    if (!rect) return null;
    const nx = ((localX - rect.x) / rect.px) * 2 - 1;
    const ny = ((localY - rect.y) / rect.px) * 2 - 1;
    if (nx < -1 || nx > 1 || ny < -1 || ny > 1) return null;

    let best: { entry: BadgeEntry; z: number } | null = null;
    for (const entry of this.badges) {
      entry.sprite.getWorldPosition(this.tmp);
      const worldZ = this.tmp.z; // larger = closer to the gizmo camera
      this.tmp.project(this.camera);
      if (Math.hypot(this.tmp.x - nx, this.tmp.y - ny) > entry.hitRadius) continue;
      if (!best || worldZ > best.z) best = { entry, z: worldZ };
    }
    return best ? { key: best.entry.key, dir: best.entry.dir.clone() } : null;
  }

  /** Slightly enlarge the hovered badge (null clears it). */
  setHover(key: string | null): void {
    if (key === this.hoverKey) return;
    this.hoverKey = key;
    for (const b of this.badges) {
      b.sprite.scale.setScalar(b.baseScale * (b.key === key ? 1.25 : 1));
    }
  }

  dispose(): void {
    this.scene.traverse((node) => {
      const obj = node as THREE.Mesh | THREE.Sprite;
      const geometry = (obj as THREE.Mesh).geometry;
      if (geometry) geometry.dispose();
      const material = (obj as THREE.Mesh).material as
        | THREE.Material
        | THREE.Material[]
        | undefined;
      if (!material) return;
      for (const m of Array.isArray(material) ? material : [material]) {
        (m as THREE.SpriteMaterial).map?.dispose();
        m.dispose();
      }
    });
  }
}