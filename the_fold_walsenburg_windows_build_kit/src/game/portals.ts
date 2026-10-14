import * as T from 'three';
import type { Body, PortalSurface, Quality } from './types';
import { QUALITY_CONFIG } from './types';

export const PORTAL_WIDTH = 1.3;
export const PORTAL_HEIGHT = 1.85;
/** Clear space kept between a fold's rim and the edge of the surface holding it. */
export const PORTAL_MARGIN = 0.07;
/** How far an open fold sits in front of its surface, so it never z-fights the wall behind it. */
const SURFACE_OFFSET = 0.026;
const FLIP = new T.Matrix4().makeRotationY(Math.PI);
const unitScale = new T.Vector3(1, 1, 1);
const X_AXIS = new T.Vector3(1, 0, 0);
const Y_AXIS = new T.Vector3(0, 1, 0);

export interface PortalPlacement {
  position: T.Vector3;
  quaternion: T.Quaternion;
}

export function connectionMatrix(source: T.Matrix4, destination: T.Matrix4) {
  return destination.clone().multiply(FLIP).multiply(source.clone().invert());
}

/**
 * The in-plane rotation of a new fold, chosen relative to whoever fires it. Walls stay upright to the
 * shooter's own gravity. Floors and ceilings have no "up" of their own, so their top edge points the
 * way the shooter is facing. "Floor" means floor to you: standing on a wall, the wall is the floor.
 */
export function orientPortal(normal: T.Vector3, gravityUp: T.Vector3, heading: T.Vector3) {
  const level = Math.abs(normal.dot(gravityUp)) > 0.98;
  const up = (level ? heading : gravityUp).clone();
  up.addScaledVector(normal, -up.dot(normal));
  if (up.lengthSq() < 1e-6) {
    // Only reachable when the hint runs along the normal; any stable in-plane axis will do.
    up.copy(Math.abs(normal.y) < 0.9 ? Y_AXIS : new T.Vector3(0, 0, -1));
    up.addScaledVector(normal, -up.dot(normal));
  }
  up.normalize();
  const right = up.clone().cross(normal).normalize();
  up.crossVectors(normal, right);
  return new T.Quaternion().setFromRotationMatrix(new T.Matrix4().makeBasis(right, up, normal));
}

/** Half-width of a fold's elliptical rim, measured along a direction lying in its plane. */
export function portalExtent(orientation: T.Quaternion, direction: T.Vector3) {
  const across = X_AXIS.clone().applyQuaternion(orientation).dot(direction);
  const along = Y_AXIS.clone().applyQuaternion(orientation).dot(direction);
  return Math.hypot(PORTAL_WIDTH * across, PORTAL_HEIGHT * along);
}

/**
 * Seats a fold on its surface at a fixed rotation, sliding it inward until its whole rim lies on the
 * surface. Returns null when the surface is too small for the fold at that rotation.
 */
export function fitPortal(surface: PortalSurface, point: T.Vector3, orientation: T.Quaternion): PortalPlacement | null {
  const right = X_AXIS.clone().applyQuaternion(surface.quaternion);
  const up = Y_AXIS.clone().applyQuaternion(surface.quaternion);
  const reachX = surface.width / 2 - portalExtent(orientation, right) - PORTAL_MARGIN;
  const reachY = surface.height / 2 - portalExtent(orientation, up) - PORTAL_MARGIN;
  if (reachX < -1e-4 || reachY < -1e-4) return null;
  const offset = point.clone().sub(surface.position);
  const x = T.MathUtils.clamp(offset.dot(right), -Math.max(0, reachX), Math.max(0, reachX));
  const y = T.MathUtils.clamp(offset.dot(up), -Math.max(0, reachY), Math.max(0, reachY));
  return {
    position: surface.position.clone().addScaledVector(right, x).addScaledVector(up, y).addScaledVector(surface.normal, SURFACE_OFFSET),
    quaternion: orientation.clone(),
  };
}

