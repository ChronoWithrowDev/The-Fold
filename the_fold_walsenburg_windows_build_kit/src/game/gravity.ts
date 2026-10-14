import * as T from 'three';
import type { Vec3 } from './types';

export const GRAVITY_DIRECTIONS: readonly Vec3[] = [
  [0, -1, 0],
  [1, 0, 0],
  [0, 1, 0],
  [-1, 0, 0],
  [0, 0, -1],
  [0, 0, 1],
];

export const GRAVITY_LABELS = ['DOWN', 'EAST', 'UP', 'WEST', 'NORTH', 'SOUTH'] as const;

/**
 * Gravity modes in wheel order, clockwise from the top slot. Opposites sit across from each other
 * (UP/DOWN, NORTH/SOUTH, EAST/WEST), so a flick and its reverse are always 180° apart.
 */
export const WHEEL_ORDER = [2, 4, 1, 0, 5, 3] as const;

/** Which wheel slot a cursor offset points at, or -1 inside the dead zone. Screen y grows downward. */
export function wheelSlot(x: number, y: number, deadZone = 26) {
  if (Math.hypot(x, y) < deadZone) return -1;
  const angle = Math.atan2(x, -y);
  return ((Math.round(angle / (Math.PI / 3)) % 6) + 6) % 6;
}

export function gravityBasis(up: T.Vector3, yaw: number) {
  const worldForward = new T.Vector3(0, 0, -1);
  const forward = worldForward.addScaledVector(up, -worldForward.dot(up));
  if (forward.lengthSq() < 0.01) {
    forward.set(1, 0, 0).addScaledVector(up, -up.x);
  }
  forward.normalize().applyAxisAngle(up, yaw);
  const right = forward.clone().cross(up).normalize();
  return { forward, right };
}

export function gravityLook(up: T.Vector3, yaw: number, pitch: number, target = new T.Vector3()) {
  const basis = gravityBasis(up, yaw);
  return target.copy(basis.forward).multiplyScalar(Math.cos(pitch)).addScaledVector(up, Math.sin(pitch)).normalize();
}

export function orientationInGravity(quaternion: T.Quaternion, up: T.Vector3) {
  const forward = new T.Vector3(0, 0, -1).applyQuaternion(quaternion).normalize();
  const viewUp = new T.Vector3(0, 1, 0).applyQuaternion(quaternion).normalize();
  const sine = T.MathUtils.clamp(forward.dot(up), -1, 1);
  const pitch = Math.asin(sine);
  // Heading = forward·cos(pitch) − viewUp·sin(pitch). Unlike the forward vector alone this stays well
  // defined when a fold delivers you looking straight up or down: the top of the view carries it.
  const flat = forward.multiplyScalar(Math.cos(pitch)).addScaledVector(viewUp, -sine);
  flat.addScaledVector(up, -flat.dot(up));
  if (flat.lengthSq() < 1e-8) return { yaw: 0, pitch };
  flat.normalize();
  const reference = new T.Vector3(0, 0, -1).addScaledVector(up, up.z);
  if (reference.lengthSq() < 0.01) reference.set(1, 0, 0).addScaledVector(up, -up.x);
  reference.normalize();
  const right = reference.clone().cross(up).normalize();
  return { yaw: Math.atan2(-flat.dot(right), flat.dot(reference)), pitch };
}