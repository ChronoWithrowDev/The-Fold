import * as T from 'three';
import { PORTAL_BLUE } from './device';

export interface RobotPose {
  /** Capsule centre, as simulated; the robot's feet sit 0.9 m below it along "up". */
  position: T.Vector3;
  up: T.Vector3;
  heading: T.Vector3;
  /** Speed across the ground plane of the current gravity. */
  speed: number;
  grounded: boolean;
  holding: boolean;
  reducedMotion: boolean;
}

type Triple = [number, number, number];

/**
 * F-01, the field unit the player pilots: a ceramic survey robot in the same design language as the
 * F-02 device. It is hidden from the first-person camera but visible to portal cameras, so you can
 * watch yourself step through a fold — and, with recursion, a whole corridor of yourselves.
 * Rigid parts on pivots: a procedural walk cycle, a fall tuck with heel thrusters, and a carry pose.
 */
export class PlayerRobot {
  readonly group = new T.Group();
  private readonly body = new T.Group();
  private readonly head = new T.Group();
  private readonly armLeft = new T.Group();
  private readonly armRight = new T.Group();
  private readonly legLeft = new T.Group();
  private readonly legRight = new T.Group();
  private readonly thrusters: T.Sprite[] = [];
  private readonly visorMaterial: T.MeshBasicMaterial;
  private readonly coreMaterial: T.MeshBasicMaterial;
  private readonly gunGlow: T.MeshBasicMaterial;
  private readonly orientation = new T.Quaternion();
  private readonly disposables: { dispose(): void }[] = [];
  private phase = 0;
  private stride = 0;
  private air = 0;
  private hold = 0;
  private time = 0;

