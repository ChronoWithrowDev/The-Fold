import * as T from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export interface DeviceState {
  walking: boolean;
  speed: number;
  /** Speed along "up" for the current gravity. Negative while falling. */
  verticalSpeed: number;
  /** How far the view turned since the previous frame, in radians. */
  lookYaw: number;
  lookPitch: number;
  portals: readonly [boolean, boolean];
  holding: boolean;
  gravityMode: number;
  gravityUnlocked: boolean;
  reducedMotion: boolean;
}

export const PORTAL_BLUE = new T.Color('#4fb6f2');
export const PORTAL_ORANGE = new T.Color('#f29a4a');

/** Resting pose in view space: low and to the right, angled slightly in toward the crosshair. */
const REST = new T.Vector3(0.19, -0.165, -0.43);
const REST_PITCH = 0.015;
const REST_YAW = 0.075;

type Triple = [number, number, number];

/**
 * F-02, the spatial field device. Built from turned and rounded parts rather than boxes: a ceramic
 * shell, a glass core chamber with a spinning crystal, three emitter prongs that flare when a fold is
 * fired, status lights for each anchored endpoint, and a dial that tracks the Vector Shifter.
 */
export class FieldDevice {
  readonly group = new T.Group();
  readonly muzzle = new T.Object3D();
  private readonly core: T.Mesh;
  private readonly lattice: T.Mesh;
  private readonly glowMaterial: T.MeshBasicMaterial;
  private readonly coreMaterial: T.MeshBasicMaterial;
  private readonly latticeMaterial: T.MeshBasicMaterial;
  private readonly ledBlue: T.MeshBasicMaterial;
  private readonly ledOrange: T.MeshBasicMaterial;
  private readonly prongs: T.Group[] = [];
  private readonly needle = new T.Group();
  private readonly flashSprite: T.Sprite;
  private readonly glowColor = PORTAL_BLUE.clone();
  private readonly targetColor = PORTAL_BLUE.clone();
  private readonly sway = new T.Vector2();
  private readonly disposables: { dispose(): void }[] = [];
  private time = 0;
  private phase = 0;
  private walk = 0;
  private recoil = 0;
  private flare = 0;
  private flash = 0;
  private shake = 0;
  private wobble = 0;
  private hold = 0;
  private needleAngle = 0;
  private lastGravity = 0;

