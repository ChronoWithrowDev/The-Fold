import * as T from 'three';
import { PORTAL_HEIGHT, PORTAL_WIDTH } from './portals';

/** Soft round falloff shared by every glow in the game. It is white, so material or vertex colour tints it. */
export function createGlowTexture() {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const context = canvas.getContext('2d')!;
  const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.2, 'rgba(255,255,255,0.82)');
  gradient.addColorStop(0.52, 'rgba(255,255,255,0.22)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  const texture = new T.CanvasTexture(canvas);
  texture.colorSpace = T.SRGBColorSpace;
  return texture;
}

export interface ShotVisual {
  head: T.Sprite;
  last: T.Vector3;
  color: T.Color;
  busy: boolean;
}

const scratch = new T.Vector3();
const spread = new T.Vector3();

function randomUnit(target: T.Vector3) {
  const z = Math.random() * 2 - 1;
  const angle = Math.random() * Math.PI * 2;
  const radius = Math.sqrt(1 - z * z);
  return target.set(Math.cos(angle) * radius, Math.sin(angle) * radius, z);
}

/**
 * Every spark, trail mote, and burst in the world lives in one point cloud, so effects cost a single
 * draw call however busy the screen gets. Particles fade by darkening; with additive blending a black
 * particle is invisible, so no per-particle alpha is needed.
 */
export class FoldEffects {
  readonly glow = createGlowTexture();
  private readonly capacity = 480;
  private readonly position: Float32Array;
  private readonly color: Float32Array;
  private readonly size: Float32Array;
  private readonly velocity: Float32Array;
  private readonly tint: Float32Array;
  private readonly baseSize: Float32Array;
  private readonly age: Float32Array;
  private readonly life: Float32Array;
  private readonly drag: Float32Array;
  private readonly fall: Float32Array;
  private readonly geometry = new T.BufferGeometry();
  private readonly material: T.PointsMaterial;
  private readonly points: T.Points;
  private readonly shots: ShotVisual[] = [];
  private readonly shotMaterials: T.SpriteMaterial[] = [];
  private cursor = 0;
  private dirty = false;

  constructor(private readonly scene: T.Scene) {
    const n = this.capacity;
    this.position = new Float32Array(n * 3);
    this.color = new Float32Array(n * 3);
    this.size = new Float32Array(n);
    this.velocity = new Float32Array(n * 3);
    this.tint = new Float32Array(n * 3);
    this.baseSize = new Float32Array(n);
    this.age = new Float32Array(n);
    this.life = new Float32Array(n);
    this.drag = new Float32Array(n);
    this.fall = new Float32Array(n);
    this.geometry.setAttribute('position', new T.BufferAttribute(this.position, 3).setUsage(T.DynamicDrawUsage));
    this.geometry.setAttribute('color', new T.BufferAttribute(this.color, 3).setUsage(T.DynamicDrawUsage));
    this.geometry.setAttribute('aSize', new T.BufferAttribute(this.size, 1).setUsage(T.DynamicDrawUsage));
    this.material = new T.PointsMaterial({
      size: 1, map: this.glow, vertexColors: true, transparent: true, depthWrite: false,
      blending: T.AdditiveBlending, sizeAttenuation: true, toneMapped: false, fog: false,
    });
    this.material.onBeforeCompile = shader => {
      shader.vertexShader = shader.vertexShader
        .replace('uniform float size;', 'uniform float size;\nattribute float aSize;')
        .replace('gl_PointSize = size;', 'gl_PointSize = size * aSize;');
    };
    this.material.customProgramCacheKey = () => 'fold-particles';
    this.points = new T.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 4;
    scene.add(this.points);
  }