  constructor(glow: T.Texture) {
    const ceramic = this.keep(new T.MeshStandardMaterial({ color: '#e4e7dc', roughness: 0.34, metalness: 0.05 }));
    const shell = this.keep(new T.MeshStandardMaterial({ color: '#cfd4c6', roughness: 0.42, metalness: 0.08 }));
    const gunmetal = this.keep(new T.MeshStandardMaterial({ color: '#2b3431', roughness: 0.38, metalness: 0.7 }));
    const rubber = this.keep(new T.MeshStandardMaterial({ color: '#262d2a', roughness: 0.9, metalness: 0 }));
    const copper = this.keep(new T.MeshStandardMaterial({ color: '#b97b4d', roughness: 0.28, metalness: 0.9 }));
    this.visorMaterial = this.keep(new T.MeshBasicMaterial({ color: PORTAL_BLUE, toneMapped: false }));
    this.coreMaterial = this.keep(new T.MeshBasicMaterial({ color: PORTAL_BLUE, toneMapped: false }));
    this.gunGlow = this.keep(new T.MeshBasicMaterial({ color: PORTAL_BLUE, toneMapped: false }));

    const add = (parent: T.Object3D, geometry: T.BufferGeometry, material: T.Material, position: Triple, rotation?: Triple) => {
      this.keep(geometry);
      const mesh = new T.Mesh(geometry, material);
      mesh.position.set(...position);
      if (rotation) mesh.rotation.set(...rotation);
      mesh.castShadow = true;
      parent.add(mesh);
      return mesh;
    };
    const capsule = (radius: number, length: number) => new T.CapsuleGeometry(radius, length, 4, 12);
    const box = (w: number, h: number, d: number) => new T.BoxGeometry(w, h, d);

    // Pelvis and torso. The torso tapers up and out, with a glowing survey core in the chest.
    add(this.body, box(0.3, 0.14, 0.2), gunmetal, [0, 0.95, 0]);
    const chest = add(this.body, capsule(0.165, 0.26), ceramic, [0, 1.24, 0]);
    chest.scale.set(1.24, 1, 0.82);
    add(this.body, new T.TorusGeometry(0.052, 0.014, 8, 28), copper, [0, 1.3, 0.145]);
    add(this.body, new T.CircleGeometry(0.042, 24), this.coreMaterial, [0, 1.3, 0.152]);
    add(this.body, box(0.2, 0.2, 0.09), shell, [0, 1.24, -0.17]);
    add(this.body, new T.TorusGeometry(0.055, 0.012, 8, 28), copper, [0, 1.26, -0.218], [0, Math.PI, 0]);
    add(this.body, box(0.016, 0.09, 0.016), gunmetal, [0, 1.26, -0.225]);

    // Head: dome, full-width visor band, ear discs, and an antenna.
    add(this.head, new T.SphereGeometry(0.135, 24, 16), ceramic, [0, 0, 0]).scale.set(1, 0.9, 0.95);
    const visor = add(this.head, new T.TorusGeometry(0.117, 0.03, 10, 32, Math.PI * 1.1), this.visorMaterial, [0, 0.01, 0.006], [0, 0, Math.PI - Math.PI * 0.05]);
    visor.rotation.x = -Math.PI / 2;
    for (const side of [-1, 1]) add(this.head, new T.CylinderGeometry(0.045, 0.05, 0.025, 16), gunmetal, [side * 0.135, 0.01, 0], [0, 0, Math.PI / 2]);
    add(this.head, new T.CylinderGeometry(0.008, 0.012, 0.1, 8), gunmetal, [0.06, 0.16, -0.02]);
    add(this.head, new T.SphereGeometry(0.016, 10, 8), this.coreMaterial, [0.06, 0.215, -0.02]);
    this.head.position.set(0, 1.56, 0);
    this.body.add(this.head);

    // Arms hang from shoulder pivots; mitt hands in rubber.
    for (const [arm, side] of [[this.armLeft, -1], [this.armRight, 1]] as const) {
      arm.position.set(side * 0.26, 1.4, 0);
      add(arm, new T.SphereGeometry(0.07, 14, 10), shell, [0, 0, 0]);
      add(arm, capsule(0.048, 0.16), ceramic, [side * 0.01, -0.15, 0]);
      add(arm, new T.SphereGeometry(0.05, 12, 8), gunmetal, [side * 0.015, -0.28, 0]);
      add(arm, capsule(0.042, 0.14), shell, [side * 0.02, -0.4, 0]);
      add(arm, box(0.085, 0.1, 0.1), rubber, [side * 0.022, -0.53, 0.01]);
      this.body.add(arm);
    }

    // F-02 in the right hand: a compact copy of the first-person device, built barrel-forward along +z,
    // then turned so the barrel runs down the forearm (-y), which the aiming pose points ahead.
    const gun = new T.Group();
    add(gun, new T.CylinderGeometry(0.048, 0.056, 0.24, 18), ceramic, [0, 0, 0], [Math.PI / 2, 0, 0]);
    add(gun, new T.TorusGeometry(0.052, 0.007, 6, 22), gunmetal, [0, 0, -0.06]);
    add(gun, new T.CylinderGeometry(0.034, 0.046, 0.08, 18), gunmetal, [0, 0, 0.15], [Math.PI / 2, 0, 0]);
    add(gun, new T.TorusGeometry(0.033, 0.007, 6, 22), copper, [0, 0, 0.192]);
    add(gun, new T.CircleGeometry(0.027, 18), this.gunGlow, [0, 0, 0.194]);
    for (let i = 0; i < 3; i++) {
      const angle = (i * Math.PI * 2) / 3 + Math.PI / 2;
      add(gun, box(0.012, 0.012, 0.09), ceramic, [Math.cos(angle) * 0.048, Math.sin(angle) * 0.048, 0.215]);
      add(gun, new T.SphereGeometry(0.009, 8, 6), this.gunGlow, [Math.cos(angle) * 0.044, Math.sin(angle) * 0.044, 0.262]);
    }
    add(gun, box(0.028, 0.02, 0.12), gunmetal, [0, 0.058, -0.01]);
    add(gun, box(0.01, 0.006, 0.05), this.gunGlow, [0, 0.07, 0.02]);
    add(gun, box(0.03, 0.075, 0.04), rubber, [0, -0.07, -0.05], [-0.3, 0, 0]);
    gun.rotation.x = Math.PI / 2;
    gun.position.set(0.02, -0.57, 0.03);
    this.armRight.add(gun);

    // Legs from hip pivots, with flared shin guards and broad foot pads.
    for (const [leg, side] of [[this.legLeft, -1], [this.legRight, 1]] as const) {
      leg.position.set(side * 0.1, 0.9, 0);
      add(leg, capsule(0.06, 0.2), shell, [0, -0.19, 0]);
      add(leg, new T.SphereGeometry(0.058, 12, 8), gunmetal, [0, -0.36, 0.01]);
      const shin = add(leg, new T.CylinderGeometry(0.044, 0.062, 0.3, 12), ceramic, [0, -0.54, 0]);
      shin.rotation.x = 0.04;
      add(leg, box(0.12, 0.07, 0.22), rubber, [0, -0.845, 0.035]);
      add(leg, box(0.1, 0.03, 0.06), this.coreMaterial, [0, -0.86, -0.07]);
      // Heel thruster, visible only while airborne.
      const thruster = new T.Sprite(this.keep(new T.SpriteMaterial({ map: glow, color: PORTAL_BLUE, blending: T.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false })));
      thruster.position.set(0, -0.92, -0.05);
      thruster.scale.setScalar(0.22);
      thruster.visible = false;
      leg.add(thruster);
      this.thrusters.push(thruster);
      this.body.add(leg);
    }

    this.group.add(this.body);
    this.group.visible = false;
  }

