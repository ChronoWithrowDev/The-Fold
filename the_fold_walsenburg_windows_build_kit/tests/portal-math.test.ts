import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as T from 'three';
import { connectionMatrix, fitPortal, orientPortal, PortalPair, surfaceCanHoldPortal } from '../src/game/portals';
import { gravityBasis, gravityLook, GRAVITY_DIRECTIONS, orientationInGravity } from '../src/game/gravity';
import { runPortalMathChecks } from '../src/game/checks';
import type { Body, PortalSurface, Vec3 } from '../src/game/types';

const pose = (position: Vec3, normal: Vec3) => new T.Matrix4().compose(new T.Vector3(...position), new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 0, 1), new T.Vector3(...normal)), new T.Vector3(1, 1, 1));

test('startup spatial checks all pass', () => {
  for (const check of runPortalMathChecks()) assert.equal(check.passed, true, check.name);
});

test('all 36 cardinal surface pairings preserve velocity and round-trip position', () => {
  const normals: Vec3[] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  for (const from of normals) for (const to of normals) {
    const a = pose([12, 3, -18], from);
    const b = pose([-41, 12, 9], to);
    const ab = connectionMatrix(a, b);
    const ba = connectionMatrix(b, a);
    const rotation = new T.Quaternion().setFromRotationMatrix(ab);
    const position = new T.Vector3(12.27, 3.54, -17.85);
    assert.ok(position.clone().applyMatrix4(ab).applyMatrix4(ba).distanceTo(position) < 1e-8);
    const velocity = new T.Vector3(-7.5, -28.6, 3.9);
    assert.ok(Math.abs(velocity.length() - velocity.clone().applyQuaternion(rotation).length()) < 1e-8);
    const entering = new T.Vector3(...from).multiplyScalar(-15).applyQuaternion(rotation);
    assert.ok(entering.distanceTo(new T.Vector3(...to).multiplyScalar(15)) < 1e-8);
  }
});

function makeSurface(id: string, position: Vec3): PortalSurface {
  const mesh = new T.Mesh(new T.PlaneGeometry(4, 4.2), new T.MeshBasicMaterial());
  mesh.position.set(...position);
  return { id, mesh, position: mesh.position.clone(), quaternion: new T.Quaternion(), normal: new T.Vector3(0, 0, 1), width: 4, height: 4.2, colliders: [id === 'a' ? 1 : 2] };
}

/** Seats a fold at the surface's own rotation, as the tests' upright fixtures expect. */
const seat = (surface: PortalSurface, point: T.Vector3 = surface.position) => fitPortal(surface, point, surface.quaternion)!;

function player(): Body {
  return { id: 'player', position: new T.Vector3(0, 2, 0.3), velocity: new T.Vector3(0, 0, -35), half: new T.Vector3(0.29, 0.9, 0.29), up: new T.Vector3(0, 1, 0), gravity: new T.Vector3(0, -1, 0), rotation: new T.Quaternion(), grounded: false, cooldown: 0, spawn: new T.Vector3(), stage: 0 };
}

test('swept crossing catches fast traversal without requiring a frame inside the portal', () => {
  const pair = new PortalPair(new T.Scene());
  const a = makeSurface('a', [0, 2, 0]);
  const b = makeSurface('b', [25, 2, -30]);
  pair.portals[0].place(a, seat(a));
  pair.portals[1].place(b, seat(b));
  const body = player();
  const originalGravity = body.gravity.clone();
  assert.ok(pair.crossing(body, new T.Vector3(0, 2, 0.5), new T.Vector3(0, 2, -0.8)));
  assert.ok(body.gravity.distanceTo(originalGravity) < 1e-12);
  assert.equal(pair.crossing(body, new T.Vector3(0, 2, -0.5), new T.Vector3(0, 2, 0.8)), null);
  assert.equal(pair.crossing(body, new T.Vector3(3, 2, 0.5), new T.Vector3(3, 2, -0.8)), null);
  body.cooldown = 0.05;
  assert.equal(pair.crossing(body, new T.Vector3(0, 2, 0.5), new T.Vector3(0, 2, -0.8)), null);
  body.cooldown = 0;
  pair.portals[1].close();
  assert.equal(pair.crossing(body, new T.Vector3(0, 2, 0.5), new T.Vector3(0, 2, -0.8)), null);
  pair.dispose();
});