/** Whether a fold fits a width-by-height surface at any rotation at all. */
export function surfaceCanHoldPortal(width: number, height: number) {
  const x = width / 2 - PORTAL_MARGIN;
  const y = height / 2 - PORTAL_MARGIN;
  if (Math.min(x, y) < PORTAL_WIDTH) return false;
  // With u = sin²(angle), the squared half-extents are a² + (b² − a²)u across and b² − (b² − a²)u up.
  const a2 = PORTAL_WIDTH ** 2;
  const b2 = PORTAL_HEIGHT ** 2;
  const lowest = Math.max(0, (b2 - y * y) / (b2 - a2));
  const highest = Math.min(1, (x * x - a2) / (b2 - a2));
  return lowest <= highest + 1e-9;
}

/** Metres the rim glow reaches inside and outside the aperture's edge. */
const RIM_INSIDE = 0.075;
const RIM_OUTSIDE = 0.14;

/**
 * A band that follows the elliptical rim at constant thickness. Scaling a circular ring would make the
 * band fatter along the long axis; offsetting along the true ellipse normal keeps it even all round.
 * aBand is the signed distance from the rim in metres; aAround runs 0..1 around the circumference.
 */
function rimBand(segments = 144) {
  const positions: number[] = [];
  const band: number[] = [];
  const around: number[] = [];
  const index: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = (i / segments) * Math.PI * 2;
    const ex = PORTAL_WIDTH * Math.cos(t);
    const ey = PORTAL_HEIGHT * Math.sin(t);
    let nx = Math.cos(t) / PORTAL_WIDTH;
    let ny = Math.sin(t) / PORTAL_HEIGHT;
    const length = Math.hypot(nx, ny);
    nx /= length;
    ny /= length;
    positions.push(ex - nx * RIM_INSIDE, ey - ny * RIM_INSIDE, 0, ex + nx * RIM_OUTSIDE, ey + ny * RIM_OUTSIDE, 0);
    band.push(-RIM_INSIDE, RIM_OUTSIDE);
    around.push(i / segments, i / segments);
    if (i < segments) {
      const a = i * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('aBand', new T.Float32BufferAttribute(band, 1));
  geometry.setAttribute('aAround', new T.Float32BufferAttribute(around, 1));
  geometry.setIndex(index);
  return geometry;
}

const NOISE_GLSL = `
  float foldHash( float n ) { return fract( sin( n ) * 43758.5453123 ); }
  float foldNoise( float x ) { float i = floor( x ); float f = fract( x ); f = f * f * ( 3.0 - 2.0 * f ); return mix( foldHash( i ), foldHash( i + 1.0 ), f ); }
  float foldHash2( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
  float foldNoise2( vec2 p ) {
    vec2 i = floor( p ); vec2 f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );
    return mix( mix( foldHash2( i ), foldHash2( i + vec2( 1.0, 0.0 ) ), f.x ), mix( foldHash2( i + vec2( 0.0, 1.0 ) ), foldHash2( i + vec2( 1.0, 1.0 ) ), f.x ), f.y );
  }`;

function rimMaterial(tint: T.Color) {
  return new T.ShaderMaterial({
    uniforms: { tint: { value: tint.clone() }, time: { value: 0 }, flash: { value: 0 }, opacity: { value: 1 } },
    vertexShader: `attribute float aBand; attribute float aAround; varying float vBand; varying float vAround;
      void main() { vBand = aBand; vAround = aAround; gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }`,
    fragmentShader: `uniform vec3 tint; uniform float time; uniform float flash; uniform float opacity;
      varying float vBand; varying float vAround;
      ${NOISE_GLSL}
      void main() {
        float d = vBand;
        float edge = exp( - pow( d / 0.016, 2.0 ) );
        float inner = smoothstep( -0.075, 0.0, d ) * ( 1.0 - step( 0.0, d ) );
        float outer = step( 0.0, d ) * exp( - d / 0.042 );
        float flow = foldNoise( vAround * 38.0 - time * 1.5 ) * 0.62 + foldNoise( vAround * 91.0 + time * 2.7 ) * 0.38;
        float pulse = 0.88 + 0.12 * sin( time * 3.1 + vAround * 18.8496 );
        float glow = ( edge * 0.86 + inner * 0.3 * ( 0.55 + flow ) + outer * 0.38 * ( 0.45 + flow ) ) * pulse * ( 1.0 + flash * 1.3 ) * opacity;
        vec3 color = mix( tint, vec3( 1.0 ), clamp( edge * 0.32 + flash * 0.18, 0.0, 1.0 ) );
        gl_FragColor = vec4( color * glow, 1.0 );
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthWrite: false,
    blending: T.AdditiveBlending,
    toneMapped: false,
  });
}

export class FoldPortal {
  readonly group = new T.Group();
  readonly normal = new T.Vector3(0, 0, 1);
  // Half-float keeps the destination's highlights unclipped until the portal surface tone-maps them,
  // so a view through a fold matches the same view seen directly. Two targets ping-pong so a pass can
  // show this fold's own deeper view (recursion) without sampling the texture it is writing.
  readonly targets = [0, 1].map(() => new T.WebGLRenderTarget(768, 512, { type: T.HalfFloatType, minFilter: T.LinearFilter, magFilter: T.LinearFilter, depthBuffer: true, stencilBuffer: false }));
  private readIndex = 0;
  readonly camera = new T.PerspectiveCamera();
  readonly surfaceMaterial: T.ShaderMaterial;
  surface: PortalSurface | null = null;
  active = false;
  age = 0;
  private readonly tint: T.Color;
  private readonly rim: T.Mesh<T.BufferGeometry, T.ShaderMaterial>;
  private readonly halo: T.Mesh<T.BufferGeometry, T.ShaderMaterial>;
  private flash = 0;
  private linkAge = 0;
  private closingRims: { mesh: T.Mesh<T.BufferGeometry, T.ShaderMaterial>; age: number }[] = [];

  constructor(readonly index: number, private scene: T.Scene) {
    this.tint = new T.Color(index === 0 ? 0x4fb6f2 : 0xf29a4a);
    this.surfaceMaterial = new T.ShaderMaterial({
      uniforms: {
        viewMap: { value: this.targets[0].texture }, linked: { value: 0 }, iris: { value: 0 },
        tint: { value: this.tint.clone() }, time: { value: 0 }, flash: { value: 0 },
      },
      vertexShader: `varying vec4 clipPosition; varying vec2 localUv;
        void main() { localUv = uv; clipPosition = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); gl_Position = clipPosition; }`,
      fragmentShader: `uniform sampler2D viewMap; uniform float linked; uniform float iris; uniform vec3 tint; uniform float time; uniform float flash;
        varying vec4 clipPosition; varying vec2 localUv;
        ${NOISE_GLSL}
        void main() {
          vec2 p = localUv * 2.0 - 1.0;
          float r = length( p );
          float a = atan( p.y, p.x );
          // Unlinked: a slow vortex in the fold's own colour, deepening toward the centre.
          float swirl = foldNoise2( vec2( a * 1.6 + r * 5.0 - time * 1.2, r * 3.5 - time * 0.5 ) );
          float depth = 1.0 - r;
          vec3 idle = tint * ( 0.04 + 0.5 * swirl * depth * depth + 0.32 * pow( depth, 4.0 ) + 0.4 * smoothstep( 0.72, 1.0, r ) );
          // Linked: the destination, bent very slightly near the rim so the edge reads as a surface.
          vec2 screenUv = clipPosition.xy / clipPosition.w * 0.5 + 0.5;
          float edge = smoothstep( 0.76, 1.0, r );
          vec2 radial = r > 0.0001 ? p / r : vec2( 0.0 );
          vec2 bend = radial * edge * 0.004 * ( 0.6 + 0.4 * sin( a * 9.0 + time * 3.5 ) );
          vec3 view = texture2D( viewMap, screenUv - bend ).rgb;
          view = mix( view, tint * 1.2, edge * edge * 0.5 );
          // A new connection irises open from the centre, led by a bright ring.
          float reach = iris * 1.14;
          float reveal = linked * ( 1.0 - smoothstep( reach - 0.12, reach, r ) );
          float front = linked * exp( - pow( ( r - reach ) / 0.045, 2.0 ) ) * ( 1.0 - iris );
          vec3 color = mix( idle, view, reveal ) + tint * front * 0.9 + tint * flash * 0.15 * depth;
          gl_FragColor = vec4( color, 1.0 );
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      side: T.FrontSide,
      toneMapped: true,
    });
    const disc = new T.Mesh(new T.CircleGeometry(1, 96), this.surfaceMaterial);
    disc.scale.set(PORTAL_WIDTH, PORTAL_HEIGHT, 1);
    this.group.add(disc);

    this.rim = new T.Mesh(rimBand(), rimMaterial(this.tint));
    this.rim.position.z = 0.012;
    this.rim.renderOrder = 2;
    this.group.add(this.rim);

    // A faint wash of the fold's colour on the surrounding wall, as if the opening were lighting it.
    this.halo = new T.Mesh(new T.CircleGeometry(1, 64), new T.ShaderMaterial({
      uniforms: { tint: { value: this.tint.clone() }, strength: { value: 0.07 } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }',
      fragmentShader: `uniform vec3 tint; uniform float strength; varying vec2 vUv;
        void main() {
          float r = length( vUv * 2.0 - 1.0 );
          float glow = smoothstep( 1.0, 0.6, r ) * smoothstep( 0.6, 0.76, r ) * strength;
          gl_FragColor = vec4( tint * glow, 1.0 );
          #include <colorspace_fragment>
        }`,
      transparent: true, depthWrite: false, blending: T.AdditiveBlending, toneMapped: false,
    }));
    this.halo.scale.set(PORTAL_WIDTH * 1.55, PORTAL_HEIGHT * 1.42, 1);
    this.halo.position.z = -0.018;
    this.halo.renderOrder = 1;
    this.group.add(this.halo);

    this.group.visible = false;
    scene.add(this.group);
  }

  /** A brief brightening of the rim, used when this fold opens or its partner connects to it. */
  pulse() {
    this.flash = 1;
  }

  get readTexture() { return this.targets[this.readIndex].texture; }
  get writeTarget() { return this.targets[1 - this.readIndex]; }
  swapTargets() { this.readIndex = 1 - this.readIndex; }

  get matrix() { return new T.Matrix4().compose(this.group.position, this.group.quaternion, unitScale); }

  /** Opens the fold at a placement already seated by fitPortal, keeping the rotation it was fired with. */
  place(surface: PortalSurface, placement: PortalPlacement) {
    if (this.active) this.animateClosure();
    this.group.position.copy(placement.position);
    this.group.quaternion.copy(placement.quaternion);
    this.normal.set(0, 0, 1).applyQuaternion(placement.quaternion);
    this.surface = surface;
    this.active = true;
    this.age = 0;
    this.flash = 1;
    this.group.visible = true;
  }

  contains(point: T.Vector3, body?: Body) {
    const inverse = this.group.quaternion.clone().invert();
    const p = point.clone().sub(this.group.position).applyQuaternion(inverse);
    let sx = 0.2;
    let sy = 0.2;
    if (body) {
      if (body.id === 'player') {
        const up = body.up.clone().applyQuaternion(inverse);
        sx = 0.29 + Math.abs(up.x) * 0.6;
        sy = 0.29 + Math.abs(up.y) * 0.6;
      } else { sx = 0.43; sy = 0.43; }
    }
    // A forgiving aperture: the capsule only needs to be mostly inside the rim, not wholly inside it.
    return Math.pow((Math.abs(p.x) + sx * 0.3) / PORTAL_WIDTH, 2) + Math.pow((Math.abs(p.y) + sy * 0.3) / PORTAL_HEIGHT, 2) < 1;
  }

  /** The old rim collapses in place, so a moved fold visibly leaves its last surface. */
  private animateClosure() {
    const material = this.rim.material.clone();
    material.uniforms.time.value = this.rim.material.uniforms.time.value;
    const mesh = new T.Mesh(this.rim.geometry, material);
    mesh.position.copy(this.group.position);
    mesh.quaternion.copy(this.group.quaternion);
    mesh.position.addScaledVector(this.normal, 0.012);
    mesh.renderOrder = 2;
    this.scene.add(mesh);
    this.closingRims.push({ mesh, age: 0 });
  }

  close() { if (this.active) this.animateClosure(); this.active = false; this.surface = null; this.group.visible = false; }

  update(dt: number, time: number, linked: boolean, reducedMotion: boolean) {
    for (let i = this.closingRims.length - 1; i >= 0; i--) {
      const closing = this.closingRims[i];
      closing.age += dt;
      const remaining = Math.max(0, 1 - closing.age / 0.26);
      const shrink = 0.15 + 0.85 * remaining * remaining;
      closing.mesh.scale.set(shrink, shrink, 1);
      closing.mesh.material.uniforms.opacity.value = remaining;
      closing.mesh.material.uniforms.flash.value = remaining * 0.6;
      if (remaining === 0 || reducedMotion) {
        this.scene.remove(closing.mesh);
        closing.mesh.material.dispose();
        this.closingRims.splice(i, 1);
      }
    }
    if (!this.active) return;
    this.age += dt;
    this.linkAge = linked ? this.linkAge + dt : 0;
    this.flash *= Math.exp(-dt * 5.5);
    // Opens with a slight overshoot, then settles; reduced motion skips straight to open.
    const t = Math.min(1, this.age / 0.3);
    const scale = reducedMotion ? 1 : 1 + 2.70158 * Math.pow(t - 1, 3) + 1.70158 * Math.pow(t - 1, 2);
    this.group.scale.set(scale, scale, 1);
    const iris = reducedMotion ? 1 : T.MathUtils.smoothstep(Math.min(this.age, this.linkAge), 0, 0.45);
    const surface = this.surfaceMaterial.uniforms;
    surface.linked.value = linked ? 1 : 0;
    surface.iris.value = iris;
    surface.time.value = time;
    surface.flash.value = this.flash;
    this.rim.material.uniforms.time.value = time;
    this.rim.material.uniforms.flash.value = this.flash;
  }

  dispose() {
    this.targets.forEach(target => target.dispose());
    this.closingRims.forEach(closing => { this.scene.remove(closing.mesh); closing.mesh.material.dispose(); });
    this.closingRims = [];
  }
}

