import * as T from 'three';
import { connectionMatrix } from './portals';

export function runPortalMathChecks() {
  const checks: { name: string; passed: boolean }[] = [];
  const pose = (p: [number, number, number], n: [number, number, number]) => new T.Matrix4().compose(new T.Vector3(...p), new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 0, 1), new T.Vector3(...n)), new T.Vector3(1, 1, 1));
  const source = pose([0, 0, 0], [0, 0, 1]);
  const destination = pose([20, 4, -8], [-1, 0, 0]);
  const outward = connectionMatrix(source, destination);
  const backward = connectionMatrix(destination, source);
  const position = new T.Vector3(0.2, 0.4, -0.03);
  const roundTrip = position.clone().applyMatrix4(outward).applyMatrix4(backward);
  checks.push({ name: 'Position round trip', passed: roundTrip.distanceTo(position) < 1e-8 });
  const rotation = new T.Quaternion().setFromRotationMatrix(outward);
  const velocity = new T.Vector3(2.3, -16, -8);
  checks.push({ name: 'Momentum magnitude', passed: Math.abs(velocity.length() - velocity.clone().applyQuaternion(rotation).length()) < 1e-8 });
  const floor = pose([0, 0, 0], [0, 1, 0]);
  const wall = pose([0, 10, 20], [0, 0, 1]);
  const launch = new T.Quaternion().setFromRotationMatrix(connectionMatrix(floor, wall));
  const fall = new T.Vector3(0, -20, 0).applyQuaternion(launch);
  checks.push({ name: 'Floor-to-wall launch', passed: fall.distanceTo(new T.Vector3(0, 0, 20)) < 1e-8 });
  const orientation = new T.Quaternion().setFromEuler(new T.Euler(0.3, 1.2, -0.1));
  const restored = orientation.clone().premultiply(rotation).premultiply(new T.Quaternion().setFromRotationMatrix(backward));
  checks.push({ name: 'Camera orientation round trip', passed: Math.abs(restored.dot(orientation)) > 1 - 1e-8 });
  const exit = new T.Vector3(0, 0, -0.01).applyMatrix4(outward);
  checks.push({ name: 'Exit emerges on front side', passed: exit.clone().sub(new T.Vector3(20, 4, -8)).dot(new T.Vector3(-1, 0, 0)) > 0 });
  return checks;
}