  private keep<D extends { dispose(): void }>(resource: D): D {
    this.disposables.push(resource);
    return resource;
  }

  update(dt: number, pose: RobotPose) {
    this.time += dt;
    const ease = (rate: number) => (dt > 0 ? 1 - Math.exp(-rate * dt) : 0);

    // Feet at the bottom of the capsule, oriented to the current gravity and heading.
    this.group.position.copy(pose.position).addScaledVector(pose.up, -0.9);
    const right = pose.up.clone().cross(pose.heading).normalize();
    this.orientation.setFromRotationMatrix(new T.Matrix4().makeBasis(right, pose.up, pose.heading.clone()));
    this.group.quaternion.slerp(this.orientation, ease(10));

    const calm = pose.reducedMotion;
    this.stride += (T.MathUtils.clamp(pose.speed / 5.1, 0, 1.3) * (pose.grounded ? 1 : 0) - this.stride) * ease(8);
    this.air += ((pose.grounded ? 0 : 1) - this.air) * ease(6);
    this.hold += ((pose.holding ? 1 : 0) - this.hold) * ease(8);
    this.phase += dt * (4.5 + pose.speed * 1.9);

    const swing = calm ? 0 : Math.sin(this.phase) * 0.62 * this.stride;
    // Airborne, the legs split into a tuck and the arms lift away from the body.
    this.legLeft.rotation.x = swing + this.air * 0.5;
    this.legRight.rotation.x = -swing - this.air * 0.28;
    // The right arm keeps the device aimed ahead; the left steadies it, then lifts higher to carry a core.
    this.armRight.rotation.x = -1.38 + swing * 0.08 - this.air * 0.15;
    this.armRight.rotation.z = -0.04;
    this.armLeft.rotation.x = -0.95 - swing * 0.1 - this.hold * 0.3 - this.air * 0.2;
    this.armLeft.rotation.z = 0.42 - this.hold * 0.3;

    const bob = calm ? 0 : Math.abs(Math.cos(this.phase)) * 0.035 * this.stride;
    this.body.position.y = -bob + this.air * -0.04;
    this.body.rotation.z = calm ? 0 : Math.sin(this.phase) * 0.035 * this.stride;
    this.body.rotation.x = this.stride * 0.06 + this.air * -0.1;
    this.head.rotation.x = -this.body.rotation.x * 0.7;

    const pulse = 0.85 + (calm ? 0 : Math.sin(this.time * 4.2) * 0.12);
    this.coreMaterial.color.copy(PORTAL_BLUE).multiplyScalar(pulse);
    for (const thruster of this.thrusters) {
      thruster.visible = this.air > 0.25;
      const flicker = calm ? 1 : 0.8 + Math.sin(this.time * 31 + thruster.position.x) * 0.2;
      thruster.scale.setScalar(0.14 + this.air * 0.14 * flicker);
    }
  }

  /** The held device glows in the colour of the last fold fired, like the first-person one. */
  setTint(color: T.Color) {
    this.gunGlow.color.copy(color);
  }

  dispose() {
    this.disposables.forEach(resource => resource.dispose());
  }
}