  constructor(glow: T.Texture) {
    const ceramic = this.keep(new T.MeshStandardMaterial({ color: '#e8eae0', roughness: 0.3, metalness: 0.04 }));
    const gunmetal = this.keep(new T.MeshStandardMaterial({ color: '#2b3431', roughness: 0.34, metalness: 0.74 }));
    const polymer = this.keep(new T.MeshStandardMaterial({ color: '#1f2623', roughness: 0.62, metalness: 0.08 }));
    const copper = this.keep(new T.MeshStandardMaterial({ color: '#b97b4d', roughness: 0.25, metalness: 0.92 }));
    const rubber = this.keep(new T.MeshStandardMaterial({ color: '#262d2a', roughness: 0.9, metalness: 0 }));
    const glass = this.keep(new T.MeshStandardMaterial({ color: '#d5efe6', roughness: 0.04, metalness: 0.1, transparent: true, opacity: 0.24, depthWrite: false }));
    const white = this.keep(new T.MeshBasicMaterial({ color: '#f2fff9', toneMapped: false }));
    this.glowMaterial = this.keep(new T.MeshBasicMaterial({ color: PORTAL_BLUE, toneMapped: false }));
    this.coreMaterial = this.keep(new T.MeshBasicMaterial({ color: PORTAL_BLUE, toneMapped: false }));
    this.latticeMaterial = this.keep(new T.MeshBasicMaterial({ color: PORTAL_BLUE, wireframe: true, transparent: true, opacity: 0.35, toneMapped: false }));
    this.ledBlue = this.keep(new T.MeshBasicMaterial({ color: PORTAL_BLUE, toneMapped: false }));
    this.ledOrange = this.keep(new T.MeshBasicMaterial({ color: PORTAL_ORANGE, toneMapped: false }));

    const add = (geometry: T.BufferGeometry, material: T.Material, position?: Triple, rotation?: Triple, parent: T.Object3D = this.group) => {
      this.keep(geometry);
      const mesh = new T.Mesh(geometry, material);
      if (position) mesh.position.set(...position);
      if (rotation) mesh.rotation.set(...rotation);
      parent.add(mesh);
      return mesh;
    };
    // Lathe profiles are written as (radius, distance forward); the turned axis then runs along -Z.
    const turned = (profile: [number, number][], segments = 44) => {
      const geometry = new T.LatheGeometry(profile.map(([radius, length]) => new T.Vector2(radius, length)), segments);
      geometry.rotateX(-Math.PI / 2);
      return geometry;
    };
    const rounded = (width: number, height: number, depth: number, radius = 0.006) => new RoundedBoxGeometry(width, height, depth, 3, radius);
    const tube = (points: Triple[], radius: number) => new T.TubeGeometry(new T.CatmullRomCurve3(points.map(p => new T.Vector3(...p))), 28, radius, 7, false);

    // Ceramic shell, rear cap to core chamber.
    add(turned([[0, 0], [0.05, 0.003], [0.074, 0.016], [0.086, 0.04], [0.09, 0.075], [0.09, 0.2], [0.087, 0.235], [0.08, 0.26], [0.07, 0.28], [0.066, 0.3]]), ceramic, [0, 0, 0.17]);
    for (const z of [0.1, -0.03]) add(new T.TorusGeometry(0.0905, 0.0045, 8, 56), gunmetal, [0, 0, z]);
    for (const side of [-1, 1]) add(rounded(0.006, 0.014, 0.12, 0.003), this.glowMaterial, [side * 0.088, -0.018, 0.035]);

    // Core chamber: a glass sleeve held in a copper-ringed cage, with the crystal turning inside.
    add(new T.CylinderGeometry(0.052, 0.052, 0.12, 28, 1, true).rotateX(Math.PI / 2), glass, [0, 0, -0.19]);
    for (const z of [-0.128, -0.252]) add(new T.TorusGeometry(0.062, 0.007, 8, 44), copper, [0, 0, z]);
    for (let i = 0; i < 4; i++) {
      const angle = Math.PI / 4 + (i * Math.PI) / 2;
      add(rounded(0.009, 0.009, 0.13, 0.003), gunmetal, [Math.cos(angle) * 0.064, Math.sin(angle) * 0.064, -0.19]);
    }
    // End plates seal the shell and housing where they meet the glass, so the chamber never shows a hollow tube.
    add(new T.CircleGeometry(0.066, 32).rotateY(Math.PI), gunmetal, [0, 0, -0.1305]);
    add(new T.CircleGeometry(0.066, 32), gunmetal, [0, 0, -0.2495]);
    this.core = add(new T.OctahedronGeometry(0.028, 0), this.coreMaterial, [0, 0, -0.19]);
    this.lattice = add(new T.IcosahedronGeometry(0.042, 0), this.latticeMaterial, [0, 0, -0.19]);

    // Emitter housing, muzzle, and the glowing aperture.
    add(turned([[0.066, 0], [0.074, 0.012], [0.074, 0.05], [0.066, 0.08], [0.054, 0.104], [0.047, 0.112], [0, 0.112]]), gunmetal, [0, 0, -0.25]);
    add(new T.TorusGeometry(0.046, 0.0075, 8, 44), copper, [0, 0, -0.358]);
    add(new T.CircleGeometry(0.039, 32).rotateY(Math.PI), this.glowMaterial, [0, 0, -0.3632]);
    add(new T.RingGeometry(0.019, 0.025, 32).rotateY(Math.PI), white, [0, 0, -0.3642]);
    this.muzzle.position.set(0, 0, -0.375);
    this.group.add(this.muzzle);

    // Three prongs hinge at the housing and curve in toward the aperture. Firing flares them open.
    for (let i = 0; i < 3; i++) {
      const arm = new T.Group();
      arm.rotation.z = (i * Math.PI * 2) / 3;
      const hinge = new T.Group();
      hinge.position.set(0, 0.07, -0.27);
      arm.add(hinge);
      add(rounded(0.026, 0.02, 0.042, 0.005), gunmetal, [0, 0.004, 0.006], undefined, hinge);
      add(tube([[0, 0, 0], [0, 0.022, -0.05], [0, 0.017, -0.115], [0, -0.011, -0.17]], 0.0085), ceramic, undefined, undefined, hinge);
      add(new T.SphereGeometry(0.0115, 12, 8), this.glowMaterial, [0, -0.011, -0.17], undefined, hinge);
      this.group.add(arm);
      this.prongs.push(hinge);
    }

    // Top rail with a status light per fold, and a small ring sight.
    add(rounded(0.05, 0.026, 0.17, 0.007), gunmetal, [0, 0.096, 0.035]);
    add(rounded(0.013, 0.008, 0.026, 0.003), this.ledBlue, [-0.013, 0.112, 0.085]);
    add(rounded(0.013, 0.008, 0.026, 0.003), this.ledOrange, [0.013, 0.112, 0.085]);
    add(rounded(0.006, 0.02, 0.006, 0.002), gunmetal, [0, 0.108, -0.02]);
    add(new T.TorusGeometry(0.011, 0.0028, 6, 22), copper, [0, 0.118, -0.02]);

    // Right side: the gravity dial. Its needle points at the Vector Shifter's current direction.
    add(new T.CylinderGeometry(0.024, 0.024, 0.012, 28).rotateZ(Math.PI / 2), gunmetal, [0.093, 0.025, 0.02]);
    add(new T.TorusGeometry(0.024, 0.003, 6, 28).rotateY(Math.PI / 2), copper, [0.0995, 0.025, 0.02]);
    this.needle.position.set(0.1, 0.025, 0.02);
    add(rounded(0.003, 0.018, 0.003, 0.001), this.glowMaterial, [0, 0.008, 0], undefined, this.needle);
    this.group.add(this.needle);

    // Left side vents.
    for (let i = 0; i < 5; i++) add(rounded(0.004, 0.032, 0.008, 0.0015), polymer, [-0.0895, 0, 0.06 - i * 0.022]);

    // Grip, trigger, and trigger guard.
    const grip = add(rounded(0.048, 0.14, 0.064, 0.012), rubber, [0, -0.12, 0.08], [-0.32, 0, 0]);
    for (let i = 0; i < 4; i++) add(rounded(0.05, 0.008, 0.012, 0.003), polymer, [0, -0.045 + i * 0.026, -0.03], undefined, grip);
    add(new T.TorusGeometry(0.028, 0.0045, 6, 18, Math.PI), gunmetal, [0, -0.075, 0.02], [Math.PI, Math.PI / 2, 0]);
    add(rounded(0.008, 0.026, 0.01, 0.003), polymer, [0, -0.072, 0.012], [-0.25, 0, 0]);

    // Power cell under the barrel, with its charge strip.
    add(rounded(0.072, 0.046, 0.15, 0.01), polymer, [0, -0.088, -0.095]);
    add(rounded(0.004, 0.012, 0.1, 0.002), this.glowMaterial, [0.0375, -0.088, -0.095]);

    // Feed lines from the cell to the core chamber.
    add(tube([[0.028, -0.07, 0.13], [0.05, -0.095, 0.05], [0.05, -0.085, -0.06], [0.045, -0.055, -0.15]], 0.0065), copper);
    add(tube([[-0.028, -0.07, 0.13], [-0.05, -0.095, 0.05], [-0.05, -0.085, -0.06], [-0.045, -0.055, -0.15]], 0.0065), polymer);

    const flashMaterial = this.keep(new T.SpriteMaterial({ map: glow, color: PORTAL_BLUE, blending: T.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false, opacity: 0 }));
    this.flashSprite = new T.Sprite(flashMaterial);
    this.flashSprite.visible = false;
    this.muzzle.add(this.flashSprite);

    this.group.position.copy(REST);
    this.group.rotation.set(REST_PITCH, REST_YAW, 0);
  }

