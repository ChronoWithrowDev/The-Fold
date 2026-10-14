import * as T from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { surfaceCanHoldPortal } from './portals';
import type { Body, Collider, Door, FloorSwitch, Interaction, PortalSurface, Vec3 } from './types';

const UP = new T.Vector3(0, 1, 0);
let seed = 12491;
function random() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }
const vector = (v: Vec3) => new T.Vector3(...v);

type SurfaceKind = 'brick' | 'ground' | 'concrete' | 'road' | 'ceramic';
/** Metres covered by one repeat of each surface texture, so a brick is brick-sized on every wall. */
const WORLD_TILE: Partial<Record<SurfaceKind, number>> = { brick: 2.6, concrete: 3.4, ground: 9, road: 7 };
/** Half-width of the area the sun's shadow map covers around the player, in metres. */
const SHADOW_EXTENT = 62;

/** The Deep Fold: a line of chambers deep under Walsenburg, entered by the lift in the starting room. */
const DEEP_FLOOR = -80;
const DEEP_X0 = -120;
const DEEP_Z = 20;
const DEEP_PITCH = 46;
const DEEP_HEIGHT = 22;

interface DeepPlan {
  /** Half-width of a goo pit across the middle of the chamber. */
  pit?: number;
  /** A glass barrier across the chamber: blocks bodies, not shots. */
  grate?: boolean;
  /** A core on a high shelf, a switch, and a door that wants weight. */
  cube?: { y: number; x: number };
  /** A drop shaft and a floor panel beside a high exit ledge. */
  fling?: boolean;
  /** Where the far crossing panel sits. */
  exit?: 'low' | 'high' | 'ceiling';
  hint: string;
}

const WORLD_NOISE_GLSL = `
  float foldHash( vec2 p ) { p = fract( p * vec2( 123.34, 456.21 ) ); p += dot( p, p + 45.32 ); return fract( p.x * p.y ); }
  float foldNoise( vec2 p ) {
    vec2 i = floor( p ); vec2 f = fract( p ); vec2 u = f * f * ( 3.0 - 2.0 * f );
    return mix( mix( foldHash( i ), foldHash( i + vec2( 1.0, 0.0 ) ), u.x ), mix( foldHash( i + vec2( 0.0, 1.0 ) ), foldHash( i + vec2( 1.0, 1.0 ) ), u.x ), u.y );
  }`;

/**
 * Projects a material's texture from world position along the face's dominant axis, instead of using
 * per-box UVs. Before this, a 2 m planter and a 90 m street stretched the same texture across their
 * faces; now every surface shows the material at its real-world scale. FOLD_MACRO adds a broad,
 * low-frequency colour drift to break up tiling across open ground.
 */
function worldMapping(material: T.MeshStandardMaterial, tile: number, macro: boolean) {
  if (macro) material.defines = { ...(material.defines ?? {}), FOLD_MACRO: '' };
  material.customProgramCacheKey = () => 'fold-world-mapping';
  material.onBeforeCompile = shader => {
    shader.uniforms.foldTile = { value: tile };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFoldMapWorld;\nvarying vec3 vFoldMapNormal;')
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        #ifdef USE_INSTANCING
          vFoldMapWorld = ( modelMatrix * instanceMatrix * vec4( transformed, 1.0 ) ).xyz;
          vFoldMapNormal = mat3( modelMatrix ) * mat3( instanceMatrix ) * objectNormal;
        #else
          vFoldMapWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
          vFoldMapNormal = mat3( modelMatrix ) * objectNormal;
        #endif`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform float foldTile;\nvarying vec3 vFoldMapWorld;\nvarying vec3 vFoldMapNormal;\n${WORLD_NOISE_GLSL}`)
      .replace('#include <map_fragment>', `
        #ifdef USE_MAP
          vec3 foldAxis = abs( normalize( vFoldMapNormal ) );
          vec2 foldUv = foldAxis.x > foldAxis.y && foldAxis.x > foldAxis.z ? vFoldMapWorld.zy : ( foldAxis.y > foldAxis.z ? vFoldMapWorld.xz : vFoldMapWorld.xy );
          diffuseColor *= texture2D( map, foldUv / foldTile );
        #endif
        #ifdef FOLD_MACRO
          float foldMacro = foldNoise( vFoldMapWorld.xz * 0.017 ) * 0.62 + foldNoise( vFoldMapWorld.xz * 0.071 ) * 0.38;
          diffuseColor.rgb *= mix( vec3( 0.86, 0.9, 0.8 ), vec3( 1.07, 1.02, 0.93 ), foldMacro );
        #endif`);
  };
}

function canvasTexture(width: number, height: number, draw: (ctx: CanvasRenderingContext2D) => void) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  draw(ctx);
  const texture = new T.CanvasTexture(canvas);
  texture.colorSpace = T.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function surfaceTexture(kind: 'brick' | 'ground' | 'concrete' | 'road' | 'ceramic') {
  const texture = canvasTexture(512, 512, ctx => {
    ctx.fillStyle = kind === 'brick' ? '#bba68d' : kind === 'ground' ? '#9b967d' : kind === 'road' ? '#5d6261' : kind === 'ceramic' ? '#e2e2d6' : '#b5b7af';
    ctx.fillRect(0, 0, 512, 512);
    if (kind === 'brick') {
      for (let row = 0; row < 12; row++) for (let col = -1; col < 5; col++) {
        const shade = Math.floor(110 + random() * 53);
        ctx.fillStyle = `rgb(${shade + 28},${shade - 11},${shade - 25})`;
        ctx.fillRect(col * 128 + (row % 2) * 64 + 2, row * 43 + 2, 124, 39);
      }
    }
    for (let i = 0; i < 6500; i++) {
      const shade = random() > 0.5 ? 255 : 0;
      ctx.fillStyle = `rgba(${shade},${shade},${shade},${kind === 'ceramic' ? 0.025 : 0.09})`;
      ctx.fillRect(random() * 512, random() * 512, 1 + random() * 3, 1 + random() * 2);
    }
    if (kind === 'concrete' || kind === 'ceramic') {
      ctx.strokeStyle = kind === 'ceramic' ? '#b5bbb0' : '#969c93';
      ctx.lineWidth = 2;
      ctx.strokeRect(2, 2, 508, 508);
    }
    if (kind === 'ceramic') {
      ctx.strokeStyle = '#929f94';
      ctx.lineWidth = 2;
      for (const x of [34, 478]) for (const y of [34, 478]) {
        ctx.beginPath(); ctx.moveTo(x - 9, y); ctx.lineTo(x + 9, y); ctx.moveTo(x, y - 9); ctx.lineTo(x, y + 9); ctx.stroke();
      }
      ctx.strokeStyle = '#c2c9be';
      ctx.setLineDash([3, 7]);
      ctx.beginPath(); ctx.moveTo(256, 0); ctx.lineTo(256, 512); ctx.moveTo(0, 256); ctx.lineTo(512, 256); ctx.stroke();
    }
  });
  if (kind !== 'ceramic') {
    texture.wrapS = texture.wrapT = T.RepeatWrapping;
    texture.repeat.set(kind === 'road' ? 3 : 2, kind === 'ground' ? 2 : 2);
  }
  return texture;
}

export class FoldWorld {
  readonly colliders: Collider[] = [];
  readonly shootables: T.Mesh[] = [];
  readonly surfaces: PortalSurface[] = [];
  readonly cubes: Body[] = [];
  readonly switches: FloorSwitch[] = [];
  readonly doors: Door[] = [];
  readonly interactions: Interaction[] = [];
  readonly animated: T.Object3D[] = [];
  readonly water: T.Mesh;
  readonly sun: T.DirectionalLight;
  readonly sky: Sky;
  readonly ground: Collider;
  readonly sunDirection: T.Vector3;
  /** Shared by every animated shader (water, grass, clouds), so one value drives them all. */
  readonly timeUniform = { value: 0 };
  private environment: T.WebGLRenderTarget | null = null;
  private waterSurface: T.MeshStandardMaterial | null = null;
  private readonly lightSpace = new T.Matrix4();
  private readonly lightSpaceInverse = new T.Matrix4();
  private staticMeshes: T.Mesh[] = [];
  private colliderBuckets = new Map<string, Collider[]>();
  private largeColliders: Collider[] = [];
  private dynamicColliders: Collider[] = [];
  private readonly gridSize = 16;
  private readonly deepRooms: { cx: number; entry: Vec3 }[] = [];
  private readonly hazards: { minX: number; maxX: number; minZ: number; maxZ: number; y: number; recover: Vec3 }[] = [];
  /** Street crossings over the Pueblo river; the channel is only open water between them. */
  private readonly riverBridges = [468, 546, 624, 702, 780, 858];
  private id = 0;
  private materials = new Map<string, T.MeshStandardMaterial>();
  private cubeGeometry = new RoundedBoxGeometry(0.86, 0.86, 0.86, 3, 0.065);
  private cubeCornerGeometry = new RoundedBoxGeometry(0.19, 0.19, 0.19, 1, 0.025);
  private cubeRingGeometry = new T.TorusGeometry(0.185, 0.022, 5, 6);
  private cubeInsetGeometry = new T.CircleGeometry(0.145, 6);
  private textures = {
    brick: surfaceTexture('brick'), ground: surfaceTexture('ground'), concrete: surfaceTexture('concrete'),
    road: surfaceTexture('road'), ceramic: surfaceTexture('ceramic'),
  };

  constructor(readonly scene: T.Scene) {
    seed = 12491;
    scene.background = new T.Color('#c2c3b7');
    // The haze matches the horizon, so distant ridges and the Pueblo skyline melt into the sky instead of greying out.
    scene.fog = new T.Fog('#c3c4b9', 160, 1000);
    // Late afternoon. The sun sits low in the west-southwest: facades catch warm side light, and the
    // peaks to the north are lit from the side rather than silhouetted. The sky and the light agree.
    this.sunDirection = new T.Vector3().setFromSphericalCoords(1, T.MathUtils.degToRad(67), T.MathUtils.degToRad(300));
    this.sky = new Sky();
    this.sky.scale.setScalar(1200);
    const uniforms = this.sky.material.uniforms;
    uniforms.turbidity.value = 6.2;
    uniforms.rayleigh.value = 1.3;
    uniforms.mieCoefficient.value = 0.0042;
    uniforms.mieDirectionalG.value = 0.83;
    uniforms.sunPosition.value.copy(this.sunDirection);
    // The dome rides with whichever camera is drawing, so it still surrounds the player out in
    // Pueblo and inside portal views. It writes no depth, so distant terrain still draws over it.
    this.sky.frustumCulled = false;
    this.sky.onBeforeRender = (_renderer, _scene, camera) => {
      this.sky.position.copy(camera.position);
      this.sky.updateMatrixWorld(true);
    };
    scene.add(this.sky);
    this.cloudLayer();
    // Most ambient light now comes from the sky itself (see bakeEnvironment); the hemisphere only fills in.
    scene.add(new T.HemisphereLight('#bfd3e3', '#7a6b54', 0.72));
    this.sun = new T.DirectionalLight('#ffd7a3', 2.75);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    Object.assign(this.sun.shadow.camera, { left: -SHADOW_EXTENT, right: SHADOW_EXTENT, top: SHADOW_EXTENT, bottom: -SHADOW_EXTENT, near: 1, far: 360 });
    this.sun.shadow.normalBias = 0.04;
    this.sun.shadow.bias = -0.0002;
    this.lightSpace.lookAt(this.sunDirection, new T.Vector3(), UP);
    this.lightSpaceInverse.copy(this.lightSpace).invert();
    this.updateSun(new T.Vector3(-20, 0, 20));
    scene.add(this.sun, this.sun.target);

    // The valley floor reaches the mountain base so the ridge rises out of solid ground.
    this.ground = this.box([0, -1, -100], [820, 2, 840], this.material('#c0b395', 'ground'))!;
    this.mountains();
    this.roads();
    this.downtown();
    this.discovery();
    this.momentum(31, -55, false);
    this.rooftop();
    this.water = this.lakeshore();
    this.array();
    this.momentum(40, -104, true);
    this.gravityLaboratory();
    this.landscape();
    this.pueblo();
    this.trinidad();
    this.deepFold();
    this.boundaries();
    this.buildColliderIndex();
    this.batchStaticGeometry();
    scene.updateMatrixWorld(true);
  }

  material(color: string, texture?: SurfaceKind, glow = 0) {
    const key = `${color}:${texture || ''}:${glow}`;
    const existing = this.materials.get(key);
    if (existing) return existing;
    const material = new T.MeshStandardMaterial({
      color, map: texture ? this.textures[texture] : null,
      roughness: texture === 'road' ? 0.9 : texture === 'ceramic' ? 0.42 : texture === 'brick' ? 0.86 : 0.82,
      metalness: 0.02,
      emissive: glow ? color : '#000000', emissiveIntensity: glow,
    });
    const tile = texture ? WORLD_TILE[texture] : undefined;
    if (tile) worldMapping(material, tile, texture === 'ground');
    this.materials.set(key, material);
    return material;
  }

  /** Clear, slightly metallic glazing. With the sky as an environment map it reflects the street and clouds. */
  private glass(color: string) {
    const key = `glass:${color}`;
    const existing = this.materials.get(key);
    if (existing) return existing;
    const material = new T.MeshStandardMaterial({ color, roughness: 0.07, metalness: 0.45, emissive: color, emissiveIntensity: 0.05, envMapIntensity: 1.35 });
    this.materials.set(key, material);
    return material;
  }

  /** Flat-shaded natural forms (foliage, boulders), for a crisp hand-cut look instead of smeared blobs. */
  private faceted(color: string) {
    const key = `faceted:${color}`;
    const existing = this.materials.get(key);
    if (existing) return existing;
    const material = new T.MeshStandardMaterial({ color, roughness: 0.92, metalness: 0, flatShading: true });
    this.materials.set(key, material);
    return material;
  }

