import * as THREE from 'three';

/**
 * Reference grid for the 3D viewer, centred on the world origin (0, 0, 0).
 *
 * three.js is Y-up, so the grid lies on the floor plane (X / Z at Y = 0). That
 * is the same physical floor as Unreal's XY plane, so it shows where the
 * model's pivot sits relative to the ground when it lands in the engine.
 *
 * Colours match the axis gizmo (Blender / Z-up convention):
 *   red    X axis
 *   green  Y axis (three's Z axis, because Blender Y = -three Z)
 *   blue   Z axis (up: three's Y axis, short stub)
 *
 * The cell size adapts to the model: it is the power of ten that gives roughly
 * 4-40 cells across the model's radius, so a 1 m prop and a 1000-unit mansion
 * both get a readable grid. The size is returned so the UI can show it.
 */
const DIVISIONS = 80; // must be even so there is a centre line
const GRID_COLOR = 0x8a93a6;

export interface ViewerGrid {
  group: THREE.Group;
  /** Size of one cell, in model units. */
  step: number;
  dispose(): void;
}

function axisLine(a: THREE.Vector3, b: THREE.Vector3, color: number): THREE.Line {
  const geometry = new THREE.BufferGeometry().setFromPoints([a, b]);
  const material = new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    toneMapped: false
  });
  const line = new THREE.Line(geometry, material);
  line.renderOrder = 2;
  return line;
}

export function createViewerGrid(radius: number): ViewerGrid {
  const safeRadius = Number.isFinite(radius) && radius > 0 ? radius : 1;
  const step = Math.pow(10, Math.floor(Math.log10(safeRadius / 2)));
  const size = step * DIVISIONS;
  const half = size / 2;

  const group = new THREE.Group();
  group.name = 'wh3d-grid';

  const grid = new THREE.GridHelper(size, DIVISIONS, GRID_COLOR, GRID_COLOR);
  grid.renderOrder = 1;
  const mats = Array.isArray(grid.material) ? grid.material : [grid.material];
  for (const m of mats) {
    m.transparent = true;
    m.opacity = 0.35;
    m.depthWrite = false;
    m.toneMapped = false;
  }
  group.add(grid);

  group.add(axisLine(new THREE.Vector3(-half, 0, 0), new THREE.Vector3(half, 0, 0), 0xe0524d));
  group.add(axisLine(new THREE.Vector3(0, 0, -half), new THREE.Vector3(0, 0, half), 0x6cc24a));
  group.add(axisLine(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, step * 10, 0), 0x4d8fe0));

  return {
    group,
    step,
    dispose() {
      group.traverse((node) => {
        const obj = node as THREE.Line;
        if (!obj.isLine && !(node as THREE.LineSegments).isLineSegments) return;
        obj.geometry.dispose();
        const m = obj.material;
        if (Array.isArray(m)) m.forEach((x) => x.dispose());
        else m.dispose();
      });
    }
  };
}