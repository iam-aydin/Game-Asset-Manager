import * as THREE from 'three';

/**
 * Position the camera so the entire object fits in the viewport with a touch
 * of padding. View direction is a 3/4 angle that looks good for most models.
 */
export function frameObject(camera: THREE.PerspectiveCamera, object: THREE.Object3D): void {
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) return;
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const radius = size.length() / 2;
  if (radius === 0) return;

  const fov = (camera.fov * Math.PI) / 180;
  const distance = (radius / Math.sin(fov / 2)) * 1.15;

  const direction = new THREE.Vector3(1, 0.65, 1).normalize();
  camera.position.copy(center).addScaledVector(direction, distance);
  camera.lookAt(center);
  camera.near = Math.max(distance / 1000, 0.001);
  camera.far = distance * 100;
  camera.updateProjectionMatrix();
}

/** Bounding-sphere center for an object (used by orbit controls target). */
export function objectCenter(object: THREE.Object3D): THREE.Vector3 {
  return new THREE.Box3().setFromObject(object).getCenter(new THREE.Vector3());
}

/**
 * Bounding-sphere radius for an object. Camera zoom limits are expressed as
 * multiples of this so they scale with the model — a mansion modeled in
 * centimetres and a ring modeled in millimetres need very different absolute
 * distances, and hardcoded limits teleport the camera on one or the other.
 * Falls back to 1 for empty/degenerate objects.
 */
export function objectRadius(object: THREE.Object3D): number {
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) return 1;
  const radius = box.getSize(new THREE.Vector3()).length() / 2;
  return radius > 0 ? radius : 1;
}