export class PortalPair {
  readonly portals: [FoldPortal, FoldPortal];
  private frustum = new T.Frustum();

  constructor(private scene: T.Scene) { this.portals = [new FoldPortal(0, scene), new FoldPortal(1, scene)]; }
  get linked() { return this.portals.every(p => p.active); }
  clear() { this.portals.forEach(p => p.close()); }

  resize(width: number, height: number, quality: Quality, scale = 1) {
    const config = QUALITY_CONFIG[quality] || QUALITY_CONFIG.medium;
    const max = config.portalTargetMax * scale;
    const w = Math.min(width, max);
    const h = Math.max(1, Math.round(w * height / width));
    this.portals.forEach(p => p.targets.forEach(target => target.setSize(w, h)));
  }

  /**
   * True when a box lies entirely behind a fold's plane. Floors and walls are often several stacked
   * colliders (a floor slab on the world ground, a panel on a wall); every one of them is "behind" the
   * opening, so the body must be allowed to pass through all of them, not only the surface it was shot onto.
   */
  behind(portal: FoldPortal, box: T.Box3) {
    const n = portal.normal;
    const center = box.getCenter(new T.Vector3()).sub(portal.group.position);
    const half = box.getSize(new T.Vector3()).multiplyScalar(0.5);
    return center.dot(n) + Math.abs(n.x) * half.x + Math.abs(n.y) * half.y + Math.abs(n.z) * half.z <= 0.06;
  }