  /** Lake and river water: sky reflections broken up by moving ripples computed per pixel. */
  private waterMaterial() {
    if (this.waterSurface) return this.waterSurface;
    const material = new T.MeshStandardMaterial({ color: '#365b5e', roughness: 0.05, metalness: 0.08, transparent: true, opacity: 0.9, envMapIntensity: 1.3 });
    material.customProgramCacheKey = () => 'fold-water';
    material.onBeforeCompile = shader => {
      shader.uniforms.foldTime = this.timeUniform;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vFoldWater;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvFoldWater = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float foldTime;\nvarying vec3 vFoldWater;')
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
          vec2 foldP = vFoldWater.xz;
          vec2 foldSlope = vec2(
            cos( foldP.x * 0.9 + foldTime * 0.8 ) * 0.5 + cos( foldP.x * 0.37 - foldP.y * 0.53 + foldTime * 1.13 ) * 0.35 + cos( foldP.x * 2.3 + foldP.y * 1.7 + foldTime * 2.1 ) * 0.15,
            sin( foldP.y * 0.8 - foldTime * 0.7 ) * 0.5 + sin( foldP.x * 0.41 + foldP.y * 0.29 + foldTime * 0.93 ) * 0.35 + sin( foldP.y * 2.1 - foldP.x * 1.3 + foldTime * 1.9 ) * 0.15 ) * 0.085;
          normal = normalize( normal + ( viewMatrix * vec4( foldSlope.x, 0.0, foldSlope.y, 0.0 ) ).xyz );`);
    };
    this.waterSurface = material;
    return material;
  }

  /** Grass shaded darker at the root, with a gentle wind sway that grows toward each tip. */
  private grassMaterial() {
    const material = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
    material.customProgramCacheKey = () => 'fold-grass';
    material.onBeforeCompile = shader => {
      shader.uniforms.foldTime = this.timeUniform;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float foldTime;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          float foldBlade = max( position.y + 0.31, 0.0 );
          #ifdef USE_INSTANCING
            vec2 foldRoot = vec2( instanceMatrix[ 3 ].x, instanceMatrix[ 3 ].z );
          #else
            vec2 foldRoot = vec2( 0.0 );
          #endif
          float foldGust = sin( foldTime * 1.7 + foldRoot.x * 0.21 + foldRoot.y * 0.17 ) + 0.45 * sin( foldTime * 2.9 + foldRoot.x * 0.53 );
          transformed.xz += vec2( 0.055, 0.028 ) * foldGust * foldBlade * foldBlade;`);
    };
    return material;
  }

  /**
   * Procedural cloud cover on a dome that rides with whichever camera is drawing, like the sky. It is
   * drawn at the far plane, so mountains and buildings always sit in front of it, and it drifts slowly.
   */
  private cloudLayer() {
    const material = new T.ShaderMaterial({
      uniforms: {
        foldTime: this.timeUniform,
        foldSun: { value: this.sunDirection.clone() },
        foldLit: { value: new T.Color(1.32, 1.24, 1.12) },
        foldShade: { value: new T.Color(0.6, 0.63, 0.68) },
      },
      vertexShader: `varying vec3 vFoldDir;
        void main() { vFoldDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); gl_Position = p.xyww; }`,
      fragmentShader: `uniform float foldTime; uniform vec3 foldSun; uniform vec3 foldLit; uniform vec3 foldShade;
        varying vec3 vFoldDir;
        ${WORLD_NOISE_GLSL}
        float foldFbm( vec2 p ) { float v = 0.0; float a = 0.5; for ( int i = 0; i < 5; i ++ ) { v += a * foldNoise( p ); p = p * 2.03 + vec2( 17.1, 9.2 ); a *= 0.5; } return v; }
        void main() {
          vec3 dir = normalize( vFoldDir );
          if ( dir.y <= 0.0 ) discard;
          vec2 uv = dir.xz / ( dir.y + 0.12 ) * 1.6 + vec2( foldTime * 0.006, foldTime * 0.002 );
          float n = foldFbm( uv );
          float alpha = smoothstep( 0.52, 0.78, n ) * smoothstep( 0.02, 0.22, dir.y ) * 0.85;
          if ( alpha < 0.003 ) discard;
          float sunward = pow( max( dot( dir, foldSun ), 0.0 ), 6.0 );
          vec3 color = mix( foldLit, foldShade, smoothstep( 0.55, 0.95, n ) * 0.65 ) + foldLit * sunward * 0.35;
          gl_FragColor = vec4( color, alpha );
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      transparent: true,
      depthWrite: false,
      side: T.BackSide,
    });
    const dome = new T.Mesh(new T.SphereGeometry(100, 32, 14, 0, Math.PI * 2, 0, Math.PI * 0.52), material);
    dome.frustumCulled = false;
    dome.renderOrder = -1;
    dome.onBeforeRender = (_renderer, _scene, camera) => {
      dome.position.copy(camera.position);
      dome.updateMatrixWorld(true);
    };
    this.scene.add(dome);
  }

  /**
   * Renders the sky into a prefiltered environment map: the world's ambient light and every reflection
   * then come from the actual sky instead of a flat two-colour hemisphere.
   */
  bakeEnvironment(renderer: T.WebGLRenderer) {
    const generator = new T.PMREMGenerator(renderer);
    const capture = new T.Scene();
    capture.add(this.sky);
    this.environment?.dispose();
    this.environment = generator.fromScene(capture);
    generator.dispose();
    this.scene.add(this.sky);
    this.scene.environment = this.environment.texture;
    this.scene.environmentIntensity = 0.45;
    return this.environment.texture;
  }

  /**
   * Keeps the sun's shadow map centred on the player. The centre snaps to whole shadow texels in light
   * space, so shadow edges hold still as you walk instead of crawling.
   */
  updateSun(focus: T.Vector3) {
    const texel = (SHADOW_EXTENT * 2) / this.sun.shadow.mapSize.x;
    const local = focus.clone().applyMatrix4(this.lightSpaceInverse);
    local.x = Math.round(local.x / texel) * texel;
    local.y = Math.round(local.y / texel) * texel;
    local.applyMatrix4(this.lightSpace);
    this.sun.target.position.copy(local);
    this.sun.position.copy(local).addScaledVector(this.sunDirection, 180);
    this.sun.target.updateMatrixWorld();
    this.sun.updateMatrixWorld();
  }

  tick(dt: number, focus: T.Vector3) {
    this.timeUniform.value += dt;
    this.updateSun(focus);
  }

  box(position: Vec3, size: Vec3, material: T.Material, solid = true, batch = true, shootable = true): Collider | null {
    const mesh = new T.Mesh(new T.BoxGeometry(...size), material);
    mesh.position.set(...position);
    mesh.castShadow = size[1] > 0.15;
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    mesh.updateMatrixWorld();
    if (batch) this.staticMeshes.push(mesh);
    if (!solid) return null;
    const half = vector(size).multiplyScalar(0.5);
    const collider = { id: this.id++, mesh, box: new T.Box3(vector(position).sub(half), vector(position).add(half)), enabled: true };
    mesh.userData.portalColliderId = collider.id;
    this.colliders.push(collider);
    if (shootable) this.shootables.push(mesh);
    return collider;
  }

  private cylinder(position: Vec3, radius: number, height: number, material: T.Material, topRadius = radius, segments = 10) {
    const mesh = new T.Mesh(new T.CylinderGeometry(topRadius, radius, height, segments), material);
    mesh.position.set(...position);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    this.staticMeshes.push(mesh);
    return mesh;
  }

  sign(text: string, subtitle: string, position: Vec3, width: number, height: number, normal: Vec3 = [0, 0, 1], color = '#dad9c6', background = '#293a37') {
    const texture = canvasTexture(1024, 256, ctx => {
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, 1024, 256);
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.4;
      ctx.lineWidth = 2;
      ctx.strokeRect(12, 12, 1000, 232);
      ctx.globalAlpha = 1;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = color;
      ctx.font = `600 ${text.length > 22 ? 44 : text.length > 16 ? 52 : 66}px 'Barlow Condensed', Arial, sans-serif`;
      ctx.fillText(text, 512, subtitle ? 100 : 130, 950);
      if (subtitle) {
        ctx.globalAlpha = 0.8;
        ctx.font = "24px 'IBM Plex Mono', monospace";
        ctx.fillText(subtitle, 512, 182, 940);
      }
    });
    const mesh = new T.Mesh(new T.PlaneGeometry(width, height), new T.MeshStandardMaterial({ map: texture, roughness: 0.8, emissive: '#ffffff', emissiveMap: texture, emissiveIntensity: 0.16, side: T.DoubleSide }));
    mesh.position.set(...position);
    mesh.quaternion.setFromUnitVectors(new T.Vector3(0, 0, 1), vector(normal));
    this.scene.add(mesh);
    this.staticMeshes.push(mesh);
    return mesh;
  }

  /** Anchors are at least 3.9 m each way, so a fold fits them at any rotation the shooter produces. */
  anchor(id: string, position: Vec3, normal: Vec3, hosts: number[] = [], width = 4.0, height = 4.15) {
    const n = vector(normal);
    const q = new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 0, 1), n);
    if (hosts.length === 0) {
      const size: Vec3 = Math.abs(n.x) > 0.5 ? [0.28, height + 0.3, width + 0.3] : Math.abs(n.y) > 0.5 ? [width + 0.3, 0.28, height + 0.3] : [width + 0.3, height + 0.3, 0.28];
      const backingPosition = vector(position).addScaledVector(n, -0.15);
      const backing = this.box(backingPosition.toArray() as Vec3, size, this.material('#45504a'))!;
      hosts.push(backing.id);
    }
    const mesh = new T.Mesh(new T.PlaneGeometry(width, height), this.material('#f8f4e4', 'ceramic'));
    mesh.position.set(...position);
    mesh.quaternion.copy(q);
    mesh.receiveShadow = true;
    mesh.userData.surfaceId = id;
    this.scene.add(mesh);
    this.shootables.push(mesh);
    const outline = new T.LineSegments(new T.EdgesGeometry(new T.PlaneGeometry(width, height)), new T.LineBasicMaterial({ color: '#96b7a6' }));
    outline.position.copy(mesh.position).addScaledVector(n, 0.01);
    outline.quaternion.copy(q);
    this.scene.add(outline);
    const surface: PortalSurface = { id, mesh, position: mesh.position.clone(), quaternion: q, normal: n, width, height, colliders: hosts };
    this.surfaces.push(surface);
    return surface;
  }

  surfaceFromHit(hit: T.Intersection<T.Object3D>): PortalSurface | null {
    const object = hit.object;
    if (!(object instanceof T.Mesh) || !hit.face) return null;
    if (object.userData.portalable === false) return null;
    const registered = this.surfaces.find(surface => surface.mesh === object);
    if (registered) return registered;
    if (object.geometry.type !== 'BoxGeometry') return null;

    object.updateWorldMatrix(true, false);
    // Instanced city blocks resolve through their per-instance transform and collider.
    const instanceId = hit.instanceId;
    const instanced = object instanceof T.InstancedMesh && instanceId !== undefined;
    const colliderId = instanced
      ? (object.userData.instanceColliders as number[] | undefined)?.[instanceId]
      : (object.userData.portalColliderId as number | undefined);
    if (colliderId === undefined) return null;
    const worldMatrix = object.matrixWorld.clone();
    if (instanced) {
      const instance = new T.Matrix4();
      (object as T.InstancedMesh).getMatrixAt(instanceId, instance);
      worldMatrix.multiply(instance);
    }

    const normal = hit.face.normal.clone().applyNormalMatrix(new T.Matrix3().getNormalMatrix(worldMatrix)).normalize();
    const tangentUp = UP.clone().addScaledVector(normal, -UP.dot(normal));
    if (tangentUp.lengthSq() < 0.01) {
      tangentUp.set(0, 0, -1).addScaledVector(normal, normal.z);
      if (tangentUp.lengthSq() < 0.01) tangentUp.set(1, 0, 0).addScaledVector(normal, -normal.x);
    }
    tangentUp.normalize();
    const tangentRight = tangentUp.clone().cross(normal).normalize();
    tangentUp.copy(normal).cross(tangentRight).normalize();
    const orientation = new T.Matrix4().makeBasis(tangentRight, tangentUp, normal);
    const quaternion = new T.Quaternion().setFromRotationMatrix(orientation);

    object.geometry.computeBoundingBox();
    const bounds = object.geometry.boundingBox!;
    const faceCenter = bounds.getCenter(new T.Vector3()).addScaledVector(hit.face.normal, bounds.getSize(new T.Vector3()).dot(new T.Vector3(Math.abs(hit.face.normal.x), Math.abs(hit.face.normal.y), Math.abs(hit.face.normal.z))) * 0.5);
    // Project every box corner into the face basis so rotated, scaled building surfaces keep their true aperture bounds.
    const worldCorners: T.Vector3[] = [];
    for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
      worldCorners.push(new T.Vector3(x, y, z).applyMatrix4(worldMatrix));
    }
    const worldCenter = faceCenter.applyMatrix4(worldMatrix);
    const rightRange = [Infinity, -Infinity];
    const upRange = [Infinity, -Infinity];
    for (const corner of worldCorners) {
      const offset = corner.sub(worldCenter);
      const r = offset.dot(tangentRight);
      const u = offset.dot(tangentUp);
      rightRange[0] = Math.min(rightRange[0], r); rightRange[1] = Math.max(rightRange[1], r);
      upRange[0] = Math.min(upRange[0], u); upRange[1] = Math.max(upRange[1], u);
    }
    const width = rightRange[1] - rightRange[0];
    const height = upRange[1] - upRange[0];
    // Rotation is chosen per shot, so only reject faces no rotation could ever fit; the engine decides the rest.
    if (!surfaceCanHoldPortal(width, height)) return null;
    const localNormal = hit.face.normal;
    const id = `surface-${colliderId}-${Math.round(localNormal.x)}-${Math.round(localNormal.y)}-${Math.round(localNormal.z)}`;
    return { id, mesh: object, position: worldCenter, quaternion, normal, width, height, colliders: [colliderId] };
  }

  nearbyColliders(position: T.Vector3, half: T.Vector3, margin = 0.6) {
    const minX = Math.floor((position.x - half.x - margin) / this.gridSize);
    const maxX = Math.floor((position.x + half.x + margin) / this.gridSize);
    const minY = Math.floor((position.y - half.y - margin) / this.gridSize);
    const maxY = Math.floor((position.y + half.y + margin) / this.gridSize);
    const minZ = Math.floor((position.z - half.z - margin) / this.gridSize);
    const maxZ = Math.floor((position.z + half.z + margin) / this.gridSize);
    const found = new Map<number, Collider>();
    for (let x = minX; x <= maxX; x++) for (let y = minY; y <= maxY; y++) for (let z = minZ; z <= maxZ; z++) {
      for (const collider of this.colliderBuckets.get(`${x},${y},${z}`) || []) found.set(collider.id, collider);
    }
    for (const collider of this.largeColliders) found.set(collider.id, collider);
    for (const collider of this.doors.map(door => door.collider)) found.set(collider.id, collider);
    return [...found.values()];
  }

  cube(id: string, position: Vec3, stage: number) {
    const group = new T.Group();
    const core = new T.Mesh(this.cubeGeometry, this.material('#d9dece'));
    core.castShadow = true;
    core.receiveShadow = true;
    group.add(core);
    const cornerMesh = new T.InstancedMesh(this.cubeCornerGeometry, this.material('#47594f'), 8);
    const detailMesh = new T.Object3D();
    let cornerIndex = 0;
    for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) {
      detailMesh.position.set(x * 0.355, y * 0.355, z * 0.355);
      detailMesh.updateMatrix(); cornerMesh.setMatrixAt(cornerIndex++, detailMesh.matrix);
    }
    cornerMesh.instanceMatrix.needsUpdate = true;
    cornerMesh.castShadow = true;
    group.add(cornerMesh);
    const ringMesh = new T.InstancedMesh(this.cubeRingGeometry, this.material('#8fccf2', undefined, 0.6), 6);
    const insetMesh = new T.InstancedMesh(this.cubeInsetGeometry, this.material('#3e5950'), 6);
    const faces: Vec3[] = [[0, 0, 1], [0, 0, -1], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0]];
    let faceIndex = 0;
    for (const normal of faces) {
      detailMesh.position.copy(vector(normal).multiplyScalar(0.435));
      detailMesh.quaternion.setFromUnitVectors(new T.Vector3(0, 0, 1), vector(normal));
      detailMesh.updateMatrix();
      ringMesh.setMatrixAt(faceIndex, detailMesh.matrix);
      detailMesh.position.copy(vector(normal).multiplyScalar(0.433));
      detailMesh.updateMatrix();
      insetMesh.setMatrixAt(faceIndex, detailMesh.matrix);
      faceIndex++;
    }
    ringMesh.instanceMatrix.needsUpdate = insetMesh.instanceMatrix.needsUpdate = true;
    group.add(ringMesh, insetMesh);
    group.position.set(...position);
    this.scene.add(group);
    const body: Body = { id, position: vector(position), velocity: new T.Vector3(), half: new T.Vector3(0.44, 0.44, 0.44), rotation: new T.Quaternion(), up: UP.clone(), gravity: new T.Vector3(0, -1, 0), grounded: false, cooldown: 0, group, spawn: vector(position), stage };
    this.cubes.push(body);
    return body;
  }

  floorSwitch(id: string, x: number, floor: number, z: number) {
    this.cylinder([x, floor + 0.065, z], 0.98, 0.12, this.material('#303d38'), 0.98, 32);
    const contact = this.box([x, floor + 0.06, z], [1.55, 0.12, 1.55], this.material('#303d38'), true, false, false)!;
    contact.mesh.visible = false;
    const mesh = new T.Mesh(new T.CylinderGeometry(0.79, 0.85, 0.1, 32), this.material('#a58256'));
    mesh.position.set(x, floor + 0.135, z);
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    const light = new T.Mesh(new T.TorusGeometry(0.9, 0.023, 6, 48), new T.MeshBasicMaterial({ color: '#efba76', toneMapped: false }));
    light.rotation.x = -Math.PI / 2;
    light.position.set(x, floor + 0.132, z);
    this.scene.add(light);
    this.switches.push({ id, position: new T.Vector3(x, floor + 0.15, z), mesh, light, active: false });
  }

  console(id: string, position: Vec3, stage: number, label: string, kind: Interaction['kind'] = 'relay', requiredSwitches?: string[], requiredGravity?: number, door?: Door) {
    const [x, y, z] = position;
    // A console's own pedestal must not occlude the interaction ray to its control face.
    this.box([x, y - 0.6, z - 0.17], [0.65, 1.05, 0.5], this.material('#3b4a43'), true, true, false);
    const title = kind === 'note' ? 'FIELD LOG' : kind === 'door' ? 'FIELD SHUTTER' : kind === 'gravity' ? 'VECTOR SHIFTER' : kind === 'lift' ? 'DEEP FOLD LIFT' : 'FOLD / RESEARCH';
    const subline = kind === 'note' ? 'E  /  READ ENTRY' : kind === 'door' ? 'E  /  RELEASE' : kind === 'gravity' ? 'E  /  RETRIEVE' : kind === 'lift' ? 'E  /  RIDE' : 'E  /  CONNECT';
    const mesh = this.sign(title, subline, position, 0.9, 0.55, [0, 0, 1], '#b7ead4', '#203d34');
    this.interactions.push({ id, position: vector(position), stage, label, kind, mesh, requiredSwitches, requiredGravity, door });
    return this.interactions[this.interactions.length - 1];
  }

  private roads() {
    this.box([0, 0.014, -19], [16, 0.025, 154], this.material('#b1b2ac', 'road'), false);
    this.box([-9, 0.018, -25], [164, 0.03, 10], this.material('#a4aaa7', 'road'), false);
    for (const side of [-1, 1]) {
      this.box([side * 10.3, 0.12, 9], [4.6, 0.24, 92], this.material('#d6d0bb', 'concrete'));
      this.box([side * 8.07, 0.18, 9], [0.18, 0.35, 92], this.material('#d7d0b6'));
      this.box([side * 0.13, 0.035, 12], [0.055, 0.007, 89], this.material('#ded1a0'), false, true, false);
      for (let z = 39; z > -20; z -= 5) {
        const line = new T.Mesh(new T.BoxGeometry(3.7, 0.012, 0.055), this.material('#bfbfad'));
        line.position.set(side * 5.8, 0.04, z);
        line.rotation.y = side * -0.46;
        this.scene.add(line); this.staticMeshes.push(line);
      }
      for (let z = 40; z > -40; z -= 17) this.streetlight(side * 10, z);
    }
    for (let x = -5; x <= 5; x += 1.5) this.box([x, 0.045, -18.5], [0.85, 0.01, 3.8], this.material('#c9c9b9'), false, true, false);
    this.sign('MAIN STREET', 'WALSENBURG  /  COLORADO', [8.5, 3.2, -20.3], 2.6, 0.65, [0, 0, 1]);
    this.cylinder([8.5, 1.7, -20.5], 0.055, 3.4, this.material('#37443e'));
    this.sign('LATHROP RESERVE', '<  WEST ROAD', [-12.5, 2.5, -24.7], 3, 0.8);
    this.sign('SPANISH PEAKS ARRAY', 'NORTH RIDGE  /  80 M', [4.5, 2.7, -48], 3.8, 1);
    this.cylinder([4.5, 1.5, -48.1], 0.065, 3, this.material('#3b443a'));
  }

  private streetlight(x: number, z: number) {
    const metal = this.material('#333c36');
    this.cylinder([x, 0.35, z], 0.22, 0.55, metal);
    this.cylinder([x, 2.65, z], 0.065, 4.8, metal, 0.052);
    this.cylinder([x, 5.12, z], 0.22, 0.08, metal);
    this.box([x, 5.36, z], [0.26, 0.4, 0.26], this.material('#f6d5a3', undefined, 1.3), false);
    this.cylinder([x, 5.64, z], 0.3, 0.18, metal, 0.06, 4);
  }

  private downtown() {
    const shops = [
      { side: 1, z: 36, height: 6.8, name: 'HUERFANO MERCANTILE', sub: 'PROVISIONS  /  EST. 1924', color: '#c6b59b' },
      { side: 1, z: 23, height: 5.7, name: 'SECOND STREET COFFEE', sub: 'GOOD COFFEE. NO SHORTCUTS.', color: '#adb4a2' },
      { side: 1, z: 9, height: 7.4, name: 'MESA THEATER', sub: 'THE WORLD IS STRANGER OUTSIDE', color: '#d2a186' },
      { side: 1, z: -6, height: 6.3, name: 'HIGH COUNTRY HARDWARE', sub: 'IF IT CAN BE FIXED', color: '#c2c0ad' },
      { side: 1, z: -40, height: 5.6, name: 'SAN ISABEL SUPPLY', sub: 'SOUTHERN COLORADO', color: '#b9ac8a' },
      { side: -1, z: 38, height: 6.1, name: 'CORNER BOOKS', sub: 'OTHER PLACES, ON PAPER', color: '#bab9a0' },
      { side: -1, z: -3, height: 7.8, name: 'THE WALSENBURG POST', sub: 'LOCAL NEWS  /  SINCE 1908', color: '#be9b84' },
      { side: -1, z: -41, height: 5.8, name: 'PEAKS MOTOR LODGE', sub: 'A ROOM SOMEWHERE FAMILIAR', color: '#bfc9bc' },
    ];
    shops.forEach(shop => this.building(shop.side, shop.z, shop.height, shop.name, shop.sub, shop.color));
    for (const [x, z] of [[10, 31], [-10.5, 30], [11, -10], [-10.5, -8]]) {
      for (let i = 0; i < 4; i++) this.box([x, 0.62, z + i * 0.15], [2.1, 0.075, 0.11], this.material('#85745b'));
      this.box([x, 1.02, z + 0.55], [2.1, 0.48, 0.08], this.material('#85745b'));
      for (const dx of [-0.75, 0.75]) this.box([x + dx, 0.35, z + 0.2], [0.06, 0.6, 0.48], this.material('#344139'));
    }
    for (const [x, z] of [[10, 17], [-10, 5], [10, 43], [-10, 44]]) {
      this.box([x, 0.52, z], [1.25, 0.7, 1.25], this.material('#bda286'));
      this.box([x, 0.89, z], [1.1, 0.08, 1.1], this.material('#625d47'), false);
      this.tree(x, z, 2.8, 0.9);
    }
    // A recognisable water tower above the western alley.
    const iron = this.material('#5d6459');
    for (const x of [-40, -36]) for (const z of [-9, -5]) this.cylinder([x, 5.5, z], 0.11, 11, iron);
    this.cylinder([-38, 11.2, -7], 3.5, 3.6, this.material('#bac1b1'), 3.5, 24);
    this.cylinder([-38, 13.3, -7], 3.65, 0.75, iron, 0.4, 24);
    this.sign('WALSENBURG', 'HUERFANO COUNTY', [-38, 11.4, -3.48], 5.6, 1.2);
  }

  private building(side: number, z: number, height: number, name: string, subtitle: string, color: string) {
    const x = side * 20;
    const facadeX = side * 13.92;
    const width = z === 9 ? 15 : 11.8;
    const mat = this.material(color, z % 3 ? 'brick' : 'concrete');
    const wallThick = 0.4;
    const doorHalfWidth = 1.35; // 2.7m open doorway

    // Hollow outer structure:
    // Back wall:
    const backWall = this.box([side * 25.8, height / 2, z], [wallThick, height, width], mat)!;
    // North and south side walls:
    this.box([x, height / 2, z - width / 2 + wallThick / 2], [12, height, wallThick], mat);
    this.box([x, height / 2, z + width / 2 - wallThick / 2], [12, height, wallThick], mat);
    // Roof slab and top parapet:
    this.box([x, height - 0.15, z], [12, 0.3, width], mat);
    this.box([x, height + 0.18, z], [12.35, 0.36, width + 0.3], this.material('#a9aa95'));

    // Front facade with open walk-in doorway:
    const frontX = side * 14.1;
    const sideWallWidth = (width - doorHalfWidth * 2) / 2;
    const leftWallCenterZ = z - doorHalfWidth - sideWallWidth / 2;
    const rightWallCenterZ = z + doorHalfWidth + sideWallWidth / 2;

    this.box([frontX, height / 2, leftWallCenterZ], [wallThick, height, sideWallWidth], mat);
    this.box([frontX, height / 2, rightWallCenterZ], [wallThick, height, sideWallWidth], mat);

    const doorHeight = 3.2;
    this.box([frontX, (height + doorHeight) / 2, z], [wallThick, height - doorHeight, doorHalfWidth * 2], mat);

    // Front sidewalk baseboards on sides of door:
    this.box([side * 13.8, 0.45, leftWallCenterZ], [0.34, 0.9, sideWallWidth], this.material('#807e6c'));
    this.box([side * 13.8, 0.45, rightWallCenterZ], [0.34, 0.9, sideWallWidth], this.material('#807e6c'));

    // Signboard above entrance:
    const normal: Vec3 = [-side, 0, 0];
    this.sign(name, subtitle, [facadeX, 3.9, z], width - 0.8, 0.92, normal, '#e5dfca', side > 0 ? '#384b42' : '#51463c');

    // Windows on left and right facade sections (skipping the entrance):
    for (let dz = -width / 2 + 1.7; dz < width / 2 - 0.9; dz += 2.65) {
      if (Math.abs(dz) < 1.4) continue; // Leaves center doorway completely clear!
      const glass = this.glass(random() > 0.32 ? '#5f7671' : '#8f8664');
      this.box([side * 13.85, 1.98, z + dz], [0.14, 2.55, 2.17], this.material('#535e50'), false);
      this.box([side * 13.75, 2.03, z + dz], [0.06, 2.28, 1.91], glass, false);
      this.box([side * 13.68, 2.02, z + dz], [0.09, 2.3, 0.055], this.material('#b5b9a4'), false);
      this.box([side * 13.65, 1.15, z + dz], [0.08, 0.06, 1.9], this.material('#b5b9a4'), false);
      if (height > 6.2) {
        this.box([side * 13.85, 5.62, z + dz], [0.12, 1.68, 1.25], this.material('#d0c7ac'), false);
        this.box([side * 13.74, 5.63, z + dz], [0.1, 1.46, 1.03], this.material('#526b67'), false);
        this.box([side * 13.66, 5.63, z + dz], [0.08, 1.46, 0.05], this.material('#c2c2ac'), false);
      }
    }

    // Welcoming inward-opened double shop doors:
    const doorWood = this.material('#513f32');
    this.box([side * 14.6, doorHeight / 2, z - doorHalfWidth + 0.06], [0.9, doorHeight - 0.1, 0.08], doorWood, false);
    this.box([side * 14.6, doorHeight / 2, z + doorHalfWidth - 0.06], [0.9, doorHeight - 0.1, 0.08], doorWood, false);

    // Weather awning:
    this.box([side * 13.15, 3.26, z], [1.4, 0.14, width - 0.5], this.material(side > 0 ? '#506956' : '#8c7862'), false);
    for (const dz of [-width / 2 + 0.3, width / 2 - 0.3]) this.box([side * 13.7, height / 2, z + dz], [0.5, height, 0.35], this.material('#b5b09a'), false);

    if (name === 'MESA THEATER') {
      this.sign('M E S A', 'PICTURE HOUSE', [12.95, 6.4, z - 5.5], 1.8, 2.5, [0, 0, 1], '#f2d29b', '#734c3c');
    }

    // Interior floor:
    const floorColor = name === 'SECOND STREET COFFEE' ? '#5a4634' : name === 'MESA THEATER' ? '#4d1915' : '#796c5b';
    this.box([x, 0.04, z], [11.4, 0.08, width - 0.8], this.material(floorColor, 'concrete'));

    // Interior lighting:
    this.box([side * 19.5, height - 0.25, z], [3.2, 0.06, 0.35], this.material('#fff5dc', undefined, 1.2), false);

    // Interior portal-compatible wall panel at the back:
    const anchorId = `interior-${name.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
    this.anchor(anchorId, [side * 25.75, 2.7, z], [-side, 0, 0], [backWall.id], 4.2, 4.4);

    // Furnish each building interior based on its unique identity:
    this.buildingInterior(side, z, height, width, name);
  }

  private buildingInterior(side: number, z: number, height: number, width: number, name: string) {
    if (name === 'HUERFANO MERCANTILE') {
      // Long dry-goods service counter
      this.box([side * 17.5, 0.6, z - 1.8], [1.2, 1.1, 4.5], this.material('#6e5842'));
      // Antique cash register
      this.box([side * 17.5, 1.25, z - 2.5], [0.45, 0.35, 0.45], this.material('#87724a'));
      // Side grocery shelving racks
      this.box([side * 20.0, 1.8, z - width / 2 + 0.6], [7.0, 3.4, 0.6], this.material('#5d4a37'));
      this.box([side * 20.0, 1.8, z + width / 2 - 0.6], [7.0, 3.4, 0.6], this.material('#5d4a37'));
      // Barrels
      this.cylinder([side * 24.5, 0.6, z + width / 2 - 1.2], 0.38, 1.1, this.material('#735c42'));
      this.cylinder([side * 24.5, 0.6, z + width / 2 - 2.1], 0.38, 1.1, this.material('#735c42'));
      // Sacks of grain / flour
      this.box([side * 23.5, 0.45, z - 2.5], [1.6, 0.7, 1.8], this.material('#c7b99c'));
    } else if (name === 'SECOND STREET COFFEE') {
      // Coffee bar counter
      this.box([side * 18.0, 0.6, z + 2.0], [1.3, 1.1, 4.2], this.material('#4e3a2b'));
      this.box([side * 20.2, 0.6, z + 3.9], [3.6, 1.1, 1.2], this.material('#4e3a2b'));
      // Espresso machine
      this.box([side * 19.5, 1.35, z + 3.8], [0.8, 0.5, 0.65], this.material('#b88b56', undefined, 0.2));
      // Stools
      for (const dz of [-0.8, 0.6, 2.0]) {
        this.cylinder([side * 16.8, 0.4, z + dz], 0.2, 0.75, this.material('#3d2f23'));
      }
      // Cafe tables
      this.cylinder([side * 16.5, 0.45, z - 2.6], 0.45, 0.85, this.material('#66503c'));
      this.box([side * 16.5, 0.4, z - 3.4], [0.4, 0.8, 0.4], this.material('#3d2f23'));
      // Coffee blackboard menu
      this.sign('MENU / SPECIALS', 'ESPRESSO $2  /  FOLD BREW $4', [side * 21.5, 2.2, z + 4.45], 2.8, 1.2, [0, 0, -1], '#e2eed8', '#222824');
      // Lounge armchairs in back
      this.box([side * 23.5, 0.5, z - 2.8], [1.2, 0.85, 1.2], this.material('#4d3326'));
      this.box([side * 23.5, 0.35, z - 1.2], [0.8, 0.4, 0.8], this.material('#7a5d44'));
    } else if (name === 'MESA THEATER') {
      // Ticket and concession counter
      this.box([side * 16.2, 0.6, z + 3.8], [1.2, 1.1, 3.2], this.material('#662e26'));
      this.box([side * 16.2, 1.35, z + 4.5], [0.4, 0.45, 0.4], this.material('#e8d28a', undefined, 0.4));
      // Partition wall with archway into auditorium
      this.box([side * 18.2, height / 2, z - 3.8], [0.4, height, 5.0], this.material('#4a221d'));
      this.box([side * 18.2, height / 2, z + 3.8], [0.4, height, 5.0], this.material('#4a221d'));
      this.box([side * 18.2, height - 1.2, z], [0.4, 2.4, 3.2], this.material('#4a221d'));
      // Tiered cinema seating
      this.box([side * 20.2, 0.4, z - 1.5], [0.8, 0.75, 4.2], this.material('#82241d'));
      this.box([side * 22.0, 0.75, z - 1.5], [0.8, 0.75, 4.2], this.material('#82241d'));
      this.box([side * 22.0, 0.25, z - 1.5], [1.2, 0.5, 4.8], this.material('#511814'));
      // Cinema stage & giant projection screen
      this.box([side * 24.5, 0.45, z], [2.2, 0.8, 10.5], this.material('#631f1a'));
      this.anchor('mesa-screen', [side * 25.75, 3.8, z], [-side, 0, 0], [], 8.6, 5.4);
      // Backstage stairs ascending to rooftop transit station
      for (let step = 0; step < 16; step++) {
        this.box([side * (24.0 - step * 0.35), 0.35 + step * 0.45, z + 6.0], [0.4, 0.45, 1.4], this.material('#736756'));
      }
    } else if (name === 'HIGH COUNTRY HARDWARE') {
      // Sturdy workbench with tool vise
      this.box([side * 18.0, 0.55, z - 1.5], [1.3, 1.0, 4.4], this.material('#594939'));
      this.box([side * 18.0, 1.15, z - 3.2], [0.35, 0.25, 0.4], this.material('#88948e'));
      // Metal hardware shelving
      this.box([side * 22.0, 1.8, z + 2.4], [1.0, 3.2, 5.2], this.material('#404a45'));
      this.box([side * 24.2, 1.8, z + 2.4], [1.0, 3.2, 5.2], this.material('#404a45'));
      // Stacks of lumber
      this.box([side * 24.0, 0.75, z - 2.5], [1.6, 1.4, 3.6], this.material('#baa882'));
      // Paint cans
      for (const dy of [0.3, 0.7, 1.1]) {
        this.cylinder([side * 16.5, dy, z + 3.5], 0.2, 0.35, this.material('#b8483f'));
      }
    } else if (name === 'SAN ISABEL SUPPLY') {
      // Topo relief map drafting table
      this.box([side * 18.8, 0.55, z], [2.2, 0.9, 3.6], this.material('#6b5239'));
      this.box([side * 18.8, 1.02, z], [1.8, 0.05, 3.2], this.material('#c7be9b'));
      // Camping tent display
      this.box([side * 23.2, 0.85, z - 2.5], [2.5, 1.6, 2.6], this.material('#7d9164'));
      // Canoe suspended from ceiling rafters
      this.box([side * 19.5, height - 1.1, z], [1.0, 0.45, 5.2], this.material('#8a3c2c'));
      // Gear rack
      this.box([side * 20.0, 1.6, z + width / 2 - 0.6], [5.0, 2.2, 0.3], this.material('#4a3b2b'));
    } else if (name === 'CORNER BOOKS') {
      // Bookcases
      this.box([side * 18.5, 1.8, z + 2.2], [1.0, 3.4, 5.4], this.material('#543924'));
      this.box([side * 21.8, 1.8, z + 2.2], [1.0, 3.4, 5.4], this.material('#543924'));
      // Library ladder
      this.box([side * 17.8, 1.8, z + 3.2], [0.1, 3.3, 0.6], this.material('#7a583d'));
      // Reading nook with armchair, floor lamp & rug
      this.box([side * 23.5, 0.45, z - 2.8], [1.2, 0.85, 1.2], this.material('#2c4338'));
      this.cylinder([side * 24.5, 1.05, z - 1.4], 0.22, 1.6, this.material('#a89b6b'));
      this.box([side * 23.0, 0.06, z - 2.2], [2.4, 0.02, 2.4], this.material('#8a3a2b'));
      // Antique typewriter desk
      this.box([side * 18.2, 0.48, z - 2.6], [1.1, 0.85, 1.8], this.material('#452f1e'));
      this.box([side * 18.2, 0.96, z - 2.6], [0.35, 0.15, 0.35], this.material('#222222'));
    } else if (name === 'THE WALSENBURG POST') {
      // Vintage rotary printing press
      this.box([side * 19.5, 1.2, z], [2.2, 2.0, 3.4], this.material('#282f2c'));
      this.cylinder([side * 19.5, 2.05, z], 0.65, 3.2, this.material('#55605b'), 0.65, 16);
      // Newspaper stacks
      this.box([side * 16.5, 0.35, z + 2.5], [1.5, 0.6, 2.0], this.material('#dedccf'));
      this.box([side * 23.5, 0.35, z + 2.5], [1.5, 0.6, 2.0], this.material('#dedccf'));
      // Editor's office desk with lamp & typewriter
      this.box([side * 23.5, 0.5, z - 2.4], [1.2, 0.88, 2.2], this.material('#4a3525'));
      this.box([side * 23.5, 0.98, z - 2.4], [0.35, 0.12, 0.3], this.material('#242424'));
      this.box([side * 23.5, 1.05, z - 1.6], [0.25, 0.25, 0.25], this.material('#1d522b', undefined, 0.8));
      // Filing cabinets
      this.box([side * 25.2, 1.1, z - 2.4], [0.6, 2.1, 1.8], this.material('#4b5550'));
    } else if (name === 'PEAKS MOTOR LODGE') {
      // Front reception counter
      this.box([side * 17.2, 0.55, z + 1.4], [1.1, 1.0, 3.2], this.material('#5a4332'));
      // Key cubby rack
      this.box([side * 18.5, 1.65, z + 1.4], [0.15, 1.1, 2.2], this.material('#735944'));
      // Waiting sofa
      this.box([side * 16.5, 0.45, z - 2.6], [1.1, 0.8, 2.4], this.material('#7a5440'));
      this.box([side * 18.0, 0.25, z - 2.6], [0.8, 0.4, 1.4], this.material('#5a4332'));
      // Room 101 partition wall
      this.box([side * 20.0, height / 2, z - 2.6], [0.3, height, 4.0], this.material('#969280'));
      this.box([side * 20.0, height / 2, z + 2.6], [0.3, height, 4.0], this.material('#969280'));
      this.box([side * 20.0, (height + 2.4) / 2, z], [0.3, height - 2.4, 1.4], this.material('#969280'));
      // Inside Room 101: Queen bed
      this.box([side * 23.5, 0.42, z + 1.8], [2.4, 0.75, 2.6], this.material('#4a607a'));
      this.box([side * 25.0, 0.8, z + 1.8], [0.3, 1.4, 2.6], this.material('#3d2f23'));
      // Nightstand with lamp
      this.box([side * 23.5, 0.38, z + 3.6], [0.65, 0.65, 0.65], this.material('#4d3c2e'));
      this.cylinder([side * 23.5, 0.9, z + 3.6], 0.18, 0.4, this.material('#d9ca96', undefined, 0.7));
      // Dresser with retro TV
      this.box([side * 21.4, 0.55, z - 1.8], [0.8, 0.95, 1.8], this.material('#4d3c2e'));
      this.box([side * 21.4, 1.25, z - 1.8], [0.65, 0.45, 0.65], this.material('#222222'));
      this.sign('ROOM 101', 'REST & RELAX', [side * 20.2, 1.8, z], 0.8, 0.45, [-side, 0, 0]);
    }
  }

  private discovery() {
    const concrete = this.material('#b8bba9', 'concrete');
    const floor = this.box([-23, 0.06, 17], [18, 0.12, 18], this.material('#b4b6a5', 'concrete'))!;
    const back = this.box([-32, 3, 17], [0.42, 6, 18], concrete)!;
    this.box([-23, 3, 8], [18, 6, 0.42], concrete);
    this.box([-23, 3, 26], [18, 6, 0.42], this.material('#baa288', 'brick'));
    this.box([-14, 3, 13], [0.42, 6, 10], this.material('#b8a089', 'brick'));
    this.box([-14, 3, 25], [0.42, 6, 2], this.material('#b8a089', 'brick'));
    this.box([-14, 5.2, 21], [0.42, 1.6, 6], this.material('#b8a089', 'brick'));
    const ceiling = this.box([-23, 6.1, 17], [18, 0.2, 18], this.material('#8d998b'))!;
    this.sign('HUERFANO FIELD STATION', 'SPATIAL RESEARCH  /  AUTHORIZED ENTRY', [-13.76, 4.9, 21], 5.6, 0.8, [1, 0, 0]);
    const fence = this.box([-23, 2.25, 16], [18, 4.5, 0.18], this.material('#57675b'), true, false, false)!;
    fence.mesh.visible = false;
    for (let x = -31.7; x < -14; x += 1.3) this.box([x, 2.3, 16], [0.06, 4.45, 0.12], this.material('#4e5f54'), false);
    for (const y of [0.35, 1.2, 3.4, 4.4]) this.box([-23, y, 16], [18, 0.06, 0.12], this.material('#4e5f54'), false);
    for (let x = -31.7; x < -14; x += 0.28) this.box([x, 2.25, 16], [0.017, 4.45, 0.025], this.material('#758473'), false);
    for (let y = 0.25; y < 4.4; y += 0.3) this.box([-23, y, 16], [17.8, 0.017, 0.025], this.material('#758473'), false);
    this.anchor('lab-near', [-31.77, 2.07, 21.6], [1, 0, 0], [back.id]);
    this.anchor('lab-far', [-31.77, 2.07, 11.1], [1, 0, 0], [back.id]);
    this.anchor('lab-ceiling', [-25.5, 5.985, 11.2], [0, -1, 0], [ceiling.id], 4, 4.5);
    this.anchor('lab-floor', [-28, 0.136, 21.7], [0, 1, 0], [floor.id, this.ground.id], 4.0, 4.2);
    this.sign('01 / THE DISCOVERY LAB', 'DISTANCE IS A SUGGESTION.', [-23, 4.98, 8.24], 8, 1.0);
    this.sign('SOLID SURFACES ACCEPT FOLDS', 'BLUE: LEFT CLICK   /   ORANGE: RIGHT CLICK', [-23, 4.9, 25.76], 8, 0.9, [0, 0, -1]);
    this.cube('discovery-core', [-24, 0.63, 11.5], 0);
    this.floorSwitch('discovery', -18, 0.12, 22);
    const gate = this.box([-14, 2.3, 21], [0.3, 4.6, 5.65], this.material('#415a4f'), true, false)!;
    gate.mesh.userData.portalable = false;
    this.doors.push({ mesh: gate.mesh, collider: gate, homeY: 2.3, switchIds: ['discovery'], minimumStage: 1, open: 0 });
    this.sign('EXIT / MAIN STREET', 'POWER THE FLOOR SWITCH', [-14.18, 3, 21], 4.2, 0.85, [-1, 0, 0]);
    this.box([-16.3, 0.145, 22], [2.4, 0.02, 0.035], this.material('#b6c8a7', undefined, 0.25), false);
    this.console('coffee', [-18.5, 1.4, 24.8], 0, 'Read the field log', 'note');
    // Behind you as you wake: the lift down to the Deep Fold.
    this.sign('THE DEEP FOLD', '15 CHAMBERS BELOW  /  RIDE THE LIFT', [-25, 3.4, 25.76], 4.6, 1.1, [0, 0, -1], '#e3eadf', '#26343b');
    this.box([-25, 1.5, 25.7], [2.6, 3, 0.12], this.material('#2f3a40'), false);
    for (const x of [-26.4, -23.6]) this.box([x, 1.5, 25.66], [0.12, 3, 0.16], this.material('#4fb6f2', undefined, 0.6), false);
    this.console('deep-lift-down', [-25, 1.4, 24.6], 0, 'Ride the lift down to the Deep Fold', 'lift').target = [DEEP_X0 - 16, DEEP_FLOOR + 1, DEEP_Z + 6];
    this.box([-27.5, 1.0, 9.5], [4, 0.14, 1.3], this.material('#737b67'));
    for (const z of [12, 21.5]) {
      this.box([-23, 5.88, z], [5, 0.08, 0.18], this.material('#e8f0d9', undefined, 1.2), false);
    }
  }

  private momentum(x: number, z: number, final: boolean) {
    const stage = final ? 6 : 1;
    const shell = this.material(final ? '#7e8c80' : '#a8aea0', 'concrete');
    const floor = this.box([x + 12, 0.055, z + 17.5], [24, 0.11, 35], this.material('#afb8a8', 'concrete'))!;
    const back = this.box([x + 12, 7.2, z], [24, 14.4, 0.4], shell)!;
    this.box([x + 24, 6.3, z + 17.5], [0.4, 12.6, 35], shell);
    this.box([x, 3.2, z + 12], [0.4, 6.4, 24], shell);
    this.box([x, 3.2, z + 33.5], [0.4, 6.4, 3], shell);
    this.box([x + 12, 3.2, z + 35], [24, 6.4, 0.4], shell);
    this.sign(final ? '07 / THE FOLD ENGINE' : '02 / MOMENTUM CHAMBER', final ? 'RETURN EVERYTHING TO WHERE IT BELONGS.' : 'GRAVITY SUPPLIES THE REST.', [x + 12, 12.45, z + 0.23], 18, 1.5);
    this.sign(final ? 'SUBSTATION ZERO >' : 'MOMENTUM LAB >', 'HUERFANO SPATIAL RESEARCH', [x - 0.23, 4.7, z + 28], 6, 0.9, [-1, 0, 0]);
    for (let i = 0; i < 28; i++) {
      const h = (i + 1) * 0.36;
      this.box([x + 2.5, h / 2, z + 33 - i * 0.8], [3.6, h, 0.81], this.material('#a4b09e', 'concrete'));
      this.box([x + 2.5, h + 0.005, z + 32.63 - i * 0.8], [3.6, 0.013, 0.055], this.material('#d5c49a'), false);
    }
    this.box([x + 2.5, 9.93, z + 8.6], [4, 0.3, 6.5], this.material('#818f7c'));
    const hatch = this.box([x + 6, 9.98, z + 9], [3.0, 0.2, 4.0], new T.MeshStandardMaterial({ color: '#a3bba2', wireframe: true }), true, false)!;
    hatch.mesh.userData.portalable = false;
    this.anchor(final ? 'engine-fall' : 'momentum-fall', [x + 6, 0.127, z + 9], [0, 1, 0], [this.ground.id, floor.id], 4.4, 4.7);
    this.anchor(final ? 'engine-launch' : 'momentum-launch', [x + 15, 8.8, z + 0.23], [0, 0, 1], [back.id], 4.2, 4.4);
    const hatchSwitch = this.sign('DROP / E', 'STAND AT THE CENTER', [x + 6, 10.85, z + 7.05], 1.8, 0.65);
    this.interactions.push({ id: final ? 'engine-hatch' : 'momentum-hatch', kind: 'hatch', position: new T.Vector3(x + 6, 10.85, z + 7.05), stage, label: 'Release the drop hatch', mesh: hatchSwitch, hatch });
    this.box([x + 15, 4.1, z + 13.7], [8, 0.5, 5.8], this.material('#c0c3ac'));
    for (const dx of [11.5, 18.5]) this.box([x + dx, 2.05, z + 13.7], [0.35, 4.1, 0.35], this.material('#536e5e'));
    if (final) {
      this.cube('engine-core', [x + 6, 10.65, z + 9], 5);
      this.floorSwitch('engine', x + 14.5, 4.35, z + 14.2);
      this.console('engine', [x + 18, 5.57, z + 15.2], 6, 'Stabilize the Fold Engine', 'relay', ['engine']);
      const gate = this.box([x, 2.9, z + 28], [0.35, 5.8, 7.5], this.material('#425c4f'), true, false)!;
      gate.mesh.userData.portalable = false;
      this.doors.push({ mesh: gate.mesh, collider: gate, homeY: 2.9, switchIds: [], minimumStage: 6, open: 0 });
      for (let i = 0; i < 3; i++) {
        const ring = new T.Mesh(new T.TorusGeometry(3 + i * 0.35, 0.08, 8, 72), this.material(i === 1 ? '#dbb884' : '#92c5b0', undefined, 0.65));
        ring.position.set(x + 15, 8, z + 25);
        ring.rotation.x = Math.PI / 2 + i * 0.3;
        ring.rotation.y = i * 0.65;
        ring.userData.rate = (i % 2 ? 1 : -1) * 0.12;
        this.scene.add(ring); this.animated.push(ring);
      }
      this.cylinder([x + 15, 0.8, z + 25], 3.7, 1.6, this.material('#4a6253'), 3.1, 32);
    } else this.console('momentum', [x + 15, 5.58, z + 14.6], 1, 'Activate the momentum receiver');
  }

  private rooftop() {
    const floor = this.box([22, 7.8, 0], [13, 0.4, 14], this.material('#adb4a0', 'concrete'))!;
    const back = this.box([27.8, 10.1, -1], [0.4, 4.2, 9], this.material('#b4b5a2', 'concrete'))!;
    this.anchor('theater-roof', [27.57, 9.95, -0.8], [-1, 0, 0], [back.id]);
    this.anchor('theater-street', [13.5, 2.19, 16.9], [-1, 0, 0]);
    this.console('transit', [21, 9.2, -4.1], 2, 'Restore the downtown transit relay');
    this.console('rail', [25.4, 9.2, -4.1], 2, 'Read the maintenance log', 'note');
    this.box([22, 8.35, -6.6], [13, 0.7, 0.25], this.material('#8d9986'));
    this.box([15.65, 8.35, 0], [0.25, 0.7, 14], this.material('#8d9986'));
    this.sign('03 / DOWNTOWN TRANSIT', 'A TOWN BUILT ON CONNECTIONS.', [27.56, 12.45, -0.8], 8, 0.8, [-1, 0, 0]);
    const roofHosts = this.colliders.filter(c => c.box.containsPoint(new T.Vector3(24.8, 7, 3.8))).map(c => c.id);
    this.anchor('roof-floor', [24.8, 8.03, 3.8], [0, 1, 0], [floor.id, ...roofHosts], 3.9, 4.2);
  }

  private lakeshore() {
    const geometry = new T.PlaneGeometry(42, 40, 28, 28);
    geometry.rotateX(-Math.PI / 2);
    const material = this.waterMaterial();
    const water = new T.Mesh(geometry, material);
    water.position.set(-69, 0.075, -49);
    water.receiveShadow = true;
    this.scene.add(water);
    this.box([-70, 0.43, -52], [11, 0.86, 10], this.material('#c0b296', 'ground'));
    this.box([-49.5, 0.37, -35.5], [12, 0.22, 3.5], this.material('#97876a'));
    for (const x of [-55, -52, -49, -46]) {
      for (const z of [-37, -34]) this.cylinder([x, 0.4, z], 0.1, 1.3, this.material('#5c6350'));
    }
    this.anchor('lake-shore', [-44, 1.95, -31], [0, 0, 1]);
    this.anchor('lake-island', [-73, 2.81, -55.2], [0, 0, 1]);
    this.cube('lake-core', [-43, 0.55, -28.9], 3);
    this.floorSwitch('lake', -70, 0.86, -50.1);
    this.sign('04 / LAKESHORE EXPERIMENT', 'LATHROP FIELD RESERVE', [-70, 5.3, -55.4], 8, 1);
    this.sign('LATHROP FIELD RESERVE', 'NO SWIMMING / SPATIAL RESEARCH IN PROGRESS', [-41, 2.7, -38.5], 5, 1.2);
    this.console('lake', [-66.5, 2.1, -54], 3, 'Read the lakeshore log', 'note');
    this.tree(-73.4, -51, 4.5, 0.9);
    this.tree(-65.8, -49, 3.5, 0.9);
    for (let i = 0; i < 22; i++) this.rock(-91 + random() * 46, -70 + (i % 2) * 43, 0.5 + random() * 1.1);
    return water;
  }

  private array() {
    this.box([-15, 3.35, -99], [24, 0.5, 22], this.material('#afb2a0', 'concrete'));
    for (const x of [-25, -5]) for (const z of [-108, -90]) this.box([x, 1.6, z], [0.4, 3.2, 0.4], this.material('#627960'));
    for (let i = 0; i < 12; i++) {
      const h = (i + 1) * 0.3;
      this.box([-12, h / 2, -77.4 - i * 0.88], [4, h, 0.9], this.material('#a6ab91', 'concrete'));
    }
    this.box([-12, 3.45, -88], [4, 0.3, 2], this.material('#a6ab91', 'concrete'));
    this.anchor('array-deck', [-6, 5.55, -91], [0, 0, 1]);
    this.box([-22, 9.72, -103], [7, 0.45, 7], this.material('#a4ae97'));
    const back = this.box([-22, 12, -106.6], [7.5, 4.2, 0.35], this.material('#858f7d'))!;
    this.anchor('array-ledge', [-22, 11.895, -106.39], [0, 0, 1], [back.id]);
    this.cube('array-high-core', [-23.7, 10.5, -103.4], 4);
    this.cube('array-deck-core', [-17.5, 4.1, -101.5], 4);
    this.floorSwitch('array-a', -9, 3.6, -99.8);
    this.floorSwitch('array-b', -19, 3.6, -94);
    this.console('array', [-9, 4.85, -106], 4, 'Balance the Spanish Peaks array', 'relay', ['array-a', 'array-b']);
    this.console('peaks', [-14, 4.85, -106], 4, 'Read the ridge log', 'note');
    this.sign('05 / SPANISH PEAKS ARRAY', 'THE LAND REMEMBERS.', [-14, 7.3, -109], 12, 1.2);
    this.cylinder([-32, 7.5, -112], 0.48, 15, this.material('#6f7a63'), 0.25);
    const dish = new T.Mesh(new T.SphereGeometry(5, 28, 16, 0, Math.PI * 2, 0, 0.35 * Math.PI), new T.MeshStandardMaterial({ color: '#d0cfb9', side: T.DoubleSide, roughness: 0.7 }));
    dish.position.set(-32, 14.6, -112); dish.rotation.z = 0.65; this.scene.add(dish); this.staticMeshes.push(dish);
    this.cylinder([-32, 18.7, -112], 0.06, 4.8, this.material('#555d4e'));
    for (const z of [-90, -109]) this.box([-15, 4.18, z], [23.5, 1.1, 0.12], this.material('#667c65'), false);
  }

  private gravityLaboratory() {
    const x = 70;
    const floor = this.box([x, 0.06, -185], [24, 0.12, 30], this.material('#373c36', 'concrete'))!;
    const rockwall = this.material('#404740', 'concrete');
    const sideLeft = this.box([58, 4.55, -185], [0.5, 9.1, 30], rockwall)!;
    this.box([82, 4.55, -185], [0.5, 9.1, 30], rockwall);
    this.box([x, 4.55, -200], [24, 9.1, 0.5], rockwall);
    const ceiling = this.box([x, 9.3, -185], [24, 0.45, 30], this.material('#303832'))!;

    // The open rock-cut threshold leads directly from the ridge trail into the facility.
    this.box([62.75, 4.55, -170], [9.5, 9.1, 0.6], this.material('#444c43'));
    this.box([77.25, 4.55, -170], [9.5, 9.1, 0.6], this.material('#444c43'));
    this.box([x, 7.05, -170], [5, 4.1, 0.6], rockwall);
    const entrance = this.box([x, 2.4, -170], [5, 4.8, 0.28], this.material('#596555'), true, false)!;
    entrance.mesh.userData.portalable = false;
    const labDoor: Door = { mesh: entrance.mesh, collider: entrance, homeY: 2.4, switchIds: [], minimumStage: 0, travel: 5.2, open: 0 };
    this.doors.push(labDoor);
    this.sign('FIELD SHUTTER', 'E / RELEASE OR ENTER', [70, 3.05, -169.61], 4.6, 0.7, [0, 0, 1], '#d8e4ca', '#304238');
    this.console('lab-shutter', [70, 2.4, -167.5], 0, 'Release the mountain lab shutter', 'door', undefined, undefined, labDoor);

    // The second vault is reachable on ordinary footing or by inverting gravity.
    this.box([62.75, 4.55, -188], [9.5, 9.1, 0.5], rockwall);
    this.box([77.25, 4.55, -188], [9.5, 9.1, 0.5], rockwall);
    this.box([x, 7.05, -188], [5, 4.1, 0.5], rockwall);
    const vaultDoor = this.box([x, 2.4, -188], [5, 4.8, 0.28], this.material('#4f6251'), true, false)!;
    vaultDoor.mesh.userData.portalable = false;
    this.doors.push({ mesh: vaultDoor.mesh, collider: vaultDoor, homeY: 2.4, switchIds: [], minimumStage: 5, travel: 5.2, open: 0 });

    this.anchor('inversion-west', [58.27, 4.2, -180], [1, 0, 0], [sideLeft.id], 4, 5);
    this.anchor('inversion-floor', [73.5, 0.126, -180], [0, 1, 0], [floor.id], 4.5, 4.8);
    this.anchor('inversion-ceiling', [73.5, 9.065, -180], [0, -1, 0], [ceiling.id], 4.5, 5);
    this.anchor('inversion-observatory', [77.74, 7.25, -196], [-1, 0, 0]);
    this.sign('06 / INVERSION LAB', 'HUERFANO SPATIAL RESEARCH / SUBSURFACE', [x, 7.18, -169.66], 9, 0.8, [0, 0, 1]);
    this.sign('OBJECTIVE / UPPER OBSERVATORY', 'SHIFT YOUR GRAVITY TO REACH THE RECEIVER', [x, 8.15, -197.5], 9, 0.7, [0, 0, 1], '#d8e4ca', '#304238');

    this.box([65.5, 0.72, -183], [2, 1.35, 2], this.material('#414c42'));
    this.box([65.5, 1.43, -183], [2.18, 0.15, 2.18], this.material('#72816c'));
    this.console('gravity-shifter', [65.5, 2.15, -181.98], 5, 'Retrieve the Vector Shifter', 'gravity');
    const rig = new T.Group();
    rig.position.set(65.5, 1.95, -183);
    const core = new T.Mesh(new T.DodecahedronGeometry(0.29, 1), new T.MeshStandardMaterial({ color: '#c5d8b5', metalness: 0.35, roughness: 0.35, emissive: '#83be84', emissiveIntensity: 0.8 }));
    core.position.y = 0.53;
    rig.add(core);
    for (let i = 0; i < 3; i++) {
      const ring = new T.Mesh(new T.TorusGeometry(0.65 + i * 0.11, 0.026, 6, 48), new T.MeshBasicMaterial({ color: i === 1 ? '#eccb91' : '#a7e1b4', transparent: true, opacity: 0.72, toneMapped: false }));
      ring.position.y = 0.53;
      ring.rotation.set(i * 0.48, 0.2 + i * 0.7, i * 0.37);
      ring.userData.rate = (i === 1 ? -1 : 1) * (0.2 + i * 0.05);
      rig.add(ring); this.animated.push(ring);
    }
    this.scene.add(rig);

    this.box([70, 0.65, -194.7], [5.1, 0.12, 4.5], this.material('#596b58'));
    this.box([70, 1.12, -196.5], [0.12, 0.9, 0.12], this.material('#93b397'));
    this.console('gravity-observatory', [70, 7.25, -199.67], 5, 'Calibrate the upper observatory', 'relay', undefined, 2);
    this.console('vector', [75, 1.4, -182.3], 5, 'Read the Vector Shifter field log', 'note');
    this.box([70, 8.95, -194], [9, 0.08, 0.14], this.material('#b5d8ae', undefined, 0.6), false);

    this.sign('INVERSION LAB', 'A NICE, SOLID MOUNTAIN OVER YOUR HEAD.', [53, 3.5, -170.2], 4.4, 0.8, [0, 0, 1], '#d9ddc4', '#324033');
    this.sign('SPANISH PEAKS FIELD STATION', 'FOLLOW THE LOW GREEN MARKERS', [64, 2.8, -146], 5, 0.85, [0, 0, 1], '#d8dec3', '#39443a');

    // Flat, traversable trail slabs connect the existing array to the rock-cut entrance.
    const trail = this.material('#a49370', 'ground');
    this.box([19, 0.025, -120], [70, 0.05, 4.6], trail, false, true, false);
    this.box([64, 0.03, -143], [4.6, 0.06, 47], trail, false, true, false);
    for (const [tx, tz] of [[18, -120], [42, -120], [64, -133], [64, -152]] as const) {
      this.box([tx, 1.1, tz], [0.12, 2.2, 0.12], this.material('#4f5a47'), false);
      this.box([tx, 2.19, tz], [0.32, 0.19, 0.32], this.material('#bed19c', undefined, 0.7), false);
    }
    this.rock(49, -187, 5);
    this.rock(100, -186, 8);
    this.rock(70, -212, 7);
    this.rock(48, -211, 4);
    this.rock(101, -166, 7);
    this.rockMass([61, 4.1, -170], [4.1, 5, 2.1]);
    this.rockMass([79, 4.1, -170], [4.1, 5, 2.1]);
    this.rockMass([70, 10, -170], [5.6, 2.1, 2.3]);
  }

  /** Continuous ridge height, faded to ground at the sheet borders and cut away around the field lab and its approach. */
  private mountainHeight(x: number, z: number) {
    const west = Math.exp(-Math.pow(Math.hypot((x + 53) / 60, (z + 237) / 59), 1.32)) * 112;
    const east = Math.exp(-Math.pow(Math.hypot((x - 39) / 57, (z + 247) / 54), 1.26)) * 102;
    const ridge = Math.sin(x * 0.075 + z * 0.022) * 2.8 + Math.sin(x * 0.18 - z * 0.12) * 1.6;
    // The sheet rises out of the valley floor instead of starting as a cliff at its own border.
    const border = Math.min(
      T.MathUtils.clamp((-135 - z - 18) / 72, 0, 1),
      T.MathUtils.clamp((z + 495) / 90, 0, 1),
      T.MathUtils.clamp((x + 380) / 130, 0, 1),
      T.MathUtils.clamp((380 - x) / 130, 0, 1),
    );
    // A small constant sink keeps the flat parts of the sheet just below the valley floor,
    // so the ridge and the ground plane never fight over the same pixels where they meet.
    return Math.max(0, Math.max(west, east) + ridge - 3) * border * this.siteCarve(x, z) - 0.4;
  }

  /** 1 leaves the ridge intact, 0 removes it entirely, with a smooth blend between. */
  private siteCarve(x: number, z: number) {
    return Math.min(
      this.rectCarve(x, z, 44, 96, -208, -156, 34),
      this.polylineCarve(x, z, [[-24, -120], [58, -120], [64, -142], [70, -176]], 11, 16),
    );
  }

  private rectCarve(x: number, z: number, minX: number, maxX: number, minZ: number, maxZ: number, blend: number) {
    const dx = Math.max(minX - x, 0, x - maxX);
    const dz = Math.max(minZ - z, 0, z - maxZ);
    return Math.min(1, Math.hypot(dx, dz) / blend);
  }

  private polylineCarve(x: number, z: number, points: [number, number][], halfWidth: number, blend: number) {
    let nearest = Infinity;
    for (let i = 0; i < points.length - 1; i++) nearest = Math.min(nearest, this.segmentDistance(x, z, points[i], points[i + 1]));
    return T.MathUtils.clamp((nearest - halfWidth) / blend, 0, 1);
  }

  private segmentDistance(x: number, z: number, a: [number, number], b: [number, number]) {
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const lengthSquared = dx * dx + dz * dz;
    const t = lengthSquared === 0 ? 0 : T.MathUtils.clamp(((x - a[0]) * dx + (z - a[1]) * dz) / lengthSquared, 0, 1);
    return Math.hypot(x - (a[0] + dx * t), z - (a[1] + dz * t));
  }

  /**
   * The ridge is a solid body rather than scenery. Stepped colliders are generated from the same
   * height function as the mesh, so nothing can walk through the rock and the walkable apron
   * matches what is on screen. Cell tops use the highest sampled corner, which keeps bodies
   * outside the visible surface instead of letting them sink into it.
   */
  private mountainColliders() {
    const cell = 6;
    const shared = new T.Mesh(new T.BoxGeometry(cell, 1, cell), this.material('#8a8f84'));
    shared.visible = false;
    // The band covers the whole reachable width of the ridge, out to the world boundary walls.
    for (let x = -152; x < 152; x += cell) {
      for (let z = -140; z > -220; z -= cell) {
        const height = Math.max(
          this.mountainHeight(x, z),
          this.mountainHeight(x + cell, z),
          this.mountainHeight(x, z - cell),
          this.mountainHeight(x + cell, z - cell),
          this.mountainHeight(x + cell / 2, z - cell / 2),
        );
        if (height < 0.6) continue;
        this.colliders.push({
          id: this.id++,
          mesh: shared,
          box: new T.Box3(new T.Vector3(x, -2, z - cell), new T.Vector3(x + cell, height, z)),
          enabled: true,
        });
      }
    }
  }

  private mountains() {
    const geometry = new T.PlaneGeometry(760, 360, 110, 60);
    geometry.rotateX(-Math.PI / 2);
    geometry.translate(0, 0, -315);
    const positions = geometry.attributes.position;
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i);
      const z = positions.getZ(i);
      // Sink the outermost ring beneath the valley floor so the base never floats above the terrain.
      const border = Math.min(-135 - z, z + 495, x + 380, 380 - x);
      positions.setY(i, border <= 0.01 ? -2.5 : this.mountainHeight(x, z));
    }
    geometry.computeVertexNormals();
    // Colour follows slope as well as height: meadow and scrub on gentle ground, bare rock on steep
    // faces and the high ridge, and snow that settles only where it is flat enough to stay.
    const normals = geometry.attributes.normal;
    const colors: number[] = [];
    const color = new T.Color();
    const meadow = new T.Color('#7c8a66');
    const scrub = new T.Color('#8e8a70');
    const rock = new T.Color('#6c6d66');
    const scree = new T.Color('#8a857a');
    const snow = new T.Color('#e6e8e2');
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i);
      const y = positions.getY(i);
      const z = positions.getZ(i);
      const steep = 1 - normals.getY(i);
      const grain = Math.sin(x * 0.21 + z * 0.13) * 0.5 + Math.sin(x * 0.047 - z * 0.081) * 0.5;
      color.copy(meadow).lerp(scrub, T.MathUtils.clamp(0.5 + grain * 0.5 + y * 0.008, 0, 1));
      color.lerp(rock, Math.min(1, T.MathUtils.smoothstep(steep, 0.16, 0.4) * 0.9 + T.MathUtils.smoothstep(y, 36, 62) * 0.6));
      color.lerp(scree, T.MathUtils.smoothstep(y, 50, 78) * 0.35);
      const snowline = 70 + grain * 7;
      color.lerp(snow, T.MathUtils.smoothstep(y, snowline - 6, snowline + 6) * (1 - T.MathUtils.smoothstep(steep, 0.45, 0.7)));
      color.multiplyScalar(0.92 + random() * 0.12);
      colors.push(color.r, color.g, color.b);
    }
    geometry.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
    const mesh = new T.Mesh(geometry, new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.96 }));
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    this.mountainColliders();
  }

  private tree(x: number, z: number, height: number, base = 0) {
    this.cylinder([x, base + height * 0.35, z], height * 0.045, height * 0.7, this.material('#756e50'), height * 0.025, 7);
    for (let i = 0; i < 4; i++) {
      const mesh = new T.Mesh(new T.IcosahedronGeometry(height * 0.27, 1), this.faceted(i % 2 ? '#738957' : '#869a69'));
      mesh.position.set(x + Math.sin(i * 2.4) * height * 0.17, base + height * (0.68 + i * 0.085), z + Math.cos(i * 2.4) * height * 0.15);
      mesh.scale.set(1, 0.84, 0.9);
      mesh.rotation.set(random(), random(), random());
      mesh.castShadow = true; this.scene.add(mesh); this.staticMeshes.push(mesh);
    }
  }

  private rock(x: number, z: number, size: number) {
    const mesh = new T.Mesh(new T.IcosahedronGeometry(size, 1), this.faceted('#a09b86'));
    mesh.position.set(x, size * 0.35, z);
    mesh.scale.set(1.5, 0.75, 1);
    mesh.rotation.set(random(), random() * 3, random());
    mesh.castShadow = true; mesh.receiveShadow = true;
    this.scene.add(mesh); this.staticMeshes.push(mesh);
  }

  private rockMass(position: Vec3, scale: Vec3) {
    const mesh = new T.Mesh(new T.IcosahedronGeometry(1, 1), this.material('#858576', 'ground'));
    mesh.position.set(...position);
    mesh.scale.set(...scale);
    mesh.rotation.set(random() * 0.16, random() * 1.8, random() * 0.12);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    this.staticMeshes.push(mesh);
    const size = vector(scale);
    const center = vector(position);
    const collider = { id: this.id++, mesh, box: new T.Box3(center.clone().sub(size), center.clone().add(size)), enabled: true };
    mesh.userData.portalColliderId = collider.id;
    this.colliders.push(collider);
  }

  private landscape() {
    for (let i = 0; i < 58; i++) {
      const side = i % 2 ? 1 : -1;
      const x = side * (62 + random() * 58);
      const z = 45 - random() * 180;
      if (x > -93 && x < -42 && z > -72 && z < -25) continue;
      // Keep the northern approach to the mountain lab clear of stray scenery.
      if (z < -108 && x > 38 && x < 112) continue;
      // And keep the Pueblo highway corridor driveable.
      if (z > -46 && z < -4 && x > 55) continue;
      if (i % 3 === 0) this.tree(x, z, 3.5 + random() * 3);
      else this.rock(x, z, 0.5 + random() * 1.6);
    }
    const grassGeometry = new T.ConeGeometry(0.17, 0.62, 4, 1);
    const blade = grassGeometry.attributes.position;
    const shading: number[] = [];
    const root = new T.Color('#5e5c43');
    const tip = new T.Color('#c8be8c');
    const shade = new T.Color();
    for (let i = 0; i < blade.count; i++) {
      shade.copy(root).lerp(tip, (blade.getY(i) + 0.31) / 0.62);
      shading.push(shade.r, shade.g, shade.b);
    }
    grassGeometry.setAttribute('color', new T.Float32BufferAttribute(shading, 3));
    const grass = new T.InstancedMesh(grassGeometry, this.grassMaterial(), 1600);
    const matrix = new T.Matrix4();
    const q = new T.Quaternion();
    const tuft = new T.Color();
    let count = 0;
    for (let i = 0; i < 2200 && count < 1600; i++) {
      const x = (random() - 0.5) * 260;
      const z = random() * 210 - 145;
      if ((Math.abs(x) < 31 && z > -74) || (z > -32 && z < -18) || (x < -43 && x > -95 && z > -73 && z < -26) || (x > 27 && x < 68 && z > -108 && z < -18) || (x > -29 && x < 0 && z < -77)) continue;
      q.setFromAxisAngle(UP, random() * Math.PI);
      matrix.compose(new T.Vector3(x, 0.18, z), q, new T.Vector3(0.7 + random(), 0.5 + random(), 0.7 + random()));
      grass.setMatrixAt(count, matrix);
      // Per-tuft tint from a position hash, so the shared random sequence (and everything built after it) is unchanged.
      const hash = Math.abs(Math.sin(x * 12.9898 + z * 78.233) * 43758.5453) % 1;
      tuft.setRGB(0.84 + hash * 0.28, 0.86 + hash * 0.22, 0.8 + (1 - hash) * 0.16);
      grass.setColorAt(count, tuft);
      count++;
    }
    grass.count = count;
    if (grass.instanceColor) grass.instanceColor.needsUpdate = true;
    this.scene.add(grass);
    for (let z = 37; z > -99; z -= 32) {
      this.cylinder([29, 5, z], 0.12, 10, this.material('#786c52'));
      this.box([29, 9.2, z], [3.2, 0.16, 0.15], this.material('#70694e'), false);
      if (z < 37) {
        for (const x of [27.7, 30.3]) {
          const points = [new T.Vector3(x, 9.3, z), new T.Vector3(x, 8.4, z + 16), new T.Vector3(x, 9.3, z + 32)];
          const curve = new T.CatmullRomCurve3(points);
          const line = new T.Line(new T.BufferGeometry().setFromPoints(curve.getPoints(18)), new T.LineBasicMaterial({ color: '#586158' }));
          this.scene.add(line);
        }
      }
    }
    this.sign('WALSENBURG', 'WELCOME HOME. MORE OR LESS.', [4.8, 2.3, 55], 6, 1.7, [0, 0, -1]);
    for (const x of [2.8, 6.8]) this.box([x, 1.1, 55], [0.12, 2.2, 0.12], this.material('#6b725b'));
  }

  /** Large paved areas: the shared surface texture, projected at its real-world scale. */
  private tiledMaterial(color: string, kind: SurfaceKind) {
    const material = new T.MeshStandardMaterial({ color, map: this.textures[kind], roughness: 0.88, metalness: 0.02 });
    worldMapping(material, WORLD_TILE[kind] ?? 6, kind === 'ground');
    return material;
  }

  /**
   * Every city facade shares one material and one draw call. Window panes are derived from world
   * position rather than UVs, so a 6 m storefront and a 100 m tower get identically sized glass
   * instead of a stretched texture.
   */
  private facadeMaterial() {
    const material = new T.MeshStandardMaterial({ color: '#ffffff', roughness: 0.84, metalness: 0.05 });
    material.onBeforeCompile = shader => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vFoldWorld;')
        .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
          #ifdef USE_INSTANCING
            vFoldWorld = ( modelMatrix * instanceMatrix * vec4( transformed, 1.0 ) ).xyz;
          #else
            vFoldWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
          #endif`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vFoldWorld;')
        .replace('#include <color_fragment>', `#include <color_fragment>
          vec3 foldFace = normalize( cross( dFdx( vFoldWorld ), dFdy( vFoldWorld ) ) );
          float foldUpright = 1.0 - step( 0.55, abs( foldFace.y ) );
          vec2 foldPlane = abs( foldFace.x ) > abs( foldFace.z ) ? vFoldWorld.zy : vFoldWorld.xy;
          vec2 foldCell = foldPlane / vec2( 3.2, 3.8 );
          vec2 foldPane = fract( foldCell );
          float foldGlass = step( 0.17, foldPane.x ) * step( foldPane.x, 0.83 ) * step( 0.28, foldPane.y ) * step( foldPane.y, 0.84 );
          float foldWindow = foldUpright * foldGlass * step( 4.6, vFoldWorld.y );
          float foldLit = step( 0.62, fract( sin( dot( floor( foldCell ), vec2( 12.9898, 78.233 ) ) ) * 43758.5453 ) );
          // A darker band at each floor slab, so towers read as stacked storeys rather than flat slabs.
          float foldSlab = foldUpright * ( 1.0 - step( 0.06, fract( vFoldWorld.y / 3.8 ) ) ) * step( 4.0, vFoldWorld.y );
          diffuseColor.rgb *= 1.0 - foldSlab * 0.28;
          diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.16, 0.2, 0.22 ), foldWindow );`)
        // Glazing is smooth and faintly metallic, so windows catch the sky at a glance down the street.
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
          roughnessFactor = mix( roughnessFactor, 0.07, foldWindow );`)
        .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
          metalnessFactor = mix( metalnessFactor, 0.45, foldWindow );`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          totalEmissiveRadiance += vec3( 1.0, 0.84, 0.58 ) * foldWindow * foldLit * 0.18;`);
    };
    return material;
  }

  private solid(mesh: T.Mesh, center: T.Vector3, half: T.Vector3) {
    const collider: Collider = { id: this.id++, mesh, box: new T.Box3(center.clone().sub(half), center.clone().add(half)), enabled: true };
    this.colliders.push(collider);
    return collider;
  }

  /**
   * Pueblo: a grid city roughly 650 m across, about the span of five of the ridge's peaks.
   * Building masses, roof caps, street lights, and traffic are instanced, so the whole skyline
   * costs a handful of draw calls no matter how many blocks are on screen.
   */
  private pueblo() {
    const WEST = 240, EAST = 890, NORTH = -120, SOUTH = 270, PITCH = 78, ROAD = 8;
    const stone = this.material('#9aa094', 'concrete');

    // Ground is split either side of the river so the channel is a genuine hole, not a painted one.
    this.box([685, -1, -103.5], [550, 2, 333], this.material('#b3a98c', 'ground'));
    this.box([685, -1, 204.5], [550, 2, 235], this.material('#b3a98c', 'ground'));
    this.box([685, -3, 75], [550, 2, 24], this.material('#6f7363'));

    const paving = this.tiledMaterial('#6d7173', 'road');
    this.box([565, -0.02, -38], [686, 0.08, 202], paving, false, true, false);
    this.box([565, -0.02, 193], [686, 0.08, 214], paving, false, true, false);

    // Highway in from Walsenburg.
    this.box([157, -0.02, -25], [172, 0.08, 11], this.tiledMaterial('#63676a', 'road'), false, true, false);
    for (let x = 90; x < 236; x += 18) this.box([x, 0.05, -25], [6, 0.02, 0.18], this.material('#cfc69d'), false, true, false);
    this.sign('PUEBLO', 'CITY LIMIT  /  POPULATION: OPTIMISTIC', [226, 4.4, -32], 12, 2.6, [0, 0, 1], '#e7e2cd', '#3c4a40');
    for (const x of [219, 233]) this.box([x, 2.2, -32], [0.5, 4.4, 0.5], stone);
    this.sign('STEEL DISTRICT  /  DOWNTOWN  /  RIVERWALK', 'KEEP YOUR FOLDS OFF THE FREEWAY', [300, 3.1, -41.6], 16, 1.3, [0, 0, 1]);

    const blocks: { x: number; z: number; coreness: number }[] = [];
    const reserved = new Set(['279,-81', '357,-81', '513,-3', '591,-81', '747,-81', '825,231']);
    for (let gx = WEST; gx < EAST; gx += PITCH) {
      for (let gz = NORTH; gz < SOUTH; gz += PITCH) {
        const x = gx + PITCH / 2;
        const z = gz + PITCH / 2;
        if (z > 46 && z < 104) continue;
        const span = (x - WEST) / (EAST - WEST);
        const coreness = Math.max(0, 1 - Math.abs(span - 0.42) / 0.3);
        this.box([x, 0.01, z], [PITCH - ROAD * 2 + 7, 0.1, PITCH - ROAD * 2 + 7], this.material('#a9a694'), false, true, false);
        if (!reserved.has(`${x},${z}`)) blocks.push({ x, z, coreness });
      }
    }

    const facades: { position: T.Vector3; size: T.Vector3; color: T.Color }[] = [];
    const palette = ['#b9a98f', '#9fa79b', '#c0ab93', '#8e9a96', '#ad9f8c', '#a09d8b', '#8f9388', '#c3b49c'];
    for (const block of blocks) {
      const lots = block.coreness > 0.55 ? 2 : 3;
      const lot = (PITCH - ROAD * 2) / lots;
      for (let i = 0; i < lots; i++) for (let j = 0; j < lots; j++) {
        if (random() < 0.12) continue;
        const footprint = lot * (0.64 + random() * 0.22);
        const height = (5 + block.coreness * block.coreness * 54) * (0.55 + random() * 0.95);
        facades.push({
          position: new T.Vector3(block.x - (PITCH - ROAD * 2) / 2 + lot * (i + 0.5), height / 2, block.z - (PITCH - ROAD * 2) / 2 + lot * (j + 0.5)),
          size: new T.Vector3(footprint, height, lot * (0.64 + random() * 0.22)),
          color: new T.Color(palette[Math.floor(random() * palette.length)]).multiplyScalar(0.88 + random() * 0.24),
        });
      }
    }

    this.instancedBoxes(facades, this.facadeMaterial(), { portalable: true, solid: true });
    this.instancedBoxes(facades.map(facade => ({
      position: new T.Vector3(facade.position.x, facade.size.y + 0.35, facade.position.z),
      size: new T.Vector3(facade.size.x + 0.9, 0.7, facade.size.z + 0.9),
      color: new T.Color('#6f7469'),
    })), this.material('#6f7469'));

    this.steelWorks();
    this.civicCenter();
    this.puebloTower();
    this.stadium();
    this.riverwalk();
    this.park();
    this.streetFurniture(WEST, EAST, NORTH, SOUTH, PITCH);
  }

  /**
   * One InstancedMesh for a whole category of city geometry. Masses that the player can run into
   * also get a collider each; decorative trim (roof caps, lamp posts, car roofs) stays collision-free
   * so thin props cannot snag movement.
   */
  private instancedBoxes(
    items: { position: T.Vector3; size: T.Vector3; color: T.Color }[],
    material: T.Material,
    options: { portalable?: boolean; solid?: boolean } = {},
  ) {
    if (items.length === 0) return null;
    const mesh = new T.InstancedMesh(new T.BoxGeometry(1, 1, 1), material, items.length);
    const matrix = new T.Matrix4();
    const identity = new T.Quaternion();
    const colliderIds: number[] = [];
    items.forEach((item, index) => {
      matrix.compose(item.position, identity, item.size);
      mesh.setMatrixAt(index, matrix);
      mesh.setColorAt(index, item.color);
      colliderIds.push(options.solid ? this.solid(mesh, item.position, item.size.clone().multiplyScalar(0.5)).id : -1);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.userData.instanceColliders = colliderIds;
    mesh.userData.portalable = options.portalable === true;
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    if (options.portalable) this.shootables.push(mesh);
    return mesh;
  }

  private steelWorks() {
    const shell = this.material('#8d8578', 'concrete');
    const iron = this.material('#6b655c');
    for (let i = 0; i < 3; i++) {
      this.box([272 + i * 44, 11, -81], [34, 22, 64], shell);
      this.box([272 + i * 44, 22.6, -81], [35, 1.4, 65], iron);
    }
    for (let i = 0; i < 4; i++) {
      this.cylinder([256 + i * 42, 23, -118], 3.4, 46, this.material('#9c7f6b'), 2.6, 14);
      this.cylinder([256 + i * 42, 46.6, -118], 3.8, 1.6, iron, 3.8, 14);
    }
    this.box([330, 27, -118], [148, 2.2, 3], iron);
    this.sign('PUEBLO STEEL & RAIL', 'FOUNDED LONG BEFORE ANY OF THIS', [330, 25.4, -45.4], 26, 3.1, [0, 0, 1], '#e4d8bd', '#4a3c32');
  }

  private civicCenter() {
    const stone = this.material('#c6c0ab', 'concrete');
    // Hollow grand civic rotunda:
    // Outer walls:
    this.box([513, 7, -27.6], [50, 14, 0.8], stone); // North wall
    this.box([488.4, 7, -3], [0.8, 14, 50], stone);  // West wall
    this.box([537.6, 7, -3], [0.8, 14, 50], stone);  // East wall
    this.box([513, 14.2, -3], [50, 0.6, 50], this.material('#9aa094')); // Roof slab
    this.box([513, 14.5, -3], [54, 1.4, 54], this.material('#9aa094'));

    // South front facade with grand double entrance:
    this.box([499.5, 7, 21.6], [23, 14, 0.8], stone);
    this.box([526.5, 7, 21.6], [23, 14, 0.8], stone);
    this.box([513, 9.5, 21.6], [6, 5, 0.8], stone); // Doorway lintel (4m high opening)

    // Colonnade portico in front:
    for (let i = 0; i < 8; i++) {
      if (i === 3 || i === 4) continue; // Keep doorway entrance clear between middle columns!
      this.cylinder([493 + i * 5.7, 7, 21], 1.1, 14, stone);
    }

    // Rotunda dome above:
    const dome = new T.Mesh(new T.SphereGeometry(13, 26, 14, 0, Math.PI * 2, 0, Math.PI / 2), this.material('#8fae9c'));
    dome.position.set(513, 15, -3);
    dome.castShadow = true;
    this.scene.add(dome);
    this.staticMeshes.push(dome);
    this.cylinder([513, 30, -3], 0.4, 8, this.material('#c9b182'));
    this.sign('CIVIC HALL', 'PUEBLO  /  COLORADO', [513, 10.5, 22.2], 16, 2.2, [0, 0, 1], '#e9e2c8', '#3e4a3e');

    // Walkable interior floor:
    this.box([513, 0.05, -3], [48, 0.1, 48], this.material('#b8b4a2', 'concrete'));

    // Central state seal medallion on the rotunda floor:
    const seal = new T.Mesh(new T.CircleGeometry(4.5, 24), this.material('#3d677a', undefined, 0.15));
    seal.rotation.x = -Math.PI / 2;
    seal.position.set(513, 0.06, -3);
    this.scene.add(seal);

    // Ring of 6 classical interior columns supporting the dome:
    for (let i = 0; i < 6; i++) {
      const ang = (i / 6) * Math.PI * 2;
      this.cylinder([513 + Math.cos(ang) * 13, 7, -3 + Math.sin(ang) * 13], 0.75, 14, stone);
    }

    // Council dais & podium at north wall:
    this.box([513, 0.45, -18], [16, 0.8, 5], stone);
    this.box([513, 1.25, -17], [12, 0.8, 1.2], this.material('#4e3624'));
    this.console('pueblo', [513, 1.8, -17], 0, 'Read the Pueblo field log', 'note');

    // White marble portalable wall on the north interior wall:
    this.anchor('civic-hall-north', [513, 4.5, -27.1], [0, 0, 1], [], 8.0, 5.5);
  }

  private puebloTower() {
    const glass = this.material('#8a9ba0');
    const trim = this.material('#6d7571');
    const tiers: Vec3[] = [[34, 46, 34], [27, 30, 27], [20, 22, 20]];
    let base = 0;
    for (const [w, h, d] of tiers) {
      this.box([591, base + h / 2, -81], [w, h, d], glass);
      this.box([591, base + h + 0.6, -81], [w + 1.6, 1.2, d + 1.6], trim);
      base += h;
    }
    this.cylinder([591, base + 9, -81], 1.3, 18, trim, 0.3);
    this.sign('PUEBLO TOWER', 'OBSERVATION LEVEL CLOSED FOR SPATIAL REASONS', [591, 10, -63.4], 22, 2.6, [0, 0, 1], '#dfe6d6', '#33403a');
  }

  private stadium() {
    const concrete = this.material('#b0ab97', 'concrete');
    for (let i = 0; i < 20; i++) {
      const angle = (i / 20) * Math.PI * 2;
      const x = 825 + Math.cos(angle) * 36;
      const z = 231 + Math.sin(angle) * 28;
      this.box([x, 7, z], [12, 14, 12], concrete);
    }
    this.box([825, 0.08, 231], [48, 0.12, 34], this.material('#7d9469'), false, true, false);
    this.sign('RIVERSIDE FIELD', 'HOME OF THE PUEBLO FOLDERS', [825, 17, 197], 22, 2.8, [0, 0, 1], '#e6e3cb', '#3b4a3c');
  }

  private riverwalk() {
    const water = new T.Mesh(new T.PlaneGeometry(546, 24), new T.MeshStandardMaterial({ color: '#4d6f72', roughness: 0.22, metalness: 0.5 }));
    water.rotation.x = -Math.PI / 2;
    water.position.set(685, -1.25, 75);
    this.scene.add(water);

    const bank = this.material('#8e8a76', 'concrete');
    // Kept just under deck level so the edging never pokes up through a bridge.
    for (const z of [62.4, 87.6]) this.box([685, -1.25, z], [546, 2.4, 1.2], bank, false, true, false);
    for (const x of this.riverBridges) {
      this.box([x, -0.5, 75], [19, 1, 30], this.material('#9d9a86', 'concrete'));
      for (const z of [60.5, 89.5]) {
        this.box([x, 0.55, z], [19, 1.1, 0.4], this.material('#5f6a60'));
        this.box([x, 1.1, z], [19, 0.22, 0.6], this.material('#79836f'));
      }
    }
    // Railings keep the promenade safe between crossings; the gaps are the bridges themselves.
    const spans = [412, ...this.riverBridges, 958];
    for (let i = 0; i < spans.length - 1; i++) {
      const from = i === 0 ? spans[0] : spans[i] + 10;
      const to = i === spans.length - 2 ? spans[i + 1] : spans[i + 1] - 10;
      if (to - from < 2) continue;
      for (const z of [61.6, 88.4]) this.box([(from + to) / 2, 0.55, z], [to - from, 1.1, 0.35], this.material('#6b7466'));
    }
    this.sign('THE RIVERWALK', 'WATCH YOUR STEP  /  AND YOUR VECTOR', [685, 3.4, 56], 18, 2, [0, 0, 1], '#dde7d6', '#35463d');
  }

  private park() {
    this.box([747, 0.04, -81], [62, 0.12, 62], this.material('#869a6c'), false, true, false);
    const trunks: { position: T.Vector3; size: T.Vector3; color: T.Color }[] = [];
    const canopy = new T.InstancedMesh(new T.IcosahedronGeometry(1, 1), this.material('#7c8d63'), 26);
    const matrix = new T.Matrix4();
    const spin = new T.Quaternion();
    for (let i = 0; i < 26; i++) {
      const x = 719 + random() * 56;
      const z = -109 + random() * 56;
      const scale = 2.4 + random() * 1.9;
      trunks.push({ position: new T.Vector3(x, scale * 0.7, z), size: new T.Vector3(0.5, scale * 1.4, 0.5), color: new T.Color('#6f6750') });
      spin.setFromAxisAngle(UP, random() * Math.PI);
      matrix.compose(new T.Vector3(x, scale * 1.9, z), spin, new T.Vector3(scale, scale * 0.82, scale));
      canopy.setMatrixAt(i, matrix);
    }
    canopy.instanceMatrix.needsUpdate = true;
    canopy.frustumCulled = false;
    this.scene.add(canopy);
    this.instancedBoxes(trunks, this.material('#6f6750'), { solid: true });
  }

  private streetFurniture(west: number, east: number, north: number, south: number, pitch: number, skip: [number, number] = [52, 98]) {
    const posts: { position: T.Vector3; size: T.Vector3; color: T.Color }[] = [];
    const lamps: { position: T.Vector3; size: T.Vector3; color: T.Color }[] = [];
    const bodies: { position: T.Vector3; size: T.Vector3; color: T.Color }[] = [];
    const cabins: { position: T.Vector3; size: T.Vector3; color: T.Color }[] = [];
    const paint = ['#9aa3a8', '#8c7f72', '#6f7f84', '#a09a86', '#7b8a74', '#9b8d8d'];
    const steel = new T.Color('#4f574e');
    const glow = new T.Color('#f3d49c');

    for (let gx = west; gx <= east; gx += pitch) {
      for (let z = north + 14; z < south; z += 26) {
        if (z > skip[0] && z < skip[1]) continue;
        for (const side of [-1, 1]) {
          posts.push({ position: new T.Vector3(gx + side * 10, 2.6, z), size: new T.Vector3(0.22, 5.2, 0.22), color: steel });
          lamps.push({ position: new T.Vector3(gx + side * 10, 5.35, z), size: new T.Vector3(0.7, 0.26, 0.4), color: glow });
        }
        if (random() < 0.44) {
          const x = gx + (random() < 0.5 ? -4.6 : 4.6);
          const color = new T.Color(paint[Math.floor(random() * paint.length)]);
          bodies.push({ position: new T.Vector3(x, 0.62, z + random() * 8), size: new T.Vector3(2, 1.05, 4.5), color });
          cabins.push({ position: new T.Vector3(x, 1.5, z + random() * 8 - 0.2), size: new T.Vector3(1.8, 0.85, 2.3), color: color.clone().multiplyScalar(0.72) });
        }
      }
    }
    this.instancedBoxes(posts, this.material('#4f574e'));
    this.instancedBoxes(lamps, this.material('#f3d49c', undefined, 0.95));
    this.instancedBoxes(bodies, this.material('#ffffff'), { solid: true });
    this.instancedBoxes(cabins, this.material('#ffffff'));
  }

  /**
   * Trinidad: a second full city far to the south, under Fisher's Peak. Victorian brick downtown,
   * a church spire, a neon theater, a plaza, a railyard, a coal camp, a lake with a dam, and a
   * flat-topped mesa you can climb with folds. Masses are instanced, like Pueblo, so the whole
   * city costs a handful of draw calls.
   */
  private trinidad() {
    const TW = -320, TE = 320, TN = 340, TS = 660, P = 80;
    const dirt = this.material('#b3a98c', 'ground');
    // City ground, leaving the river band and the lake basin genuinely open.
    this.box([-5, -1, 434], [710, 2, 228], dirt);
    this.box([90, -1, 676], [520, 2, 208], dirt);
    this.box([-265, -1, 586], [190, 2, 28], dirt);
    this.box([-265, -1, 763], [190, 2, 34], dirt);
    this.box([-350, -1, 670], [20, 2, 140], dirt);

    // The Purgatoire runs east-west through town, with three street bridges.
    this.box([-5, -3, 560], [710, 2, 24], this.material('#6f7363'));
    const river = new T.Mesh(new T.PlaneGeometry(700, 20, 1, 1), this.waterMaterial());
    river.rotation.x = -Math.PI / 2;
    river.position.set(-5, -1.2, 560);
    this.scene.add(river);
    const bank = this.material('#8e8a76', 'concrete');
    for (const z of [546.6, 573.4]) this.box([-5, -1.25, z], [706, 2.4, 1.2], bank, false, true, false);
    for (const x of [-140, 0, 140]) {
      this.box([x, -0.5, 560], [20, 1, 34], this.material('#9d9a86', 'concrete'));
      for (const z of [543, 577]) {
        this.box([x, 0.55, z], [20, 1.1, 0.4], this.material('#5f6a60'));
        this.box([x, 1.1, z], [20, 0.22, 0.6], this.material('#79836f'));
      }
    }

    // Trinidad Lake in the west, held by an earthen dam on its east side.
    this.box([-255, -3, 670], [150, 2, 140], this.material('#6f7363'));
    const lake = new T.Mesh(new T.PlaneGeometry(140, 130, 1, 1), this.waterMaterial());
    lake.rotation.x = -Math.PI / 2;
    lake.position.set(-255, -1.2, 670);
    this.scene.add(lake);
    const sand = this.material('#c9bd9a');
    this.box([-255, 0.0, 598.5], [154, 0.12, 3], sand, false, true, false);
    this.box([-255, 0.0, 741.5], [154, 0.12, 3], sand, false, true, false);
    this.box([-331.5, 0.0, 670], [3, 0.12, 146], sand, false, true, false);
    this.box([-172, 1.5, 670], [6, 5, 140], this.material('#8d8578', 'concrete'));
    this.sign('TRINIDAD LAKE', 'NO WAKE  /  FISH ARE WATCHING', [-172, 5.4, 670], 12, 1.6, [-1, 0, 0], '#e2e6d2', '#3c4a44');

    // Highway south out of Walsenburg, then Main Street through Trinidad, broken at the
    // river so the water stays open except at the x = 0 bridge.
    this.box([0, -0.02, 190], [11, 0.08, 270], this.tiledMaterial('#63676a', 'road'), false, true, false);
    this.box([0, -0.02, 453], [11, 0.08, 186], this.tiledMaterial('#63676a', 'road'), false, true, false);
    this.box([0, -0.02, 607], [11, 0.08, 66], this.tiledMaterial('#63676a', 'road'), false, true, false);
    for (let z = 120; z < 310; z += 18) this.box([0, 0.05, z], [0.18, 0.02, 6], this.material('#cfc69d'), false, true, false);
    this.sign('TRINIDAD', 'CITY LIMIT  /  EST. 1879', [10, 4.4, 312], 12, 2.6, [0, 0, -1], '#e7e2cd', '#4a3a34');
    for (const x of [-7, 7]) this.box([x, 2.2, 312], [0.5, 4.4, 0.5], this.material('#9aa094', 'concrete'));
    this.sign('SANTA FE TRAIL', 'FISHER\u2019S PEAK  /  9,633 FT', [0, 5.6, 344], 18, 1.6, [0, 0, 1], '#ecdfc2', '#43372c');
    for (const x of [-9.5, 9.5]) this.box([x, 2.8, 344], [0.6, 5.6, 0.6], this.material('#6b5a48'));

    const paving = this.tiledMaterial('#6d7173', 'road');
    this.box([-5, -0.02, 440], [690, 0.08, 196], paving, false, true, false);
    this.box([90, -0.02, 622], [520, 0.08, 84], paving, false, true, false);

    // Downtown masses: red brick and sandstone Victorians, denser and lower than Pueblo.
    const blocks: { x: number; z: number }[] = [];
    const reserved = new Set(['-40,460', '120,460', '40,380', '-40,620', '40,620', '120,620', '-120,620', '200,620', '-200,380', '200,380']);
    for (let gx = TW; gx < TE; gx += P) {
      for (let gz = TN; gz < TS; gz += P) {
        const x = gx + P / 2;
        const z = gz + P / 2;
        if (z > 510 && z < 600) continue;
        if (x > -335 && x < -175 && z > 595 && z < 745) continue;
        if (z > 655 && x > -155) continue;
        this.box([x, 0.01, z], [P - 12, 0.1, P - 12], this.material('#a9a694'), false, true, false);
        if (!reserved.has(`${x},${z}`)) blocks.push({ x, z });
      }
    }
    const facades: { position: T.Vector3; size: T.Vector3; color: T.Color }[] = [];
    const palette = ['#a55f4a', '#b3815a', '#c0a377', '#8e5f4c', '#b98d68', '#9c6b52', '#c4b08a', '#7d5a48'];
    for (const block of blocks) {
      const downtown = block.z < 510;
      const lots = downtown ? 3 : 2;
      const lot = (P - 16) / lots;
      for (let i = 0; i < lots; i++) for (let j = 0; j < lots; j++) {
        if (random() < (downtown ? 0.08 : 0.2)) continue;
        const footprint = lot * (0.6 + random() * 0.24);
        const height = downtown ? 7 + random() * 8 : 4.5 + random() * 4;
        facades.push({
          position: new T.Vector3(block.x - (P - 16) / 2 + lot * (i + 0.5), height / 2, block.z - (P - 16) / 2 + lot * (j + 0.5)),
          size: new T.Vector3(footprint, height, lot * (0.6 + random() * 0.24)),
          color: new T.Color(palette[Math.floor(random() * palette.length)]).multiplyScalar(0.88 + random() * 0.24),
        });
      }
    }
    this.instancedBoxes(facades, this.facadeMaterial(), { portalable: true, solid: true });
    this.instancedBoxes(facades.filter(f => f.size.y > 9).map(facade => ({
      position: new T.Vector3(facade.position.x, facade.size.y + 0.3, facade.position.z),
      size: new T.Vector3(facade.size.x + 0.8, 0.6, facade.size.z + 0.8),
      color: new T.Color('#5f5a52'),
    })), this.material('#5f5a52'));

    this.trinidadTheater();
    this.trinidadChurch();
    this.trinidadPlaza();
    this.trinidadRailyard();
    this.trinidadCoalCamp();
    this.fishersPeak();
    this.trinidadBalloons();
    this.streetFurniture(TW, TE, TN, 660, P, [548, 572]);

    // Cottonwoods along the north bank, clear of the bridges.
    for (let x = -300; x <= 300; x += 42) {
      if ([-140, 0, 140].some(bridge => Math.abs(x - bridge) < 22)) continue;
      this.tree(x + (random() - 0.5) * 10, 538, 4.5 + random() * 2.5);
    }
  }

  private trinidadTheater() {
    const brick = this.material('#8e4f3c', 'brick');
    // Hollow theater with open entrance under the neon marquee:
    this.box([-40, 7, 481.6], [30, 14, 0.8], brick); // Back wall
    this.box([-54.6, 7, 460], [0.8, 14, 44], brick);  // West wall
    this.box([-25.4, 7, 460], [0.8, 14, 44], brick);  // East wall
    this.box([-40, 13.8, 460], [30, 0.4, 44], brick); // Roof slab
    this.box([-40, 14.4, 460], [31, 1, 45], this.material('#5f5a52'));

    // Front facade with marquee entrance (doorway 4m wide, 3.2m high):
    this.box([-50.5, 7, 438.4], [9, 14, 0.8], brick);
    this.box([-29.5, 7, 438.4], [9, 14, 0.8], brick);
    this.box([-40, 8.6, 438.4], [6, 10.8, 0.8], brick); // Doorway lintel

    // Vertical neon blade sign, glowing day and night:
    this.box([-40, 17, 436.5], [1.2, 16, 1.2], this.material('#3a3f3a'));
    this.sign('TRINIDAD', 'FOX  /  TONIGHT: THE FOLD', [-40, 17, 435.8], 3.4, 13, [0, 0, -1], '#ffd9a0', '#5a2320');
    this.box([-40, 3.4, 436.2], [16, 1.1, 3.4], this.material('#e8d9b0', undefined, 0.7));
    this.sign('NOW SHOWING', 'SOMEWHERE ELSE, LIVE', [-40, 2.1, 434.4], 10, 1.1, [0, 0, -1]);

    // Walkable theater interior:
    this.box([-40, 0.05, 460], [28.4, 0.1, 42.4], this.material('#541c18', 'concrete')); // Velvet carpet
    // Foyer concession bar:
    this.box([-33.5, 0.6, 444], [1.2, 1.1, 4.0], this.material('#662e26'));
    // Auditorium tiered seating:
    this.box([-40, 0.4, 458], [16, 0.8, 3.5], this.material('#7a2018'));
    this.box([-40, 0.75, 464], [16, 0.8, 3.5], this.material('#7a2018'));
    // Cinema stage:
    this.box([-40, 0.5, 476], [22, 0.9, 6.0], this.material('#631f1a'));
    // Giant white projection screen on back wall (portalable!):
    this.anchor('trinidad-fox-screen', [-40, 4.5, 481.1], [0, 0, -1], [], 13.5, 6.0);
  }

  private trinidadChurch() {
    const stone = this.material('#cfc3a8', 'concrete');
    // Hollow church with open arched entrance:
    this.box([120, 6, 440.4], [26, 12, 0.8], stone); // North altar wall
    this.box([107.4, 6, 460], [0.8, 12, 40], stone);  // West wall
    this.box([132.6, 6, 460], [0.8, 12, 40], stone);  // East wall
    this.box([120, 11.8, 460], [26, 0.4, 40], stone); // Roof
    this.box([120, 12.4, 460], [27, 0.9, 41], this.material('#7a7264'));

    // South front facade with arched entrance doorway (4m wide, 3.5m high):
    this.box([112.5, 6, 479.6], [11, 12, 0.8], stone);
    this.box([127.5, 6, 479.6], [11, 12, 0.8], stone);
    this.box([120, 7.75, 479.6], [4, 8.5, 0.8], stone); // Arch lintel

    // Steeple & belfry:
    this.box([120, 21, 448], [8, 18, 8], stone);
    this.box([120, 31.5, 448], [9.5, 1.2, 9.5], this.material('#5f6a60'));
    this.cylinder([120, 35.5, 448], 0.3, 7, this.material('#c9b182'), 0.05);
    this.box([120, 25, 444.2], [4.4, 5, 0.6], this.glass('#e8c96a'), false);
    this.sign('HOLY TRINITY', 'EST. 1885  /  ALL FOLDS FORGIVEN', [120, 8.5, 480.4], 14, 1.8, [0, 0, 1], '#ece4cb', '#3e4438');

    // Walkable stone nave floor:
    this.box([120, 0.05, 460], [24.4, 0.1, 38.4], this.material('#9e9786', 'concrete'));

    // Pews on left and right sides of the center aisle:
    for (let dz = 452; dz <= 472; dz += 3.5) {
      this.box([113, 0.45, dz], [6.5, 0.8, 1.2], this.material('#4e3624'));
      this.box([127, 0.45, dz], [6.5, 0.8, 1.2], this.material('#4e3624'));
    }

    // Altar with golden cross:
    this.box([120, 0.5, 444], [6, 0.9, 2.5], this.material('#7a6850'));
    this.cylinder([120, 1.7, 444], 0.07, 1.4, this.material('#c9b182'));

    // White portalable altar wall:
    this.anchor('trinidad-church-altar', [120, 3.8, 440.9], [0, 0, 1], [], 7.5, 5.0);
  }

  private trinidadPlaza() {
    this.box([40, 0.05, 380], [56, 0.14, 56], this.material('#b9b39b', 'concrete'), false, true, false);
    for (let i = 0; i < 6; i++) {
      const angle = (i / 6) * Math.PI * 2;
      this.cylinder([40 + Math.cos(angle) * 7, 2.2, 380 + Math.sin(angle) * 7], 0.28, 4.4, this.material('#4f5a47'));
    }
    this.cylinder([40, 5.2, 380], 8.6, 1.1, this.material('#7a4a3a'), 8.6, 6);
    this.cylinder([40, 6.6, 380], 0.5, 2.6, this.material('#7a4a3a'));
    this.box([40, 0.7, 380], [10, 1.1, 10], this.material('#8e8a76', 'concrete'));
    const basin = new T.Mesh(new T.CircleGeometry(4.2, 24), this.waterMaterial());
    basin.rotation.x = -Math.PI / 2;
    basin.position.set(40, 1.28, 380);
    this.scene.add(basin);
    this.sign('CORAZON PLAZA', 'THE HEART OF TRINIDAD', [40, 3.2, 352.5], 12, 1.5, [0, 0, 1], '#e5ddc2', '#40503f');
    this.console('trinidad', [32, 1.4, 383.4], 0, 'Read the Trinidad field log', 'note');
    this.tree(18, 362, 4);
    this.tree(62, 398, 5);
  }

  private trinidadRailyard() {
    const railBed = this.material('#6e6258');
    for (const z of [622, 630, 638]) {
      this.box([25, 0.12, z], [410, 0.1, 4], railBed, false, true, false);
      for (const x of [31, 39]) this.box([x, 0.22, z], [180, 0.08, 0.3], this.material('#8f8578'), false, true, false);
    }
    const cars: { position: T.Vector3; size: T.Vector3; color: T.Color }[] = [];
    const paint = ['#a34a3a', '#3f6d8e', '#c09a4a', '#5d7d4f', '#7a4a72', '#b0723a'];
    for (let i = 0; i < 9; i++) {
      const z = [622, 630, 638][i % 3];
      const x = -150 + i * 44 + (i % 3) * 10;
      cars.push({
        position: new T.Vector3(x, 1.9, z),
        size: new T.Vector3(16, 3.4, 3.6),
        color: new T.Color(paint[i % paint.length]),
      });
    }
    this.instancedBoxes(cars, this.facadeMaterial(), { portalable: true, solid: true });

    // Hollow passenger depot station with open waiting hall:
    const depotMat = this.material('#9a8a6e', 'brick');
    this.box([-20, 3.4, 658.6], [60, 6.8, 0.8], depotMat); // North back wall
    this.box([-49.6, 3.4, 652], [0.8, 6.8, 14], depotMat);  // West wall
    this.box([9.6, 3.4, 652], [0.8, 6.8, 14], depotMat);   // East wall
    this.box([-20, 6.6, 652], [60, 0.4, 14], depotMat);    // Roof

    // Front facade with open entrance doorway (4m wide, 3.2m high):
    this.box([-35.5, 3.4, 645.4], [27, 6.8, 0.8], depotMat);
    this.box([-4.5, 3.4, 645.4], [27, 6.8, 0.8], depotMat);
    this.box([-20, 5.0, 645.4], [4, 3.6, 0.8], depotMat); // Doorway lintel
    this.sign('TRINIDAD DEPOT', 'SANTA FE TRAIL  /  MIND THE GAP', [-20, 5, 645.2], 18, 1.8, [0, 0, -1], '#e8dfc4', '#41372b');

    // Walkable hardwood waiting hall floor:
    this.box([-20, 0.05, 652], [58, 0.1, 12.4], this.material('#735841', 'concrete'));

    // Passenger waiting benches:
    this.box([-33, 0.45, 654], [14, 0.8, 1.4], this.material('#543b27'));
    this.box([-7, 0.45, 654], [14, 0.8, 1.4], this.material('#543b27'));

    // Ticket agent counter:
    this.box([3, 0.6, 649], [1.2, 1.1, 4.5], this.material('#453123'));

    // White portalable waiting hall back wall:
    this.anchor('trinidad-depot-wall', [-20, 2.8, 658.1], [0, 0, -1], [], 8.0, 4.4);
  }

  private trinidadCoalCamp() {
    // Between the lake and the mesa face: beehive ovens, a timbered adit, and a foothill to drive it into.
    this.sign('BLACK DIAMOND COAL CAMP', 'MIND YOUR HEAD  /  AND YOUR VECTOR', [-107, 4.5, 656], 20, 2, [0, 0, -1], '#e3d3ae', '#33302a');
    for (let i = 0; i < 6; i++) {
      this.cylinder([-150 + i * 17, 2.2, 668], 4.2, 4.4, this.material('#7d6a55', 'brick'), 3.2, 12);
      this.cylinder([-150 + i * 17, 4.6, 668], 1.1, 0.8, this.material('#3c3833'), 1.1, 10);
    }
    this.rockMass([-170, 4, 692], [8, 4.4, 6]);
    this.box([-170, 2.5, 688.4], [7, 5, 1], this.material('#241f19'));
    for (const x of [-174, -166]) this.box([x, 2.5, 687.5], [0.8, 5.4, 2.4], this.material('#6b5a48'));
    this.box([-170, 5.4, 687.5], [8.8, 0.8, 2.4], this.material('#6b5a48'));
  }

  /** Fisher's Peak: three stacked tiers with a caprock crown, all solid, all foldable. */
  private fishersPeak() {
    const rock = this.material('#7c6f5e', 'concrete');
    const cap = this.material('#5f5b52', 'concrete');
    this.box([95, 12, 730], [470, 24, 96], rock);
    this.box([95, 29, 730], [360, 12, 76], rock);
    this.box([95, 38, 730], [250, 8, 58], cap);
    this.box([95, 42.6, 730], [120, 1.6, 30], this.material('#6f7a68'), false);
    this.sign('FISHER\u2019S PEAK', '9,633 FT  /  WORTH THE CLIMB', [95, 20, 681.4], 26, 3, [0, 0, -1], '#e9e2ca', '#3d443a');
    this.rockMass([-170, 3, 690], [9, 3.4, 7]);
    this.rockMass([300, 3, 668], [11, 4.2, 8]);
  }

  /** Tethered festival balloons drifting over town, in NORA-approved colours. */
  private trinidadBalloons() {
    const spots: { x: number; y: number; z: number; color: string }[] = [
      { x: -180, y: 46, z: 480, color: '#c65a3a' },
      { x: 80, y: 60, z: 420, color: '#3f7fae' },
      { x: 210, y: 38, z: 600, color: '#c9a13a' },
    ];
    for (const spot of spots) {
      const envelope = new T.Mesh(new T.SphereGeometry(6, 20, 14), this.material(spot.color));
      envelope.scale.set(1, 1.18, 1);
      envelope.position.set(spot.x, spot.y, spot.z);
      this.scene.add(envelope);
      this.staticMeshes.push(envelope);
      this.box([spot.x, spot.y - 9.4, spot.z], [2.4, 2, 2.4], this.material('#6b5a48'), false);
      this.cylinder([spot.x, spot.y - 5.4, spot.z], 0.06, 6.4, this.material('#4f574e'), 0.06, 6);
    }
  }

  /**
   * The Deep Fold. Seventeen rooms in a line: a hub, fifteen puzzle chambers, and a reward room.
   * The rules are visual and consistent: white panels hold folds, dark metal never does, glass
   * barriers stop bodies but not shots, and goo returns you to the chamber's entrance.
   */
  private deepFold() {
    const B = DEEP_FLOOR;
    const plans: (DeepPlan | 'hub' | 'final')[] = ['hub',
      { pit: 8, exit: 'low', hint: 'TWO PANELS. ONE STEP.' },
      { grate: true, hint: 'GLASS STOPS FEET, NOT FOLDS.' },
      { cube: { y: 6, x: 0 }, hint: 'THE DOOR WANTS WEIGHT.' },
      { pit: 8, exit: 'ceiling', hint: 'DOWN IS A DIRECTION TOO.' },
      { fling: true, hint: 'FALL WITH PURPOSE.' },
      { pit: 12, exit: 'high', hint: 'THE LONG WAY DOWN.' },
      { grate: true, cube: { y: 6, x: 14 }, hint: 'FETCH, THEN CROSS.' },
      { cube: { y: 12, x: 0 }, hint: 'HIGHER SHELF. SAME IDEA.' },
      { fling: true, hint: 'AGAIN, BUT YOU KNOW IT NOW.' },
      { pit: 14, exit: 'ceiling', hint: 'WIDER. DEEPER. CALMER.' },
      { grate: true, pit: 8, hint: 'GLASS OVER GOO.' },
      { pit: 10, cube: { y: 10, x: 14 }, hint: 'THE SHELF IS ACROSS THE GOO.' },
      { fling: true, hint: 'THE LAST LEAP.' },
      { grate: true, cube: { y: 12, x: 14 }, hint: 'ALL OF IT AT ONCE.' },
      { grate: true, pit: 12, exit: 'ceiling', hint: 'ONE MORE FOR THE ROAD.' },
      'final'];
    const dark = this.material('#3b4240', 'concrete');
    const white = this.material('#e8ebe2', 'concrete');
    const doorMaterial = this.material('#566870');
    const goo = this.material('#64b67f', undefined, 0.55);
    const strip = this.material('#e2ece5', undefined, 1.1);
    const glass = new T.MeshStandardMaterial({ color: '#8fd0f2', transparent: true, opacity: 0.14, roughness: 0.05, metalness: 0.3, depthWrite: false });
    const WB = B - 7;
    const WT = B + DEEP_HEIGHT + 0.5;
    const wallH = WT - WB;
    const wallY = (WB + WT) / 2;
    let entryY = B;

    plans.forEach((plan, i) => {
      const cx = DEEP_X0 + i * DEEP_PITCH;
      const P = (x: number, y: number, z: number): Vec3 => [cx + x, y, DEEP_Z + z];
      const wall = (position: Vec3, size: Vec3) => { const c = this.box(position, size, dark)!; c.mesh.userData.portalable = false; return c; };
      const panel = (position: Vec3, size: Vec3) => this.box(position, size, white);
      const last = i === plans.length - 1;
      const room = typeof plan === 'string' ? {} as DeepPlan : plan;
      const exitY = room.fling ? B + 10 : B;
      const entry = P(i === 0 ? -16 : -19, entryY + 1, i === 0 ? 6 : 0);
      this.deepRooms.push({ cx, entry });

      // Shell: north and south walls, the shared east wall with its doorway, ceiling, and lights.
      wall(P(0, wallY, -23), [48, wallH, 2]);
      wall(P(0, wallY, 23), [48, wallH, 2]);
      if (i === 0) wall(P(-23, wallY, 0), [2, wallH, 48]);
      if (last) wall(P(23, wallY, 0), [2, wallH, 48]);
      else {
        wall(P(23, wallY, -13), [2, wallH, 22]);
        wall(P(23, wallY, 13), [2, wallH, 22]);
        wall(P(23, (WB + exitY) / 2, 0), [2, exitY - WB, 4]);
        wall(P(23, (exitY + 5 + WT) / 2, 0), [2, WT - exitY - 5, 4]);
      }
      wall(P(0, B + DEEP_HEIGHT + 0.25, 0), [48, 0.5, 48]);
      for (const z of [-11, 0, 11]) this.box(P(0, B + DEEP_HEIGHT - 0.08, z), [34, 0.1, 0.35], strip, false);

      // Floor, or two thick slabs either side of a goo pit.
      const pit = room.fling ? 0 : room.pit ?? 0;
      if (pit) {
        const span = 22 - pit;
        wall(P(-22 + span / 2, B - 3.5, 0), [span, 7, 44]);
        wall(P(22 - span / 2, B - 3.5, 0), [span, 7, 44]);
        wall(P(0, B - 7.5, 0), [pit * 2, 1, 44]);
        this.box(P(0, B - 6.4, 0), [pit * 2, 0.1, 44], goo, false);
        this.hazards.push({ minX: cx - pit, maxX: cx + pit, minZ: DEEP_Z - 22, maxZ: DEEP_Z + 22, y: B - 3, recover: entry });
      } else wall(P(0, B - 0.25, 0), [44, 0.5, 44]);

      if (entryY > B) wall(P(-20, (B + entryY) / 2, 0), [4, entryY - B, 8]);
      if (exitY > B) wall(P(19, (B + exitY) / 2, 0), [6, exitY - B, 12]);

      if (room.grate) {
        this.box(P(0, wallY, 0), [0.3, wallH, 44], glass, true, false, false);
        for (const y of [B + 4, B + 10, B + 16]) this.box(P(0, y, 0), [0.4, 0.14, 44], dark, false);
        for (const z of [-16, -8, 0, 8, 16]) this.box(P(0, wallY, z), [0.4, wallH, 0.18], dark, false);
      }

      // Crossing panels: one on the near side at floor level, one on the far side, low, high, or overhead.
      if (pit || room.grate) {
        const crossX = pit ? (22 + pit) / 2 : 15;
        panel(P(-crossX, B + 2.5, -21.88), [5, 5, 0.24]);
        if (room.exit === 'ceiling') panel(P(crossX, B + DEEP_HEIGHT - 0.12, 0), [5, 0.24, 5]);
        else if (room.exit === 'high') panel(P(crossX, B + 12, -21.88), [5, 5, 0.24]);
        else panel(P(crossX, B + 2.5, -21.88), [5, 5, 0.24]);
      }

      if (room.cube) {
        const { x: ax, y } = room.cube;
        const top = B + y;
        wall(P(ax, (WB + top) / 2, 18), [14, top - WB, 8]);
        panel(P(ax, top + 2.5, 21.88), [5, 5, 0.24]);
        panel(P(-21.88, B + 2.5, 10), [0.24, 5, 5]);
        this.cube(`deep-core-${i}`, P(ax + 3, top + 0.45, 18), 100 + i);
        this.floorSwitch(`deep-${i}`, cx + (room.grate ? -12 : 12), B, DEEP_Z - 8);
        const door = this.box(P(23, B + 2.5, 0), [0.6, 5, 4], doorMaterial, true, false)!;
        door.mesh.userData.portalable = false;
        this.doors.push({ mesh: door.mesh, collider: door, homeY: B + 2.5, switchIds: [`deep-${i}`], travel: 5.6, open: 0 });
      }

      if (room.fling) {
        const top = B + 12;
        const slab = (x0: number, x1: number, z0: number, z1: number) => wall(P((x0 + x1) / 2, top - 0.15, (z0 + z1) / 2), [x1 - x0, 0.3, z1 - z0]);
        slab(-22, -18.6, -22, -8); slab(-13.4, -10, -22, -8); slab(-18.6, -13.4, -22, -17.6); slab(-18.6, -13.4, -12.4, -8);
        const sh = top - 0.3 - B;
        const sy = B + sh / 2;
        wall(P(-18.8, sy, -15), [0.4, sh, 5.6]);
        wall(P(-16, sy, -17.8), [5.2, sh, 0.4]);
        wall(P(-16, sy, -12.2), [5.2, sh, 0.4]);
        wall(P(-13.2, sy, -16.75), [0.4, sh, 2.1]);
        wall(P(-13.2, sy, -13.25), [0.4, sh, 2.1]);
        wall(P(-13.2, B + 2.4 + (sh - 2.4) / 2, -15), [0.4, sh - 2.4, 1.4]);
        panel(P(-16, B - 0.13, -15), [5, 0.3, 5]);
        panel(P(12.5, B - 0.13, 0), [5, 0.3, 5]);
        for (let k = 0; k <= 32; k++) {
          const h = (k + 1) * 0.36;
          wall(P(-10.4 + (32 - k) * 0.8, B + h / 2, -20.5), [0.81, h, 3]);
        }
      }

      if (plan === 'hub') {
        this.sign('THE DEEP FOLD', 'FIFTEEN CHAMBERS. NO SHORTCUTS. WELL, SOME SHORTCUTS.', P(0, B + 9, -21.85), 24, 3, [0, 0, 1], '#e5ece2', '#24333a');
        this.sign('WHITE HOLDS FOLDS', 'DARK METAL NEVER DOES  /  GLASS STOPS FEET, NOT SHOTS  /  GOO IS NOT LOAD-BEARING', P(0, B + 5, -21.85), 22, 1.6, [0, 0, 1], '#d8e6dc', '#33403a');
        this.console('deep-lift-up', P(-14, B + 1.4, -10), 0, 'Ride the lift back to the surface', 'lift').target = [-22, 1.08, 22];
        this.cube('deep-core-hub', P(6, B + 0.45, 8), 100);
      } else if (plan === 'final') {
        this.sign('YOU WENT ALL THE WAY DOWN', 'NORA IS CHOOSING TO BE IMPRESSED OUT LOUD', P(0, B + 9, -21.85), 24, 3, [0, 0, 1], '#f1e6cf', '#3a3326');
        this.console('deep', P(-4, B + 1.4, -6), 0, 'Read the Deep Fold field log', 'note');
        this.console('deep-lift-home', P(6, B + 1.4, -6), 0, 'Ride the lift back to the surface', 'lift').target = [-22, 1.08, 22];
      } else {
        this.sign(`THE DEEP FOLD  ${String(i).padStart(2, '0')} / 15`, room.hint, P(-21.85, B + 8, 10), 12, 1.4, [1, 0, 0], '#e2eadf', '#26343b');
      }
      entryY = exitY;
    });
  }

  /** Whether a point is inside the Deep Fold complex. */
  inComplex(position: T.Vector3) {
    const n = this.deepRooms.length;
    return position.y < -40 && position.x > DEEP_X0 - 24 && position.x < DEEP_X0 + DEEP_PITCH * (n - 1) + 24 && Math.abs(position.z - DEEP_Z) < 25;
  }

  /** Which Deep Fold chamber contains a point, or -1 outside the complex. */
  deepRoomAt(position: T.Vector3) {
    if (!this.inComplex(position)) return -1;
    return T.MathUtils.clamp(Math.round((position.x - DEEP_X0) / DEEP_PITCH), 0, this.deepRooms.length - 1);
  }

  deepEntry(room: number): Vec3 {
    return this.deepRooms[room].entry;
  }

  /** If a point has sunk into goo, where to put it back. */
  hazardRecovery(position: T.Vector3): Vec3 | null {
    for (const h of this.hazards) {
      if (position.x > h.minX && position.x < h.maxX && position.z > h.minZ && position.z < h.maxZ && position.y < h.y) return h.recover;
    }
    return null;
  }

  private boundaries() {
    for (const [position, size] of [
      // Walsenburg valley, open eastward only through the highway corridor at z -42..-8.
      [[-151, 30, -45], [2, 60, 370]], [[0, 30, -222], [310, 60, 2]],
      // South wall split for the Trinidad highway at x -7..7.
      [[-81, 12, 109], [148, 24, 2]], [[81, 12, 109], [148, 24, 2]],
      [[151, 30, -136], [2, 60, 188]], [[151, 30, 51], [2, 60, 118]],
      // Highway corridor between the two map halves.
      [[175, 30, -42], [52, 60, 2]], [[175, 30, -8], [52, 60, 2]],
      // South highway corridor down to Trinidad.
      [[-8, 30, 215], [2, 60, 212]], [[8, 30, 215], [2, 60, 212]],
      // Pueblo perimeter.
      [[200, 30, -92], [2, 60, 100]], [[200, 30, 157], [2, 60, 330]],
      [[568, 60, -142], [736, 120, 2]], [[568, 60, 322], [736, 120, 2]],
      [[936, 60, 90], [2, 120, 466]],
      // Trinidad perimeter, open northward only through the highway at x -7..7.
      [[-183.5, 60, 322], [353, 120, 2]], [[178.5, 60, 322], [343, 120, 2]],
      [[-5, 60, 784], [720, 120, 2]],
      [[-364, 60, 553], [2, 120, 462]], [[354, 60, 553], [2, 120, 462]],
    ] as [Vec3, Vec3][]) {
      const wall = this.box(position, size, this.material('#a4a995'), true, false, false)!;
      wall.mesh.visible = false;
    }
  }

  private buildColliderIndex() {
    const doorIds = new Set(this.doors.map(door => door.collider.id));
    for (const collider of this.colliders) {
      if (doorIds.has(collider.id)) { this.dynamicColliders.push(collider); continue; }
      const { min, max } = collider.box;
      const minX = Math.floor(min.x / this.gridSize); const maxX = Math.floor(max.x / this.gridSize);
      const minY = Math.floor(min.y / this.gridSize); const maxY = Math.floor(max.y / this.gridSize);
      const minZ = Math.floor(min.z / this.gridSize); const maxZ = Math.floor(max.z / this.gridSize);
      if ((maxX - minX + 1) * (maxY - minY + 1) * (maxZ - minZ + 1) > 70) { this.largeColliders.push(collider); continue; }
      for (let x = minX; x <= maxX; x++) for (let y = minY; y <= maxY; y++) for (let z = minZ; z <= maxZ; z++) {
        const key = `${x},${y},${z}`;
        const bucket = this.colliderBuckets.get(key) || [];
        bucket.push(collider); this.colliderBuckets.set(key, bucket);
      }
    }
  }

  /** The Pueblo channel, excluding the bridge decks that cross it at street level. */
  private isRiver(x: number, y: number, z: number) {
    if (y > -0.2 || x < 412 || x > 958 || z < 63 || z > 87) return false;
    return !this.riverBridges.some(bridge => Math.abs(x - bridge) < 10.5);
  }

  /** The Purgatoire through Trinidad plus Trinidad Lake, excluding the three street bridges. */
  private isTrinidadWater(x: number, y: number, z: number) {
    if (y > -0.2) return false;
    if (x > -350 && x < 340 && z > 549 && z < 571) {
      return ![-140, 0, 140].some(bridge => Math.abs(x - bridge) < 11);
    }
    if (x > -330 && x < -180 && z > 600 && z < 740) return true;
    return false;
  }

  /**
   * Somewhere safe and close to stand after a fall. Pueblo and Trinidad are optional exploration,
   * so a slip into their water returns you to the nearest bank instead of a story checkpoint.
   */
  recoveryPoint(position: T.Vector3): Vec3 | null {
    const { x, z } = position;
    if (x > 400 && x < 970 && z > 35 && z < 115) {
      return [T.MathUtils.clamp(x, 425, 945), 1.1, z < 75 ? 56 : 94];
    }
    if (x > -350 && x < 340 && z > 540 && z < 580) {
      return [T.MathUtils.clamp(x, -335, 335), 1.1, z < 560 ? 541 : 579];
    }
    if (x > -330 && x < -180 && z > 600 && z < 740) {
      return [T.MathUtils.clamp(x, -325, -185), 1.1, z < 670 ? 594 : 746];
    }
    return null;
  }

  isWater(position: T.Vector3) {
    const { x, y, z } = position;
    if (this.isRiver(x, y, z)) return true;
    if (this.isTrinidadWater(x, y, z)) return true;
    if (x < -90 || x > -48 || z < -69 || z > -29 || y > 0.8) return false;
    if (x >= -75.5 && x <= -64.5 && z >= -57 && z <= -47 && y > 0.65) return false;
    if (x >= -55.5 && x <= -43.5 && z >= -37.25 && z <= -33.75 && y > 0.36) return false;
    return true;
  }

  private batchStaticGeometry() {
    const chunks = new Map<string, { material: T.Material; geometries: T.BufferGeometry[] }>();
    for (const mesh of this.staticMeshes) {
      if (Array.isArray(mesh.material)) continue;
      mesh.updateMatrixWorld();
      const geometry = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
      if (!geometry.index) geometry.setIndex(Array.from({ length: geometry.attributes.position.count }, (_, i) => i));
      geometry.computeBoundingBox();
      const bounds = geometry.boundingBox!;
      const size = bounds.getSize(new T.Vector3());
      const chunk = Math.max(size.x, size.z) > 90 ? `large-${mesh.id}` : `${Math.floor(mesh.position.x / 48)},${Math.floor(mesh.position.z / 48)}`;
      const key = `${mesh.material.uuid}:${chunk}`;
      const entry = chunks.get(key) || { material: mesh.material, geometries: [] };
      entry.geometries.push(geometry); chunks.set(key, entry);
      // Keep detached meshes for precise raycasts and collider identity.
      this.scene.remove(mesh);
    }
    chunks.forEach(({ material, geometries }) => {
      const merged = mergeGeometries(geometries, false);
      if (!merged) return;
      const mesh = new T.Mesh(merged, material);
      // Only costs anything on High quality, where the shadow map is enabled and follows the player.
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.scene.add(mesh);
      geometries.forEach(g => g.dispose());
    });
    this.staticMeshes = [];
  }

  dispose() {
    const geometries = new Set<T.BufferGeometry>();
    const materials = new Set<T.Material>();
    const textures = new Set<T.Texture>();
    const collect = (object: T.Object3D) => {
      if (object instanceof T.Mesh || object instanceof T.Line) {
        geometries.add(object.geometry);
        (Array.isArray(object.material) ? object.material : [object.material]).forEach(m => {
          materials.add(m);
          Object.values(m).forEach(value => { if (value instanceof T.Texture) textures.add(value); });
        });
      }
    };
    this.scene.traverse(collect);
    this.shootables.forEach(collect);
    this.colliders.forEach(c => collect(c.mesh));
    Object.values(this.textures).forEach(t => textures.add(t));
    this.environment?.dispose();
    this.environment = null;
    geometries.forEach(g => g.dispose());
    materials.forEach(m => m.dispose());
    textures.forEach(t => t.dispose());
  }
}