  emit(at: T.Vector3, velocity: T.Vector3, color: T.Color, size: number, life: number, drag = 2.5, fall = 0) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.capacity;
    const i3 = i * 3;
    this.position[i3] = at.x; this.position[i3 + 1] = at.y; this.position[i3 + 2] = at.z;
    this.velocity[i3] = velocity.x; this.velocity[i3 + 1] = velocity.y; this.velocity[i3 + 2] = velocity.z;
    this.tint[i3] = color.r; this.tint[i3 + 1] = color.g; this.tint[i3 + 2] = color.b;
    this.baseSize[i] = size;
    this.age[i] = 0;
    this.life[i] = life;
    this.drag[i] = drag;
    this.fall[i] = fall;
    this.dirty = true;
  }

  /** The glowing head of a fold shot. Its trail is laid down as particles while it moves. */
  launchShot(color: T.Color, from: T.Vector3): ShotVisual {
    let shot = this.shots.find(s => !s.busy);
    if (!shot) {
      if (this.shots.length >= 10) {
        shot = this.shots[0];
      } else {
        const material = new T.SpriteMaterial({ map: this.glow, color, blending: T.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false, fog: false });
        const coreMaterial = new T.SpriteMaterial({ map: this.glow, color: '#ffffff', blending: T.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false, fog: false });
        this.shotMaterials.push(material, coreMaterial);
        const head = new T.Sprite(material);
        head.scale.setScalar(0.4);
        const core = new T.Sprite(coreMaterial);
        core.scale.setScalar(0.28);
        head.add(core);
        head.renderOrder = 5;
        head.frustumCulled = false;
        this.scene.add(head);
        shot = { head, last: new T.Vector3(), color: new T.Color(), busy: false };
        this.shots.push(shot);
      }
    }
    shot.busy = true;
    shot.color.copy(color);
    shot.last.copy(from);
    (shot.head.material as T.SpriteMaterial).color.copy(color);
    shot.head.position.copy(from);
    shot.head.visible = true;
    for (let i = 0; i < 7; i++) this.emit(from, randomUnit(spread).multiplyScalar(0.4 + Math.random() * 0.9), color, 0.035 + Math.random() * 0.03, 0.16 + Math.random() * 0.1, 7);
    return shot;
  }

  moveShot(shot: ShotVisual, to: T.Vector3) {
    // Fast shots cover several metres a frame, so motes are dropped along the whole segment, not just at the head.
    const distance = shot.last.distanceTo(to);
    const steps = Math.min(16, Math.ceil(distance / 0.3));
    for (let s = 1; s <= steps; s++) {
      scratch.copy(shot.last).lerp(to, s / steps);
      this.emit(scratch, randomUnit(spread).multiplyScalar(0.12), shot.color, 0.1 + Math.random() * 0.04, 0.2 + Math.random() * 0.1, 3);
    }
    shot.head.position.copy(to);
    shot.last.copy(to);
  }

  endShot(shot: ShotVisual) {
    shot.busy = false;
    shot.head.visible = false;
  }

  /** A fold tearing open: sparks race outward from the rim across the surface, under a brief soft flash. */
  portalBurst(center: T.Vector3, orientation: T.Quaternion, color: T.Color) {
    const right = new T.Vector3(1, 0, 0).applyQuaternion(orientation);
    const up = new T.Vector3(0, 1, 0).applyQuaternion(orientation);
    const normal = new T.Vector3(0, 0, 1).applyQuaternion(orientation);
    const count = 44;
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + Math.random() * 0.12;
      const c = Math.cos(angle);
      const s = Math.sin(angle);
      scratch.copy(center).addScaledVector(right, c * PORTAL_WIDTH).addScaledVector(up, s * PORTAL_HEIGHT).addScaledVector(normal, 0.05);
      spread.copy(right).multiplyScalar(c).addScaledVector(up, s).multiplyScalar(0.7 + Math.random() * 1.6).addScaledVector(normal, Math.random() * 0.9);
      this.emit(scratch, spread, color, 0.07 + Math.random() * 0.07, 0.4 + Math.random() * 0.45, 2.4, 0.5);
    }
    scratch.copy(center).addScaledVector(normal, 0.12);
    this.emit(scratch, spread.set(0, 0, 0), color, 1.5, 0.18, 0);
  }

  /** A shot that cannot hold: a short grey puff of sparks off the surface, plus a dim flash. */
  fizzle(at: T.Vector3, normal: T.Vector3) {
    const grey = new T.Color(0.62, 0.68, 0.66);
    for (let i = 0; i < 16; i++) {
      spread.copy(normal).addScaledVector(randomUnit(scratch), 0.95).normalize().multiplyScalar(0.9 + Math.random() * 2.6);
      this.emit(scratch.copy(at).addScaledVector(normal, 0.03), spread, grey, 0.04 + Math.random() * 0.04, 0.22 + Math.random() * 0.25, 3, 7);
    }
    this.emit(scratch.copy(at).addScaledVector(normal, 0.05), spread.set(0, 0, 0), grey, 0.5, 0.15, 0);
  }

  update(dt: number) {
    if (!this.dirty || dt <= 0) return;
    let alive = 0;
    for (let i = 0; i < this.capacity; i++) {
      if (this.life[i] <= 0) continue;
      this.age[i] += dt;
      const t = this.age[i] / this.life[i];
      const i3 = i * 3;
      if (t >= 1) {
        this.life[i] = 0;
        this.size[i] = 0;
        this.color[i3] = this.color[i3 + 1] = this.color[i3 + 2] = 0;
        continue;
      }
      alive++;
      const damping = Math.exp(-this.drag[i] * dt);
      this.velocity[i3] *= damping;
      this.velocity[i3 + 1] = this.velocity[i3 + 1] * damping - this.fall[i] * dt;
      this.velocity[i3 + 2] *= damping;
      this.position[i3] += this.velocity[i3] * dt;
      this.position[i3 + 1] += this.velocity[i3 + 1] * dt;
      this.position[i3 + 2] += this.velocity[i3 + 2] * dt;
      const fade = (1 - t) * (1 - t);
      this.color[i3] = this.tint[i3] * fade;
      this.color[i3 + 1] = this.tint[i3 + 1] * fade;
      this.color[i3 + 2] = this.tint[i3 + 2] * fade;
      this.size[i] = this.baseSize[i] * (0.55 + 0.45 * (1 - t));
    }
    for (const name of ['position', 'color', 'aSize']) (this.geometry.getAttribute(name) as T.BufferAttribute).needsUpdate = true;
    // One extra pass after the last particle dies writes the zeroed sizes, then updates stop.
    this.dirty = alive > 0;
  }

  dispose() {
    this.scene.remove(this.points);
    this.shots.forEach(shot => this.scene.remove(shot.head));
    this.geometry.dispose();
    this.material.dispose();
    this.shotMaterials.forEach(material => material.dispose());
    this.glow.dispose();
  }
}