test('all six gravity directions produce a stable, usable camera and movement basis', () => {
  for (const direction of GRAVITY_DIRECTIONS) {
    const gravity = new T.Vector3(...direction);
    const up = gravity.clone().negate();
    const basis = gravityBasis(up, 0.8);
    assert.ok(Math.abs(basis.forward.length() - 1) < 1e-9);
    assert.ok(Math.abs(basis.right.length() - 1) < 1e-9);
    assert.ok(Math.abs(basis.forward.dot(up)) < 1e-9);
    assert.ok(Math.abs(basis.right.dot(up)) < 1e-9);
    const forward = gravityLook(up, 0.8, 0.27);
    const camera = new T.PerspectiveCamera();
    camera.up.copy(up);
    camera.lookAt(forward);
    camera.updateMatrixWorld();
    const restored = orientationInGravity(camera.quaternion, up);
    const restoredForward = gravityLook(up, restored.yaw, restored.pitch);
    assert.ok(restoredForward.distanceTo(forward) < 1e-7);
  }
});

test('a broad horizontal face can host a traversable floor portal', () => {
  const pair = new PortalPair(new T.Scene());
  const surface: PortalSurface = {
    id: 'warehouse-floor', mesh: new T.Mesh(new T.PlaneGeometry(18, 24), new T.MeshBasicMaterial()),
    position: new T.Vector3(0, 0, 0), quaternion: new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 0, 1), new T.Vector3(0, 1, 0)),
    normal: new T.Vector3(0, 1, 0), width: 18, height: 24, colliders: [7],
  };
  pair.portals[0].place(surface, seat(surface, new T.Vector3(2, 0, 3)));
  const far: PortalSurface = { ...surface, id: 'far-floor', position: new T.Vector3(20, 4, -10), colliders: [8] };
  pair.portals[1].place(far, seat(far, new T.Vector3(22, 4, -8)));
  const body = player();
  const crossing = pair.crossing(body, new T.Vector3(2, 0.7, 3), new T.Vector3(2, -0.6, 3));
  assert.ok(crossing);
  assert.ok(crossing!.destination.normal.distanceTo(new T.Vector3(0, 1, 0)) < 1e-8);
  assert.equal(pair.ignoresCollider(7, new T.Vector3(2, 0.01, 3), body), true);
  pair.dispose();
});

test('fold rotation follows the shooter: upright on walls, along their heading on floors and ceilings', () => {
  const upOf = (q: T.Quaternion) => new T.Vector3(0, 1, 0).applyQuaternion(q);
  const normalOf = (q: T.Quaternion) => new T.Vector3(0, 0, 1).applyQuaternion(q);
  const worldUp = new T.Vector3(0, 1, 0);
  const north = new T.Vector3(0, 0, -1);
  const east = new T.Vector3(1, 0, 0);
  // Ordinary gravity: walls stay upright whichever way you face; floors and ceilings follow your heading.
  assert.ok(upOf(orientPortal(new T.Vector3(0, 0, 1), worldUp, east)).distanceTo(worldUp) < 1e-9);
  assert.ok(upOf(orientPortal(worldUp, worldUp, east)).distanceTo(east) < 1e-9);
  assert.ok(upOf(orientPortal(new T.Vector3(0, -1, 0), worldUp, north)).distanceTo(north) < 1e-9);
  const diagonal = new T.Vector3(1, 0, -1).normalize();
  const floor = orientPortal(worldUp, worldUp, diagonal);
  assert.ok(upOf(floor).distanceTo(diagonal) < 1e-9);
  assert.ok(normalOf(floor).distanceTo(worldUp) < 1e-9);
  // Gravity pulling east: the east wall becomes your floor, and the world floor becomes a wall.
  const westUp = new T.Vector3(-1, 0, 0);
  assert.ok(upOf(orientPortal(westUp, westUp, north)).distanceTo(north) < 1e-9);
  assert.ok(upOf(orientPortal(worldUp, westUp, north)).distanceTo(westUp) < 1e-9);
});