  private keep<D extends { dispose(): void }>(resource: D): D {
    this.disposables.push(resource);
    return resource;
  }

  fire(index: number) {
    this.targetColor.copy(index === 0 ? PORTAL_BLUE : PORTAL_ORANGE);
    this.glowColor.copy(this.targetColor);
    this.flash = 1;
    this.recoil = 1;
    this.flare = 1;
  }

  /** A refused shot: a brief sideways shudder instead of a kick. */
  deny() {
    this.shake = 1;
  }

  muzzleWorld(target: T.Vector3) {
    this.muzzle.updateWorldMatrix(true, false);
    return this.muzzle.getWorldPosition(target);
  }

  update(dt: number, state: DeviceState) {
    this.time += dt;
    const calm = state.reducedMotion;
    const ease = (rate: number) => 1 - Math.exp(-rate * dt);
    this.recoil *= Math.exp(-dt * 11);
    this.flare *= Math.exp(-dt * 6.5);
    this.flash *= Math.exp(-dt * 7.5);
    this.shake *= Math.exp(-dt * 9);
    this.wobble *= Math.exp(-dt * 3.2);
    if (state.gravityMode !== this.lastGravity) {
      this.lastGravity = state.gravityMode;
      if (!calm) this.wobble = 1;
    }
    this.hold += ((state.holding ? 1 : 0) - this.hold) * ease(8);
    this.walk += ((state.walking ? Math.min(1.4, state.speed / 5.1) : 0) - this.walk) * ease(7);
    this.phase += dt * (6.2 + this.walk * 3.6);

    // The device lags a touch behind the view when you turn, then catches up.
    const swayX = calm ? 0 : T.MathUtils.clamp(-state.lookYaw * 1.6, -0.09, 0.09);
    const swayY = calm ? 0 : T.MathUtils.clamp(state.lookPitch * 1.6, -0.07, 0.07);
    this.sway.x += (swayX - this.sway.x) * ease(9);
    this.sway.y += (swayY - this.sway.y) * ease(9);
    const stride = calm ? 0 : this.walk;
    const bobX = Math.sin(this.phase) * 0.0075 * stride;
    const bobY = -Math.abs(Math.cos(this.phase)) * 0.0065 * stride;
    const breathe = calm ? 0 : Math.sin(this.time * 1.7) * 0.0018;
    // Falling lifts the device slightly, so speed reads in the hands as well as the world.
    const lift = calm ? 0 : T.MathUtils.clamp(-state.verticalSpeed * 0.0018, -0.025, 0.03);
    const shudder = Math.sin(this.time * 70) * this.shake;
    this.group.position.set(
      REST.x + bobX + this.sway.x * 0.35 + shudder * 0.004,
      REST.y + bobY + breathe + lift - this.hold * 0.045 + this.sway.y * 0.25,
      REST.z + this.recoil * 0.065 + this.hold * 0.03,
    );
    this.group.rotation.set(
      REST_PITCH + this.recoil * 0.14 + this.sway.y * 0.9 + this.hold * 0.22,
      REST_YAW + this.sway.x * 1.1 - this.hold * 0.12 + shudder * 0.02,
      this.sway.x * 0.7 - bobX * 2.2 + Math.sin(this.time * 17) * this.wobble * 0.1,
    );

    // Core, lattice, and every glowing part follow the colour of the last fold fired.
    this.core.rotation.y += dt * (1.3 + this.flash * 12);
    this.core.rotation.x += dt * 0.55;
    this.lattice.rotation.y -= dt * (0.5 + this.flash * 5);
    this.lattice.rotation.z += dt * 0.3;
    const pulse = 1 + (calm ? 0 : Math.sin(this.time * 4.2) * 0.05) + this.flash * 0.3;
    this.core.scale.set(pulse, pulse, pulse * 1.6);
    this.glowColor.lerp(this.targetColor, ease(6));
    this.glowMaterial.color.copy(this.glowColor).multiplyScalar(0.6 + this.flash * 0.85);
    this.coreMaterial.color.copy(this.glowColor).multiplyScalar(0.82 + this.flash * 1.2);
    this.latticeMaterial.color.copy(this.glowColor);
    this.ledBlue.color.copy(PORTAL_BLUE).multiplyScalar(state.portals[0] ? 0.95 : 0.14);
    this.ledOrange.color.copy(PORTAL_ORANGE).multiplyScalar(state.portals[1] ? 0.95 : 0.14);
    this.prongs.forEach((hinge, i) => {
      hinge.rotation.x = this.flare * 0.34 + (calm ? 0 : Math.sin(this.time * 2.1 + i * 2.1) * 0.012);
    });
    const needleTarget = state.gravityUnlocked ? state.gravityMode * (Math.PI / 3) : 0;
    this.needleAngle += (needleTarget - this.needleAngle) * ease(8);
    this.needle.rotation.x = -this.needleAngle;

    const flashMaterial = this.flashSprite.material as T.SpriteMaterial;
    flashMaterial.opacity = Math.min(1, this.flash * this.flash * 1.15);
    flashMaterial.color.copy(this.glowColor);
    this.flashSprite.scale.setScalar(0.06 + this.flash * 0.12);
    this.flashSprite.visible = this.flash > 0.02;
  }

  dispose() {
    this.disposables.forEach(resource => resource.dispose());
  }
}