  ignoresCollider(id: number, point: T.Vector3, body: Body, box?: T.Box3) {
    if (!this.linked) return false;
    return this.portals.some(p => {
      if (!p.surface) return false;
      if (!p.surface.colliders.includes(id) && !(box && this.behind(p, box))) return false;
      const distance = point.clone().sub(p.group.position).dot(p.normal);
      return Math.abs(distance) < 1.65 && p.contains(point, body);
    });
  }

  crossing(body: Body, before: T.Vector3, after: T.Vector3) {
    if (!this.linked || body.cooldown > 0) return null;
    for (const source of this.portals) {
      const d0 = before.clone().sub(source.group.position).dot(source.normal);
      const d1 = after.clone().sub(source.group.position).dot(source.normal);
      if (d0 < -0.005 || d1 > 0 || d0 - d1 < 0.00001) continue;
      const intersection = before.clone().lerp(after, d0 / (d0 - d1));
      if (!source.contains(intersection, body)) continue;
      const destination = this.portals[1 - source.index];
      const matrix = connectionMatrix(source.matrix, destination.matrix);
      const rotation = new T.Quaternion().setFromRotationMatrix(matrix);
      return { matrix, rotation, destination };
    }
    return null;
  }

  /**
   * Renders the views through both folds, with real recursion: a fold visible inside its own view
   * shows the next level of the corridor.
   *
   * Why the chain is exact: the disc samples its texture by the *rendering* camera's screen position,
   * and every portal camera shares the viewer's projection. A texture rendered from camera T·C lines
   * up on the disc for any camera C, so level n (camera T^n·viewer) can display level n+1
   * (camera T^(n+1)·viewer) with no approximation. Passes run deepest-first; ping-pong targets let a
   * pass show this fold's own deeper view without sampling the texture it is writing. The deepest
   * pass shows last frame's final texture, so a still corridor deepens by one level every frame.
   */
  render(renderer: T.WebGLRenderer, viewer: T.PerspectiveCamera, depth = 2) {
    if (!this.linked) return;
    viewer.updateMatrixWorld();
    this.frustum.setFromProjectionMatrix(new T.Matrix4().multiplyMatrices(viewer.projectionMatrix, viewer.matrixWorldInverse));
    const visible = this.portals.map(p =>
      viewer.position.clone().sub(p.group.position).dot(p.normal) >= -0.15 &&
      this.frustum.intersectsSphere(new T.Sphere(p.group.position, 2.4)));
    if (!visible[0] && !visible[1]) return;
    for (let pass = depth - 1; pass >= 0; pass--) {
      for (const source of this.portals) {
        if (!visible[source.index]) continue;
        const destination = this.portals[1 - source.index];
        const step = connectionMatrix(source.matrix, destination.matrix);
        const pose = viewer.matrixWorld.clone();
        for (let i = 0; i <= pass; i++) pose.premultiply(step);
        pose.decompose(source.camera.position, source.camera.quaternion, new T.Vector3());
        source.camera.near = viewer.near;
        source.camera.far = Math.min(viewer.far, 360);
        source.camera.fov = viewer.fov;
        source.camera.aspect = viewer.aspect;
        source.camera.updateMatrixWorld();
        source.camera.projectionMatrix.copy(viewer.projectionMatrix);
        this.applyObliqueClip(source.camera, destination);
        // The chain camera always sits just behind the destination fold, so that disc is hidden
        // (the oblique plane already stands in for it). This fold's own disc stays visible in the
        // middle distance, showing the deeper level: that is the recursion.
        source.group.visible = true;
        source.surfaceMaterial.uniforms.viewMap.value = source.readTexture;
        destination.group.visible = false;
        renderer.setRenderTarget(source.writeTarget);
        renderer.render(this.scene, source.camera);
      }
      this.portals.forEach(p => { if (visible[p.index]) p.swapTargets(); });
    }
    renderer.setRenderTarget(null);
    this.portals.forEach(p => {
      p.group.visible = p.active;
      p.surfaceMaterial.uniforms.viewMap.value = p.readTexture;
    });
  }

  /** An oblique near plane clips the destination wall without changing the projected x/y rays. */
  private applyObliqueClip(camera: T.PerspectiveCamera, destination: FoldPortal) {
    const plane = new T.Plane().setFromNormalAndCoplanarPoint(destination.normal, destination.group.position.clone().addScaledVector(destination.normal, 0.018));
    plane.applyMatrix4(camera.matrixWorldInverse);
    const clip = new T.Vector4(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
    const elements = camera.projectionMatrix.elements;
    const q = new T.Vector4((Math.sign(clip.x) + elements[8]) / elements[0], (Math.sign(clip.y) + elements[9]) / elements[5], -1, (1 + elements[10]) / elements[14]);
    const denominator = clip.dot(q);
    if (Math.abs(denominator) > 0.00001) {
      clip.multiplyScalar(2 / denominator);
      elements[2] = clip.x;
      elements[6] = clip.y;
      elements[10] = clip.z + 1;
      elements[14] = clip.w;
    }
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
  }

  dispose() { this.portals.forEach(p => p.dispose()); }
}