test('falling into a floor fold while facing its top edge comes out upright', () => {
  const worldUp = new T.Vector3(0, 1, 0);
  const north = new T.Vector3(0, 0, -1);
  const pose = (position: T.Vector3, q: T.Quaternion) => new T.Matrix4().compose(position, q, new T.Vector3(1, 1, 1));
  const floor = pose(new T.Vector3(), orientPortal(worldUp, worldUp, north));
  const wall = pose(new T.Vector3(0, 10, 20), orientPortal(new T.Vector3(0, 0, 1), worldUp, north));
  const rotation = new T.Quaternion().setFromRotationMatrix(connectionMatrix(floor, wall));
  // Facing north and looking 60° down, the top of the view points north and up.
  const viewUp = new T.Vector3(0, Math.cos(Math.PI / 3), -Math.sin(Math.PI / 3)).applyQuaternion(rotation);
  assert.ok(viewUp.y > 0.8, `exit view should be upright, got ${viewUp.toArray()}`);
});

test('a fold fits a surface only at rotations it has room for', () => {
  const upright = new T.Quaternion();
  const sideways = new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 0, 1), Math.PI / 2);
  const diagonal = new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 0, 1), Math.PI / 4);
  const narrow: PortalSurface = { ...makeSurface('narrow', [0, 2, 0]), width: 3.0, height: 4.2 };
  assert.ok(fitPortal(narrow, narrow.position, upright));
  assert.equal(fitPortal(narrow, narrow.position, sideways), null);
  // A square patch too small for upright or sideways folds still takes a diagonal one.
  const square: PortalSurface = { ...makeSurface('square', [0, 2, 0]), width: 3.5, height: 3.5 };
  assert.equal(surfaceCanHoldPortal(3.5, 3.5), true);
  assert.equal(surfaceCanHoldPortal(3.0, 3.0), false);
  assert.ok(fitPortal(square, square.position, diagonal));
  assert.equal(fitPortal(square, square.position, upright), null);
  // Default research anchors take every rotation.
  for (let angle = 0; angle < Math.PI; angle += Math.PI / 12) {
    const anchor: PortalSurface = { ...makeSurface('anchor', [0, 2, 0]), width: 4.0, height: 4.15 };
    assert.ok(fitPortal(anchor, anchor.position, new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 0, 1), angle)));
  }
  // Seating slides an off-centre fold back inside the rim.
  const edge = makeSurface('edge', [0, 2, 0]);
  assert.ok(seat(edge, new T.Vector3(5, 2, 0)).position.x <= 2 - 1.3 - 0.07 + 1e-9);
});

test('a view pointing straight up keeps its heading instead of resetting it', () => {
  const up = new T.Vector3(0, 1, 0);
  const camera = new T.PerspectiveCamera();
  camera.up.set(0, 0, 1);
  camera.lookAt(new T.Vector3(0, 1, 0));
  camera.updateMatrixWorld();
  const { yaw, pitch } = orientationInGravity(camera.quaternion, up);
  assert.ok(Math.abs(pitch - Math.PI / 2) < 1e-6);
  // The top of the view points south, so the body faces north.
  assert.ok(gravityBasis(up, yaw).forward.distanceTo(new T.Vector3(0, 0, -1)) < 1e-6);
});

test('aperture collision exclusion applies only to the backing surface inside the opening', () => {
  const pair = new PortalPair(new T.Scene());
  const a = makeSurface('a', [0, 2, 0]);
  const b = makeSurface('b', [25, 2, -30]);
  pair.portals[0].place(a, seat(a));
  pair.portals[1].place(b, seat(b));
  const body = player();
  assert.equal(pair.ignoresCollider(1, new T.Vector3(0, 2, 0.1), body), true);
  assert.equal(pair.ignoresCollider(999, new T.Vector3(0, 2, 0.1), body), false);
  assert.equal(pair.ignoresCollider(1, new T.Vector3(4, 2, 0.1), body), false);
  assert.equal(pair.ignoresCollider(1, new T.Vector3(0, 2, 6), body), false);
  pair.dispose();
});