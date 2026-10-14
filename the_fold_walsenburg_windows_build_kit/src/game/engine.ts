import * as T from 'three';
import { FoldWorld } from './world';
import { FieldDevice, PORTAL_BLUE, PORTAL_ORANGE } from './device';
import { FoldEffects, type ShotVisual } from './effects';
import { PlayerRobot } from './robot';
import { connectionMatrix, fitPortal, orientPortal, portalExtent, PortalPair, type PortalPlacement } from './portals';
import { FoldAudio } from './audio';
import { runPortalMathChecks } from './checks';
import { gravityBasis, gravityLook, GRAVITY_DIRECTIONS, GRAVITY_LABELS, orientationInGravity, WHEEL_ORDER, wheelSlot } from './gravity';
import { CHAPTERS, QUALITY_CONFIG, RESEARCH_NOTES, SAVE_KEY, type Body, type GameSnapshot, type Interaction, type PortalSurface, type SaveData, type Settings, type Vec3 } from './types';

interface Callbacks {
  snapshot: (snapshot: GameSnapshot) => void;
  pause: () => void;
  map: () => void;
  win: () => void;
  saved: (save: SaveData) => void;
}

interface Projectile {
  shot: ShotVisual | null;
  color: T.Color;
  /** Facing of whatever the shot will strike, for impact effects when it cannot hold a fold. */
  normal: T.Vector3;
  active: boolean;
  age: number;
  duration: number;
  start: T.Vector3;
  end: T.Vector3;
  /** Where the fold is seated, which can differ from where the shot lands (wall folds settle to the floor). */
  seat: T.Vector3;
  index: number;
  surface: PortalSurface | null;
  /** Rotation decided at the moment of firing, so turning while the shot flies cannot change it. */
  orientation: T.Quaternion;
}

const FIXED_DT = 1 / 120;
const UP = new T.Vector3(0, 1, 0);
const CAMERA_HEIGHT = 0.65;

export class FoldEngine {
  readonly renderer: T.WebGLRenderer;
  readonly scene = new T.Scene();
  readonly camera: T.PerspectiveCamera;
  readonly world: FoldWorld;
  readonly portals: PortalPair;
  readonly player: Body;
  readonly checks = runPortalMathChecks();
  private settings: Settings;
  private callbacks: Callbacks;
  private audio: FoldAudio;
  private container: HTMLElement;
  private device: FieldDevice;
  private effects: FoldEffects;
  private robot: PlayerRobot;
  /** The field device draws in its own pass, after the world, so it never clips into walls. */
  private viewScene = new T.Scene();
  private viewCamera = new T.PerspectiveCamera(58, 1, 0.01, 10);
  private preview: T.Group;
  private ray = new T.Raycaster();
  private projectiles: Projectile[] = [];
  private keys = new Set<string>();
  private resizeObserver: ResizeObserver;
  private abort = new AbortController();
  private active = false;
  private destroyed = false;
  private hadLock = false;
  private hasStarted = false;
  private dragging = false;
  private dragDistance = 0;
  private dragButton = 0;
  private touchPointer: number | null = null;
  private touchPosition = new T.Vector2();
  private touchMove = new T.Vector2();
  private lastTime = 0;
  private lastRender = 0;
  private accumulator = 0;
  private frameAverage = 1 / 60;
  private adaptiveScale = 1;
  private adaptationTimer = 0;
  private aimTimer = 0;
  private heldAimTimer = 0;
  private heldClearance = 1.6;
  private fps = 60;
  private time = 0;
  private uiTime = 0;
  private saveTime = 0;
  private stepTime = 0;
  private fireTime = -1;
  private lastYaw = 0;
  private lastPitch = 0;
  private yaw = 0;
  private pitch = 0;
  private roll = 0;
  private stage = 0;
  private playtime = 0;
  private notes = ['orientation'];
  private gravityUnlocked = false;
  private gravityMode = 0;
  private held: Body | null = null;
  private heldAcross: { source: number; destination: number } | null = null;
  private subtitle = '';
  private subtitleUntil = 0;
  private toast = '';
  private toastUntil = 0;
  private currentInteraction: Interaction | null = null;
  private aimedCube: Body | null = null;
  private aimSurface: PortalSurface | null = null;
  private aimPoint = new T.Vector3();
  private aimNormal = new T.Vector3(0, 0, 1);
  private aimOrientation = new T.Quaternion();
  private aimPlacement: PortalPlacement | null = null;
  private aimPlaceable = false;
  private lastZone = -1;
  private respawnCooldown = 0;
  private puebloGreeted = false;
  private trinidadGreeted = false;
  private deepGreeted = false;
  private aimSeat = new T.Vector3();
  /** Gravity wheel. The mouse steers a virtual cursor while it is open, so the view holds still. */
  private wheelOpen = false;
  private wheelHover = -1;
  private wheelOpenedAt = 0;
  private wheelLatched = false;
  private wheelCursor = new T.Vector2();

  constructor(container: HTMLElement, settings: Settings, audio: FoldAudio, save: SaveData | null, callbacks: Callbacks) {
    this.container = container;
    this.settings = settings;
    this.audio = audio;
    this.callbacks = callbacks;
    this.renderer = new T.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = T.SRGBColorSpace;
    this.renderer.toneMapping = T.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.7;
    const initialConfig = QUALITY_CONFIG[settings.quality] || QUALITY_CONFIG.medium;
    this.renderer.shadowMap.enabled = initialConfig.shadows;
    this.renderer.shadowMap.type = T.PCFSoftShadowMap;
    this.renderer.domElement.tabIndex = 0;
    this.renderer.domElement.setAttribute('aria-label', 'The Fold. First-person 3D world. WASD to move, mouse to look, left and right click to place folds.');
    this.renderer.domElement.className = 'world-canvas';
    container.appendChild(this.renderer.domElement);
    this.camera = new T.PerspectiveCamera(settings.fov, 1, 0.035, 1500);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);
    this.world = new FoldWorld(this.scene);
    // Image-based lighting from the sky: every surface picks up its colour, and glass, water, and metal reflect it.
    const environment = this.world.bakeEnvironment(this.renderer);
    this.portals = new PortalPair(this.scene);
    this.effects = new FoldEffects(this.scene);
    this.device = new FieldDevice(this.effects.glow);
    // Your own body. Hidden from the first-person camera, visible to portal cameras.
    this.robot = new PlayerRobot(this.effects.glow);
    this.scene.add(this.robot.group);
    // Recursion renders the scene several times; the sun's shadow map only needs to update once a frame.
    this.renderer.shadowMap.autoUpdate = false;
    this.viewCamera.add(this.device.group);
    this.viewScene.add(this.viewCamera);
    this.viewScene.environment = environment;
    this.viewScene.environmentIntensity = 0.55;
    // The device is lit by the same sun and sky as the world, from the same directions, so it never looks pasted on.
    const key = new T.DirectionalLight('#ffd8a8', 1.9);
    key.position.copy(this.world.sunDirection).multiplyScalar(5);
    const fill = new T.DirectionalLight('#a9c6d8', 0.5);
    fill.position.copy(this.world.sunDirection).multiplyScalar(-5).setY(2);
    this.viewScene.add(new T.HemisphereLight('#c5d7e4', '#6d6150', 0.68), key, fill);
    this.preview = this.makePreview();
    this.scene.add(this.preview);
    const spawn = new T.Vector3(...CHAPTERS[0].checkpoint);
    this.player = { id: 'player', position: spawn.clone(), spawn, velocity: new T.Vector3(), half: new T.Vector3(0.29, 0.9, 0.29), up: UP.clone(), gravity: new T.Vector3(0, -1, 0), rotation: new T.Quaternion(), grounded: false, cooldown: 0, stage: 0 };
    this.yaw = CHAPTERS[0].yaw;
    if (save) this.load(save);
    this.lastYaw = this.yaw;
    this.lastPitch = this.pitch;
    for (let i = 0; i < 8; i++) {
      this.projectiles.push({ shot: null, color: new T.Color(), normal: new T.Vector3(), active: false, age: 0, duration: 1, start: new T.Vector3(), end: new T.Vector3(), seat: new T.Vector3(), index: 0, surface: null, orientation: new T.Quaternion() });
    }
    this.bindEvents();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.updateCamera(0);
    this.updateAim();
    this.emitSnapshot();
    this.renderer.setAnimationLoop(time => this.frame(time));
    this.save();
    const failures = this.checks.filter(c => !c.passed);
    if (failures.length) console.error('Portal transform self-check failed', failures);
  }

  private bindEvents() {
    const options = { signal: this.abort.signal };
    const canvas = this.renderer.domElement;
    document.addEventListener('keydown', this.keyDown, options);
    document.addEventListener('keyup', e => {
      this.keys.delete(e.code);
      // Hold-and-release: a held G applies whatever the cursor points at. A quick tap latches the wheel open.
      if (e.code === 'KeyG' && this.wheelOpen && !this.wheelLatched) {
        if (this.time - this.wheelOpenedAt < 0.22 && this.wheelHover < 0) this.wheelLatched = true;
        else this.closeGravityWheel(true);
      }
    }, options);
    document.addEventListener('mousemove', this.mouseMove, options);
    document.addEventListener('pointerlockchange', () => {
      const locked = document.pointerLockElement === canvas;
      if (!locked && this.hadLock && this.active) this.pause();
      this.hadLock = locked;
      this.emitSnapshot();
    }, options);
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.active) this.pause(); }, options);
    window.addEventListener('blur', () => { if (this.active) this.pause(); }, options);
    window.addEventListener('beforeunload', () => this.save(), options);
    canvas.addEventListener('contextmenu', e => e.preventDefault(), options);
    canvas.addEventListener('pointerdown', e => {
      if (!this.active) return;
      e.preventDefault();
      canvas.focus();
      // While the wheel is open, a left click applies the highlighted direction and a right click cancels.
      if (this.wheelOpen && e.pointerType !== 'touch') {
        this.closeGravityWheel(e.button !== 2);
        return;
      }
      if (e.pointerType === 'touch') {
        this.touchPointer = e.pointerId;
        this.touchPosition.set(e.clientX, e.clientY);
        canvas.setPointerCapture(e.pointerId);
      } else if (document.pointerLockElement === canvas) this.fire(e.button === 2 ? 1 : 0);
      else {
        this.dragging = true;
        this.dragDistance = 0;
        this.dragButton = e.button;
        canvas.setPointerCapture(e.pointerId);
      }
    }, options);
    canvas.addEventListener('pointermove', e => {
      if (this.touchPointer !== e.pointerId || !this.active) return;
      this.look(e.clientX - this.touchPosition.x, e.clientY - this.touchPosition.y, 1.8);
      this.touchPosition.set(e.clientX, e.clientY);
    }, options);
    canvas.addEventListener('pointerup', e => {
      if (this.touchPointer === e.pointerId) this.touchPointer = null;
      if (this.dragging && this.active && this.dragDistance < 7) this.fire(this.dragButton === 2 ? 1 : 0);
      this.dragging = false;
    }, options);
    canvas.addEventListener('pointercancel', () => { this.dragging = false; this.touchPointer = null; }, options);
    canvas.addEventListener('dblclick', () => { if (this.active && !document.pointerLockElement) this.capture(); }, options);
    canvas.addEventListener('webglcontextlost', e => {
      e.preventDefault();
      this.pause();
      this.notify('Graphics context interrupted. Save and return to the title, then continue.');
    }, options);
  }

  private keyDown = (event: KeyboardEvent) => {
    if (!this.active || event.altKey || event.ctrlKey || event.metaKey) return;
    if (['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) event.preventDefault();
    this.keys.add(event.code);
    if (event.repeat) return;
    switch (event.code) {
      case 'KeyE': this.interact(); break;
      case 'KeyF': this.throwCube(); break;
      case 'KeyG':
        if (this.wheelOpen) this.closeGravityWheel(true);
        else this.openGravityWheel();
        break;
      case 'Space': this.jump(); break;
      case 'KeyR': this.resetCheckpoint(); break;
      case 'Tab': this.pause(false); this.callbacks.map(); break;
      case 'Escape': this.pause(); break;
      case 'Digit1': this.fire(0); break;
      case 'Digit2': this.fire(1); break;
    }
  };

  private mouseMove = (event: MouseEvent) => {
    if (!this.active) return;
    if (this.wheelOpen && document.pointerLockElement === this.renderer.domElement) {
      this.wheelCursor.x += event.movementX;
      this.wheelCursor.y += event.movementY;
      // A short leash: flick toward a slot, and pulling the other way switches immediately.
      if (this.wheelCursor.length() > 90) this.wheelCursor.setLength(90);
      const hover = wheelSlot(this.wheelCursor.x, this.wheelCursor.y);
      if (hover !== this.wheelHover) {
        this.wheelHover = hover;
        if (hover >= 0) this.audio.play('step');
        this.emitSnapshot();
      }
      return;
    }
    if (document.pointerLockElement === this.renderer.domElement || this.dragging) {
      this.look(event.movementX, event.movementY);
      this.dragDistance += Math.abs(event.movementX) + Math.abs(event.movementY);
    }
  };

  private look(x: number, y: number, multiplier = 1) {
    const sensitivity = this.settings.sensitivity * 0.0021 * multiplier;
    this.yaw -= x * sensitivity;
    this.pitch -= y * sensitivity * (this.settings.invertY ? -1 : 1);
    this.pitch = T.MathUtils.clamp(this.pitch, -1.5, 1.5);
  }

  capture() {
    if (this.destroyed) return;
    this.active = true;
    this.keys.clear();
    this.hadLock = false;
    this.audio.start();
    this.renderer.domElement.focus();
    if (!this.hasStarted) {
      this.hasStarted = true;
      if (this.stage < CHAPTERS.length) { this.say(CHAPTERS[this.stage].introduction); this.lastZone = this.stage; }
    }
    if (!window.matchMedia('(pointer: coarse)').matches) {
      try {
        const promise = this.renderer.domElement.requestPointerLock();
        if (promise) Promise.resolve(promise).catch(() => {
          if (this.active) this.notify('Mouse capture unavailable: drag to look, click to place a fold.');
        });
      } catch { this.notify('Drag to look. Click to place a fold. WASD to move.'); }
    }
    this.emitSnapshot();
  }

  pause(notify = true) {
    if (this.destroyed) return;
    this.wheelOpen = false;
    this.wheelLatched = false;
    this.wheelHover = -1;
    this.active = false;
    this.keys.clear();
    this.touchMove.set(0, 0);
    this.dragging = false;
    this.save();
    if (document.pointerLockElement === this.renderer.domElement) document.exitPointerLock();
    if (notify) this.callbacks.pause();
  }

  configure(settings: Settings) {
    this.settings = settings;
    this.audio.configure(settings);
    this.camera.fov = settings.fov;
    this.camera.updateProjectionMatrix();
    const config = QUALITY_CONFIG[settings.quality] || QUALITY_CONFIG.medium;
    this.renderer.shadowMap.enabled = config.shadows;
    const shadowSize = config.shadowMapSize;
    if (this.world.sun.shadow.mapSize.x !== shadowSize) {
      this.world.sun.shadow.mapSize.setScalar(shadowSize);
      // A shadow map is allocated once at its first size, so a new size needs a fresh map.
      this.world.sun.shadow.map?.dispose();
      this.world.sun.shadow.map = null;
    }
    this.resize();
  }

  private resize() {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    if (!width || !height) return;
    const config = QUALITY_CONFIG[this.settings.quality] || QUALITY_CONFIG.medium;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, config.pixelRatioLimit) * this.settings.resolution * this.adaptiveScale);
    this.renderer.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.viewCamera.aspect = width / height;
    this.viewCamera.updateProjectionMatrix();
    this.portals.resize(width, height, this.settings.quality, this.adaptiveScale);
  }

  private frame(milliseconds: number) {
    if (this.destroyed) return;
    const seconds = milliseconds / 1000;
    const dt = Math.min(0.065, this.lastTime ? seconds - this.lastTime : 0.016);
    this.lastTime = seconds;
    if (!this.active && seconds - this.lastRender < 0.15) return;
    this.lastRender = seconds;
    if (this.active) {
      this.frameAverage += (dt - this.frameAverage) * 0.08;
      this.fps = Math.round(1 / Math.max(0.001, this.frameAverage));
      this.time += dt;
      this.playtime += dt;
      // The world runs at a quarter speed while the gravity wheel is open.
      this.accumulator += this.wheelOpen ? dt * 0.25 : dt;
      while (this.accumulator >= FIXED_DT) {
        this.simulate(FIXED_DT);
        this.accumulator -= FIXED_DT;
      }
      this.updateCamera(dt);
      this.updateProjectiles(dt);
      this.aimTimer += dt;
      if (this.aimTimer >= 0.055) { this.updateAim(); this.aimTimer = 0; }
      this.updateMechanisms(dt);
      this.uiTime += dt;
      this.saveTime += dt;
      if (this.uiTime > 0.12) { this.emitSnapshot(); this.uiTime = 0; }
      if (this.saveTime > 12) { this.save(); this.saveTime = 0; }
      this.checkZones();
      this.adaptationTimer += dt;
      if (this.adaptationTimer >= 2) {
        this.adaptationTimer = 0;
        if (this.frameAverage > 0.0215 && this.adaptiveScale > 0.52) {
          this.adaptiveScale = Math.max(0.5, this.adaptiveScale - 0.12);
          this.resize();
          this.notify('Display resolution gently lowered to keep the world moving smoothly. Change render scale in Settings to adjust the baseline.');
        } else if (this.frameAverage < 0.018 && this.adaptiveScale < 1) {
          this.adaptiveScale = Math.min(1, this.adaptiveScale + 0.06);
          this.resize();
        }
      }
    }
    const step = this.active ? dt : 0;
    for (const portal of this.portals.portals) portal.update(step, this.time, this.portals.linked, this.settings.reducedMotion);
    if (!this.settings.reducedMotion && this.active) {
      this.world.animated.forEach(object => { object.rotation.y += dt * Number(object.userData.rate || 0); });
    }
    // Wind, water, and drifting cloud hold still under reduced motion; shadows still follow the player.
    this.world.tick(this.settings.reducedMotion ? 0 : step, this.player.position);
    this.effects.update(step);
    this.updateDevice(step);
    this.robot.update(step, {
      position: this.player.position,
      up: this.player.up,
      heading: this.heading(),
      speed: this.player.velocity.clone().addScaledVector(this.player.gravity, -this.player.velocity.dot(this.player.gravity)).length(),
      grounded: this.player.grounded,
      holding: !!this.held,
      reducedMotion: this.settings.reducedMotion,
    });
    this.preview.visible = this.active && this.aimPlaceable;
    const previewVisible = this.preview.visible;
    this.preview.visible = false;
    this.renderer.shadowMap.needsUpdate = true;
    this.robot.group.visible = true;
    const recursion = QUALITY_CONFIG[this.settings.quality]?.portalRecursion ?? 2;
    this.portals.render(this.renderer, this.camera, recursion);
    this.robot.group.visible = false;
    this.preview.visible = previewVisible;
    this.renderer.render(this.scene, this.camera);
    // Second pass: keep the finished world, clear only depth, then draw the device over it.
    this.renderer.autoClear = false;
    this.renderer.clearDepth();
    this.renderer.render(this.viewScene, this.viewCamera);
    this.renderer.autoClear = true;
  }

  private updateDevice(dt: number) {
    const lookYaw = this.yaw - this.lastYaw;
    const lookPitch = this.pitch - this.lastPitch;
    this.lastYaw = this.yaw;
    this.lastPitch = this.pitch;
    const speed = this.player.velocity.length();
    this.device.update(dt, {
      walking: this.player.grounded && speed > 0.8,
      speed,
      verticalSpeed: this.player.velocity.dot(this.player.up),
      lookYaw: dt > 0 ? lookYaw : 0,
      lookPitch: dt > 0 ? lookPitch : 0,
      portals: [this.portals.portals[0].active, this.portals.portals[1].active],
      holding: !!this.held,
      gravityMode: this.gravityMode,
      gravityUnlocked: this.gravityUnlocked,
      reducedMotion: this.settings.reducedMotion,
    });
  }

  private simulate(dt: number) {
    this.respawnCooldown = Math.max(0, this.respawnCooldown - dt);
    const basis = gravityBasis(this.player.up, this.yaw);
    const forward = basis.forward;
    const right = basis.right;
    const forwardInput = (this.keys.has('KeyW') ? 1 : 0) - (this.keys.has('KeyS') ? 1 : 0) - this.touchMove.y;
    const sideInput = (this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0) + this.touchMove.x;
    const wish = forward.multiplyScalar(forwardInput).addScaledVector(right, sideInput);
    if (wish.lengthSq() > 1) wish.normalize();
    const speed = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? 8.4 : 5.1;
    const velocity = this.player.velocity;
    if (this.player.grounded) {
      const blend = Math.min(1, dt * 15);
      velocity.lerp(wish.multiplyScalar(speed), blend);
    } else {
      // Air input adds acceleration instead of overwriting a portal launch's velocity.
      velocity.addScaledVector(wish, 5.5 * dt);
      const tangentVelocity = velocity.clone().addScaledVector(this.player.gravity, -velocity.dot(this.player.gravity));
      if (wish.lengthSq() === 0 && tangentVelocity.length() < 8) {
        velocity.addScaledVector(tangentVelocity, -dt * 0.35);
      }
    }
    if (this.keys.has('ArrowLeft')) this.yaw += dt * 1.5;
    if (this.keys.has('ArrowRight')) this.yaw -= dt * 1.5;
    if (this.keys.has('ArrowUp')) this.pitch = Math.min(1.5, this.pitch + dt);
    if (this.keys.has('ArrowDown')) this.pitch = Math.max(-1.5, this.pitch - dt);
    const gravityUp = this.gravityUnlocked ? this.player.gravity.clone().negate() : UP;
    const upright = new T.Quaternion().setFromUnitVectors(this.player.up, gravityUp);
    this.player.up.applyQuaternion(new T.Quaternion().slerp(upright, Math.min(1, dt * 8))).normalize();
    if (!this.gravityUnlocked) this.player.gravity.copy(this.player.up).negate();
    this.roll = T.MathUtils.damp(this.roll, 0, 6, dt);
    this.moveBody(this.player, dt);
    this.updateCamera(0);
    if (this.held) {
      const target = new T.Vector3(0.12, -0.37, -1.4).applyQuaternion(this.camera.quaternion).add(this.camera.position);
      const direction = target.clone().sub(this.camera.position);
      this.heldAimTimer += dt;
      if (this.heldAimTimer >= 0.055) {
        this.ray.set(this.camera.position, direction.clone().normalize());
        this.ray.far = direction.length();
        const hit = this.ray.intersectObjects(this.world.shootables, false)[0];
        this.heldClearance = hit && hit.distance < direction.length() ? Math.max(0.55, hit.distance - 0.52) : direction.length();
        this.heldAimTimer = 0;
      }
      if (this.heldClearance < direction.length()) target.copy(this.camera.position).addScaledVector(direction.normalize(), this.heldClearance);
      if (this.heldAcross) {
        const a = this.portals.portals[this.heldAcross.source];
        const b = this.portals.portals[this.heldAcross.destination];
        target.applyMatrix4(connectionMatrix(a.matrix, b.matrix));
      }
      const spring = target.sub(this.held.position).multiplyScalar(55).addScaledVector(this.held.velocity, -12);
      this.held.velocity.addScaledVector(spring, dt);
    }
    for (const cube of this.world.cubes) {
      this.moveBody(cube, dt);
      cube.group!.position.copy(cube.position);
      cube.group!.quaternion.copy(cube.rotation);
      const feet = cube.position.clone().addScaledVector(cube.up, -cube.half.y);
      const deepCube = this.world.inComplex(cube.position);
      if ((cube.position.y < -12 && !deepCube) || cube.position.y < -170 || this.world.isWater(feet) || (deepCube && this.world.hazardRecovery(cube.position))) {
        if (cube === this.held) { this.held = null; this.heldAcross = null; }
        cube.position.copy(cube.spawn); cube.velocity.set(0, 0, 0); cube.rotation.identity();
        this.notify('Core recovered at its original station.');
      }
    }
    const feet = this.player.position.clone().addScaledVector(this.player.up, -0.9);
    const { x, y, z } = this.player.position;
    const deep = this.world.inComplex(this.player.position);
    const outOfBounds = (y < -22 && !deep) || y < -170 || y > 200 || x < -372 || x > 950 || z < -228 || z > 795;
    const goo = deep ? this.world.hazardRecovery(this.player.position) : null;
    if (this.respawnCooldown <= 0 && (outOfBounds || goo || this.world.isWater(feet))) {
      const bank = outOfBounds ? null : goo ?? this.world.recoveryPoint(this.player.position);
      if (bank) {
        // A slip into the Pueblo river is not a puzzle failure, so it costs a few steps, not a checkpoint.
        this.player.position.set(...bank);
        this.player.velocity.set(0, 0, 0);
        this.player.gravity.set(0, -1, 0);
        this.player.up.copy(UP);
        this.gravityMode = 0;
        this.player.grounded = false;
        this.respawnCooldown = 1.2;
        this.updateCamera(0);
        this.audio.play('traverse');
        this.notify(goo ? 'The goo is not load-bearing. Back to the chamber entrance.' : 'The promenade is a kinder place to stand. Back on the riverbank.');
      } else {
        this.resetCheckpoint();
        this.notify('Water is not fold-compatible. Returned to your checkpoint.');
      }
    }
    const tangentialSpeed = velocity.clone().addScaledVector(this.player.gravity, -velocity.dot(this.player.gravity)).length();
    if (this.player.grounded && tangentialSpeed > 1) {
      this.stepTime += dt * tangentialSpeed;
      if (this.stepTime > 2.2) { this.audio.play('step'); this.stepTime = 0; }
    }
  }

  private halfExtents(body: Body) {
    if (body.id !== 'player') return body.half;
    return new T.Vector3(Math.abs(body.up.x) * 0.6 + 0.29, Math.abs(body.up.y) * 0.6 + 0.29, Math.abs(body.up.z) * 0.6 + 0.29);
  }

  private overlaps(position: T.Vector3, half: T.Vector3, box: T.Box3, epsilon = 0.0001) {
    return position.x + half.x > box.min.x + epsilon && position.x - half.x < box.max.x - epsilon &&
      position.y + half.y > box.min.y + epsilon && position.y - half.y < box.max.y - epsilon &&
      position.z + half.z > box.min.z + epsilon && position.z - half.z < box.max.z - epsilon;
  }

  private canOccupy(position: T.Vector3, half: T.Vector3, body: Body, exclude: number) {
    return !this.world.nearbyColliders(position, half, 1).some(c => c.enabled && c.id !== exclude && this.overlaps(position, half, c.box) && !this.portals.ignoresCollider(c.id, position, body, c.box));
  }

  private moveBody(body: Body, dt: number) {
    body.cooldown = Math.max(0, body.cooldown - dt);
    const downSpeed = body.velocity.dot(body.gravity);
    if (downSpeed < 55) body.velocity.addScaledVector(body.gravity, Math.min(20 * dt, 55 - downSpeed));
    const steps = Math.max(1, Math.ceil(body.velocity.length() * dt / 0.14));
    const slice = dt / steps;
    let wasGrounded = body.grounded;
    body.grounded = false;
    for (let step = 0; step < steps; step++) {
      const before = body.position.clone();
      let next = before.clone().addScaledVector(body.velocity, slice);
      const crossing = this.portals.crossing(body, before, next);
      if (crossing) {
        const { matrix, rotation, destination } = crossing;
        const after = next.clone().applyMatrix4(matrix).addScaledVector(destination.normal, 0.025);
        // Folds rotate orientation and momentum, not the gravity field of the world.
        const transformedUp = body.id === 'player' ? body.gravity.clone().negate().normalize() : UP.clone();
        const testHalf = body.id === 'player' ? new T.Vector3(Math.abs(transformedUp.x) * 0.6 + 0.29, Math.abs(transformedUp.y) * 0.6 + 0.29, Math.abs(transformedUp.z) * 0.6 + 0.29) : body.half;
        // Whatever lies behind the exit (its surface and every layer under it) cannot block the exit.
        const blocked = this.world.nearbyColliders(after, testHalf, 0.6).some(c => c.enabled && !destination.surface?.colliders.includes(c.id) && !this.portals.behind(destination, c.box) && this.overlaps(after, testHalf, c.box)) || this.world.cubes.some(c => c !== body && c !== this.held && this.overlaps(after, testHalf, new T.Box3(c.position.clone().sub(c.half), c.position.clone().add(c.half))));
        if (!blocked) {
          before.applyMatrix4(matrix).addScaledVector(destination.normal, 0.025);
          next = after;
          body.position.copy(before);
          body.velocity.applyQuaternion(rotation);
          body.rotation.premultiply(rotation);
          body.up.copy(transformedUp);
          body.cooldown = 0.1;
          wasGrounded = false;
          if (body.id === 'player') {
            const view = this.camera.quaternion.clone().premultiply(rotation);
            const look = orientationInGravity(view, this.player.up);
            this.yaw = look.yaw;
            this.pitch = T.MathUtils.clamp(look.pitch, -1.5, 1.5);
            this.roll = this.settleRoll(view);
            if (this.gravityUnlocked) {
              let nearest = 0; let agreement = -Infinity;
              for (let i = 0; i < GRAVITY_DIRECTIONS.length; i++) {
                const dot = this.player.gravity.dot(new T.Vector3(...GRAVITY_DIRECTIONS[i]));
                if (dot > agreement) { agreement = dot; nearest = i; }
              }
              this.gravityMode = nearest;
            }
            if (this.held) {
              // A carried core can cross first. In that case, do not transform it a second time.
              if (!this.heldAcross) {
                this.held.position.applyMatrix4(matrix).addScaledVector(destination.normal, 0.025);
                this.held.velocity.applyQuaternion(rotation);
                this.held.rotation.premultiply(rotation);
              }
              this.heldAcross = null;
              this.held.cooldown = 0.16;
            }
            this.audio.play('traverse');
          } else if (body === this.held) {
            if (this.heldAcross?.source === destination.index) this.heldAcross = null;
            else this.heldAcross = { source: 1 - destination.index, destination: destination.index };
          }
        } else {
          next.copy(before);
          if (body.id === 'player') this.notify('The exit is obstructed. Move the core or choose another anchor.');
        }
      }
      const half = this.halfExtents(body);
      const delta = next.clone().sub(before);
      for (const axis of ['x', 'z', 'y'] as const) {
        const axisStart = body.position.clone();
        body.position[axis] += delta[axis];
        for (const collider of this.world.nearbyColliders(body.position, half, 0.8)) {
          if (!collider.enabled || !this.overlaps(body.position, half, collider.box) || this.portals.ignoresCollider(collider.id, body.position, body, collider.box)) continue;
          const stepHeight = collider.box.max.y - (body.position.y - half.y);
          if (axis !== 'y' && this.portals.ignoresCollider(collider.id, axisStart, body, collider.box)) {
            // Never resolve an aperture edge against the far edge of its entire backing wall.
            body.position[axis] = axisStart[axis]; body.velocity[axis] = 0; continue;
          }
          if (body.id === 'player' && body.gravity.y < -0.95 && axis !== 'y' && wasGrounded && stepHeight > 0 && stepHeight <= 0.39) {
            const raised = body.position.clone(); raised.y = collider.box.max.y + half.y + 0.001;
            if (this.canOccupy(raised, half, body, collider.id)) { body.position.copy(raised); body.grounded = true; continue; }
          }
          if (delta[axis] > 0) body.position[axis] = collider.box.min[axis] - half[axis] - 0.0005;
          else if (delta[axis] < 0) body.position[axis] = collider.box.max[axis] + half[axis] + 0.0005;
          else continue;
          if (this.isGravityContact(body, axis, delta[axis])) {
            body.grounded = true;
            if (body.id !== 'player' && body.velocity.y < -3 && body.position.distanceTo(this.player.position) < 15) this.audio.play('impact', (body.position.x - this.player.position.x) / 14);
          }
          body.velocity[axis] = 0;
        }
        if (body.id === 'player') {
          for (const cube of this.world.cubes) {
            if (cube === this.held) continue;
            const box = new T.Box3(cube.position.clone().sub(cube.half), cube.position.clone().add(cube.half));
            if (!this.overlaps(body.position, half, box)) continue;
            if (delta[axis] > 0) body.position[axis] = box.min[axis] - half[axis] - 0.001;
            else if (delta[axis] < 0) body.position[axis] = box.max[axis] + half[axis] + 0.001;
            else continue;
            if (this.isGravityContact(body, axis, delta[axis])) body.grounded = true;
            else if (axis !== 'y') cube.velocity[axis] += body.velocity[axis] * 0.28;
            body.velocity[axis] = 0;
          }
        } else {
          for (const other of this.world.cubes) {
            if (other === body || other === this.held) continue;
            const box = new T.Box3(other.position.clone().sub(other.half), other.position.clone().add(other.half));
            if (!this.overlaps(body.position, half, box) || delta[axis] === 0) continue;
            body.position[axis] = delta[axis] > 0 ? box.min[axis] - half[axis] - 0.001 : box.max[axis] + half[axis] + 0.001;
            if (this.isGravityContact(body, axis, delta[axis])) body.grounded = true;
            else other.velocity[axis] += body.velocity[axis] * 0.45;
            body.velocity[axis] *= axis === 'y' ? 0 : 0.35;
          }
        }
      }
    }
    if (body.id !== 'player' && body.grounded && body !== this.held) {
      const normalSpeed = body.velocity.dot(body.gravity);
      const normalVelocity = body.gravity.clone().multiplyScalar(normalSpeed);
      body.velocity.addScaledVector(body.velocity.clone().sub(normalVelocity), -Math.min(1, dt * 7));
    }
  }

  private isGravityContact(body: Body, axis: 'x' | 'y' | 'z', displacement: number) {
    const gravity = body.gravity[axis];
    return Math.abs(gravity) > 0.95 && displacement * gravity > 0;
  }

  private updateCamera(_dt: number) {
    this.camera.position.copy(this.player.position).addScaledVector(this.player.up, CAMERA_HEIGHT);
    this.camera.up.copy(this.player.up);
    this.camera.lookAt(this.camera.position.clone().add(gravityLook(this.player.up, this.yaw, this.pitch)));
    // A fold rotated against yours can deliver you rolled. That roll eases out instead of snapping.
    if (Math.abs(this.roll) > 1e-4) this.camera.rotateZ(this.roll);
    this.camera.updateMatrixWorld();
    // The device's camera shares the view's orientation but sits at the origin of its own scene.
    this.viewCamera.quaternion.copy(this.camera.quaternion);
    this.viewCamera.updateMatrixWorld();
  }

  private updateAim() {
    this.ray.setFromCamera(new T.Vector2(0, 0), this.camera);
    this.ray.far = 180;
    const hit = this.ray.intersectObjects(this.world.shootables, false)[0];
    this.aimSurface = hit ? this.world.surfaceFromHit(hit) : null;
    if (hit) this.aimPoint.copy(hit.point);
    else this.aimPoint.copy(this.camera.position).addScaledVector(this.camera.getWorldDirection(new T.Vector3()), 70);
    if (hit?.face) this.aimNormal.copy(hit.face.normal).transformDirection(hit.object.matrixWorld);
    else this.aimNormal.copy(this.camera.getWorldDirection(new T.Vector3())).negate();
    this.aimPlacement = null;
    this.aimPlaceable = false;
    if (this.aimSurface) {
      this.aimOrientation.copy(this.portalOrientation(this.aimSurface));
      this.aimSeat.copy(this.seatPoint(this.aimSurface, this.aimPoint));
      this.aimPlacement = fitPortal(this.aimSurface, this.aimSeat, this.aimOrientation);
    }
    if (this.aimSurface && this.aimPlacement) {
      this.aimPlaceable = !this.portalWouldOverlap(this.aimPlacement, 0) || !this.portalWouldOverlap(this.aimPlacement, 1);
      // A tiny marker where the crosshair meets the surface. It grows with distance so it stays the same size on screen.
      const distance = this.camera.position.distanceTo(this.aimPoint);
      this.preview.position.copy(this.aimPoint).addScaledVector(this.aimSurface.normal, 0.02);
      this.preview.quaternion.copy(this.aimSurface.quaternion);
      this.preview.scale.setScalar(Math.max(1, distance / 12));
    }
    this.currentInteraction = this.findInteraction();
    const direction = this.camera.getWorldDirection(new T.Vector3());
    this.aimedCube = this.world.cubes.find(c => {
      if (c === this.held || c.position.distanceTo(this.camera.position) > 2.9) return false;
      const towards = c.position.clone().sub(this.camera.position);
      if (towards.normalize().dot(direction) < 0.9) return false;
      this.ray.set(this.camera.position, towards); this.ray.far = this.camera.position.distanceTo(c.position) - 0.55;
      return this.ray.intersectObjects(this.world.shootables, false).length === 0;
    }) || null;
  }

  private findInteraction() {
    const direction = this.camera.getWorldDirection(new T.Vector3());
    const candidates = this.world.interactions.filter(interaction => {
      if (interaction.kind === 'hatch' && !interaction.hatch?.enabled) return false;
      const distance = interaction.position.distanceTo(this.camera.position);
      if (distance > (interaction.kind === 'hatch' ? 3.1 : interaction.kind === 'door' ? 4.5 : 2.8)) return false;
      const toward = interaction.position.clone().sub(this.camera.position).normalize();
      if (toward.dot(direction) < 0.73) return false;
      // Door controls remain usable with the closed shutter directly behind their panel.
      if (interaction.kind === 'door') return true;
      this.ray.set(this.camera.position, toward); this.ray.far = Math.max(0.1, distance - 0.2);
      return !this.ray.intersectObjects(this.world.shootables, false).some(hit =>
        hit.object !== interaction.mesh);
    });
    return candidates.sort((a, b) => a.position.distanceToSquared(this.camera.position) - b.position.distanceToSquared(this.camera.position))[0] || null;
  }

  fire(index: number) {
    if (!this.active || this.time - this.fireTime < 0.2) return;
    this.fireTime = this.time;
    this.updateAim();
    const surface = this.aimSurface;
    const placement = this.aimPlacement;
    if (surface && !placement) {
      const level = Math.abs(surface.normal.dot(this.player.gravity)) > 0.98;
      this.notify(level
        ? 'No room for a fold facing this way. Turn to face along the surface and try again.'
        : 'No room for a fold upright here. Try a wider patch, or shift your gravity.');
      this.audio.play('error'); this.device.deny(); this.effects.fizzle(this.aimPoint, surface.normal); return;
    }
    if (placement && this.portalWouldOverlap(placement, index)) {
      this.notify('Leave a clear portal-sized gap between the two endpoints.');
      this.audio.play('error'); this.device.deny(); this.effects.fizzle(this.aimPoint, this.aimNormal); return;
    }
    this.audio.play(index === 0 ? 'fireA' : 'fireB');
    this.device.fire(index);
    this.robot.setTint(index === 0 ? PORTAL_BLUE : PORTAL_ORANGE);
    const projectile = this.projectiles.find(p => !p.active) || this.projectiles[0];
    if (projectile.shot) this.effects.endShot(projectile.shot);
    projectile.active = true;
    projectile.age = 0;
    projectile.index = index;
    projectile.surface = surface;
    projectile.orientation.copy(this.aimOrientation);
    projectile.color.copy(index === 0 ? PORTAL_BLUE : PORTAL_ORANGE);
    projectile.normal.copy(this.aimNormal);
    projectile.end.copy(this.aimPoint);
    projectile.seat.copy(this.aimSeat);
    projectile.start.copy(this.muzzleStart());
    projectile.duration = Math.max(0.065, Math.min(0.65, projectile.start.distanceTo(projectile.end) / 100));
    projectile.shot = this.effects.launchShot(projectile.color, projectile.start);
    if (!surface) this.notify('Aim for a large, solid, flat patch. Broad walls, floors, roofs, and anchor panels all work.');
  }

  /**
   * Where a shot should start in the world so that on screen it leaves the device's aperture. The device
   * draws with its own camera, so its muzzle is projected to the screen, then cast back out into the world.
   */
  private muzzleStart() {
    const ndc = this.device.muzzleWorld(new T.Vector3()).project(this.viewCamera);
    const through = new T.Vector3(ndc.x, ndc.y, 0.5).unproject(this.camera).sub(this.camera.position).normalize();
    const reach = Math.min(0.75, this.camera.position.distanceTo(this.aimPoint) * 0.5);
    return this.camera.position.clone().addScaledVector(through, reach);
  }

  /**
   * Whether a seated fold would overlap the other endpoint on the same plane. Both rims are ellipses at
   * arbitrary rotations, so they are compared by their reach along the line joining their centres.
   */
  private portalWouldOverlap(placement: PortalPlacement, index: number) {
    const normal = new T.Vector3(0, 0, 1).applyQuaternion(placement.quaternion);
    return this.portals.portals.some(portal => {
      if (portal.index === index || !portal.active || Math.abs(portal.normal.dot(normal)) < 0.995) return false;
      const delta = placement.position.clone().sub(portal.group.position);
      if (Math.abs(delta.dot(normal)) > 0.12) return false;
      const gap = delta.length();
      if (gap < 1e-4) return true;
      delta.divideScalar(gap);
      return gap < portalExtent(placement.quaternion, delta) + portalExtent(portal.group.quaternion, delta) + 0.05;
    });
  }

  /** The direction the player's body faces within their own gravity frame. */
  private heading() {
    return gravityBasis(this.player.up, this.yaw).forward;
  }

  /**
   * Wall folds aimed near the floor settle down until their bottom edge meets the floor, so you can
   * walk straight into them. Aim higher than about 3 m and the fold stays where you put it, which
   * keeps high exits for momentum puzzles. "Floor" follows your current gravity.
   */
  private seatPoint(surface: PortalSurface, point: T.Vector3) {
    const gravity = this.player.gravity;
    const along = gravity.dot(surface.normal);
    if (Math.abs(along) > 0.5) return point.clone();
    const down = gravity.clone().addScaledVector(surface.normal, -along).normalize();
    const right = new T.Vector3(1, 0, 0).applyQuaternion(surface.quaternion);
    const faceUp = new T.Vector3(0, 1, 0).applyQuaternion(surface.quaternion);
    const reach = Math.abs(right.dot(down)) * surface.width / 2 + Math.abs(faceUp.dot(down)) * surface.height / 2;
    const toBottom = reach - point.clone().sub(surface.position).dot(down);
    // Short faces (doors, panels, low walls) always settle; tall walls only when aimed near their foot.
    const settle = toBottom > 0 && (toBottom < 3.2 || reach * 2 < 6.5);
    return settle ? point.clone().addScaledVector(down, toBottom) : point.clone();
  }

  private portalOrientation(surface: PortalSurface) {
    return orientPortal(surface.normal, this.player.gravity.clone().negate().normalize(), this.heading());
  }

  /**
   * Roll between the view a fold delivered and the gravity-upright view with the same heading,
   * measured about the view axis. Applying it on exit, then easing it to zero, turns what would be a
   * snap into a short settling motion.
   */
  private settleRoll(view: T.Quaternion) {
    if (this.settings.reducedMotion) return 0;
    const forward = gravityLook(this.player.up, this.yaw, this.pitch);
    const upright = this.heading().multiplyScalar(-Math.sin(this.pitch)).addScaledVector(this.player.up, Math.cos(this.pitch)).normalize();
    const delivered = new T.Vector3(0, 1, 0).applyQuaternion(view);
    delivered.addScaledVector(forward, -delivered.dot(forward));
    if (delivered.lengthSq() < 1e-6) return 0;
    delivered.normalize();
    const back = forward.negate();
    return Math.atan2(upright.clone().cross(delivered).dot(back), T.MathUtils.clamp(upright.dot(delivered), -1, 1));
  }

  /** A tiny blue circle marking where a fold can land: a thin ring around a centre dot, always drawn on top. */
  private makePreview() {
    const material = new T.MeshBasicMaterial({ color: '#5cb6ff', transparent: true, opacity: 0.95, depthTest: false, depthWrite: false, toneMapped: false, side: T.DoubleSide });
    const group = new T.Group();
    for (const geometry of [new T.RingGeometry(0.05, 0.075, 36), new T.CircleGeometry(0.017, 16)]) {
      const mesh = new T.Mesh(geometry, material);
      mesh.renderOrder = 10;
      group.add(mesh);
    }
    group.visible = false;
    return group;
  }

  private updateProjectiles(dt: number) {
    for (const projectile of this.projectiles) {
      if (!projectile.active) continue;
      projectile.age += dt;
      const t = Math.min(1, projectile.age / projectile.duration);
      const position = projectile.start.clone().lerp(projectile.end, t);
      if (projectile.shot) this.effects.moveShot(projectile.shot, position);
      if (t >= 1) {
        projectile.active = false;
        if (projectile.shot) { this.effects.endShot(projectile.shot); projectile.shot = null; }
        // Re-seat on arrival with the rotation chosen at firing time; the other fold may have moved since.
        const placement = projectile.surface ? fitPortal(projectile.surface, projectile.end, projectile.orientation) : null;
        if (projectile.surface && placement && !this.portalWouldOverlap(placement, projectile.index)) {
          if (this.heldAcross) { this.held = null; this.heldAcross = null; }
          this.clearPortalThreshold(projectile.index);
          this.portals.portals[projectile.index].place(projectile.surface, placement);
          this.effects.portalBurst(placement.position, placement.quaternion, projectile.color);
          // The partner brightens too, so the new connection is visible at both ends.
          if (this.portals.linked) this.portals.portals[1 - projectile.index].pulse();
          this.audio.play('open', projectile.index === 0 ? -0.3 : 0.3);
          this.notify(this.portals.linked ? 'Connection established. Step through either fold.' : `${projectile.index === 0 ? 'Blue' : 'Orange'} anchor set. Place the other fold to connect.`);
          this.emitSnapshot();
        } else {
          this.effects.fizzle(projectile.end, projectile.normal);
        }
      }
    }
  }

  private clearPortalThreshold(index: number) {
    const portal = this.portals.portals[index];
    if (!portal.active) return;
    for (const body of [this.player, ...this.world.cubes]) {
      const half = this.halfExtents(body);
      const support = Math.abs(portal.normal.x) * half.x + Math.abs(portal.normal.y) * half.y + Math.abs(portal.normal.z) * half.z;
      const distance = body.position.clone().sub(portal.group.position).dot(portal.normal);
      if (Math.abs(distance) >= support + 0.05 || !portal.contains(body.position, body)) continue;
      body.position.addScaledVector(portal.normal, support + 0.06 - distance);
      const inwardSpeed = body.velocity.dot(portal.normal);
      if (inwardSpeed < 0) body.velocity.addScaledVector(portal.normal, -inwardSpeed);
    }
  }

  interact() {
    if (!this.active) return;
    this.updateAim();
    const interaction = this.currentInteraction;
    if (interaction && (!this.aimedCube || this.held || interaction.kind === 'door' || interaction.kind === 'hatch' && this.camera.getWorldDirection(new T.Vector3()).y > -0.45)) {
      if (interaction.kind === 'note') {
        const note = RESEARCH_NOTES.find(n => n.id === interaction.id);
        if (note) {
          if (!this.notes.includes(note.id)) this.notes.push(note.id);
          this.say(note.text);
          this.notify(`Field note collected: ${note.title}`);
          this.audio.play('pickup'); this.save();
        }
      } else if (interaction.kind === 'hatch') {
        const hatch = interaction.hatch!;
        const center = hatch.box.getCenter(new T.Vector3());
        if (Math.abs(this.player.position.x - center.x) > 1.05 || Math.abs(this.player.position.z - center.z) > 1.3) {
          this.notify('Stand in the center of the grated hatch before releasing it.'); return;
        }
        hatch.enabled = false; hatch.mesh.visible = false;
        this.audio.play('door');
        this.notify('Hatch released. Momentum is yours to keep.');
      } else if (interaction.kind === 'door') {
        const door = interaction.door!;
        door.open = 1;
        const size = door.collider.box.getSize(new T.Vector3());
        door.mesh.position.y = door.homeY + (door.travel ?? 6.2);
        door.mesh.updateMatrixWorld();
        door.collider.box.setFromCenterAndSize(door.mesh.position, size);
        door.collider.enabled = false;
        this.audio.play('door');
        this.notify('Mountain lab shutter released. Welcome inside.');
      } else if (interaction.kind === 'lift' && interaction.target) {
        this.held = null; this.heldAcross = null;
        this.player.position.set(...interaction.target);
        this.player.velocity.set(0, 0, 0);
        this.gravityMode = 0; this.player.gravity.set(0, -1, 0); this.player.up.copy(UP);
        this.player.grounded = false; this.respawnCooldown = 1;
        this.audio.play('traverse');
        this.updateCamera(0);
        this.notify(interaction.target[1] < -40 ? 'Going down. Mind the gap between floors.' : 'Back on the surface. The sky is where you left it.');
        this.emitSnapshot(); this.save();
      } else if (interaction.kind === 'gravity') {
        if (this.gravityUnlocked) { this.notify('The Vector Shifter is calibrated. Hold G to open the gravity wheel.'); return; }
        this.gravityUnlocked = true;
        this.gravityMode = 0;
        this.player.gravity.set(...GRAVITY_DIRECTIONS[0]);
        this.player.up.copy(UP);
        this.audio.play('complete');
        this.say('A Vector Shifter. Six directions, one very small wheel. Hold G, flick toward a direction, and let go. Time slows while you choose, but momentum carries on, so change direction somewhere with room to fall.');
        this.notify('VECTOR SHIFTER ONLINE / G TO CHANGE GRAVITY');
        this.save(); this.emitSnapshot();
      } else {
        if (this.stage < interaction.stage) { this.notify('The upstream relay is offline. Open the field map with Tab.'); this.audio.play('error'); return; }
        if (this.stage > interaction.stage) { this.notify('Relay calibrated. This connection is stable.'); return; }
        if (interaction.requiredSwitches?.some(id => !this.world.switches.find(s => s.id === id)?.active)) {
          this.notify('The floor switches must remain powered. Use the field cores.'); this.audio.play('error'); return;
        }
        if (interaction.requiredGravity !== undefined && this.gravityMode !== interaction.requiredGravity) {
          this.notify(`The field receiver needs gravity ${GRAVITY_LABELS[interaction.requiredGravity]}. Hold G and choose it on the wheel.`);
          this.audio.play('error'); return;
        }
        this.completeStage();
      }
      return;
    }
    if (this.held) {
      this.held.velocity.copy(this.carrySpaceVector(this.player.velocity)).multiplyScalar(0.5);
      this.held = null; this.heldAcross = null; this.audio.play('pickup'); return;
    }
    if (this.aimedCube) {
      this.held = this.aimedCube;
      this.heldAcross = null;
      this.held.velocity.set(0, 0, 0);
      this.audio.play('pickup');
      this.notify('E to set down. F to throw. Your core can travel through a fold.');
    }
  }

  throwCube() {
    if (!this.active || !this.held) return;
    this.held.velocity.copy(this.carrySpaceVector(this.camera.getWorldDirection(new T.Vector3()))).multiplyScalar(12).add(this.carrySpaceVector(this.player.velocity));
    this.held = null; this.heldAcross = null; this.audio.play('pickup');
  }

  private carrySpaceVector(vector: T.Vector3) {
    const result = vector.clone();
    if (this.heldAcross) {
      const a = this.portals.portals[this.heldAcross.source];
      const b = this.portals.portals[this.heldAcross.destination];
      result.applyQuaternion(new T.Quaternion().setFromRotationMatrix(connectionMatrix(a.matrix, b.matrix)));
    }
    return result;
  }

  jump() {
    if (this.active && this.player.grounded) { this.player.velocity.addScaledVector(this.player.up, 7.2); this.player.grounded = false; }
  }

  /** Opens the Vector Shifter's selection wheel. Time slows while it is up, so choosing mid-fall is fair. */
  openGravityWheel() {
    if (!this.active || this.wheelOpen) return;
    if (!this.gravityUnlocked) { this.notify('The Vector Shifter is inside the mountain field lab. The northern trail starts beyond the ridge array.'); return; }
    this.wheelOpen = true;
    this.wheelLatched = false;
    this.wheelHover = -1;
    this.wheelOpenedAt = this.time;
    this.wheelCursor.set(0, 0);
    this.audio.play('pickup');
    this.emitSnapshot();
  }

  /** Closes the wheel, applying the highlighted direction if asked to and one is highlighted. */
  closeGravityWheel(apply: boolean) {
    if (!this.wheelOpen) return;
    const slot = this.wheelHover;
    this.wheelOpen = false;
    this.wheelLatched = false;
    this.wheelHover = -1;
    if (apply && slot >= 0) this.setGravity(WHEEL_ORDER[slot]);
    else this.emitSnapshot();
  }

  /** Direct choice, used by the clickable and touchable wheel. */
  chooseGravity(mode: number) {
    if (!this.active || !this.gravityUnlocked) return;
    this.wheelOpen = false;
    this.wheelLatched = false;
    this.wheelHover = -1;
    this.setGravity(mode);
  }

  private setGravity(mode: number) {
    if (mode === this.gravityMode) { this.emitSnapshot(); return; }
    this.gravityMode = mode;
    this.player.gravity.set(...GRAVITY_DIRECTIONS[mode]);
    this.player.grounded = false;
    this.audio.play('switch');
    this.updateCamera(0);
    this.notify(`Gravity now pulls ${GRAVITY_LABELS[mode].toLowerCase()}. Momentum is unchanged.`);
    this.emitSnapshot(); this.save();
  }

  /** Where each gravity direction points relative to the current view, for the wheel's sub-labels. */
  private gravityRelative() {
    const forward = this.camera.getWorldDirection(new T.Vector3());
    const right = new T.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
    const up = new T.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);
    return GRAVITY_DIRECTIONS.map(direction => {
      const d = new T.Vector3(...direction);
      const options: [number, string][] = [
        [d.dot(forward), 'AHEAD'], [-d.dot(forward), 'BEHIND'],
        [d.dot(right), 'RIGHT'], [-d.dot(right), 'LEFT'],
        [d.dot(up), 'OVERHEAD'], [-d.dot(up), 'UNDERFOOT'],
      ];
      return options.reduce((best, option) => option[0] > best[0] ? option : best)[1];
    });
  }

  setTouchMovement(x: number, y: number) { this.touchMove.set(x, y); }

  private switchHasCube(id: string) {
    const plate = this.world.switches.find(s => s.id === id)!;
    return this.world.cubes.some(c => c !== this.held && c.gravity.y < -0.95 && Math.hypot(c.position.x - plate.position.x, c.position.z - plate.position.z) < 0.79 && Math.abs(c.position.y - c.half.y - plate.position.y) < 0.23 && Math.abs(c.velocity.y) < 0.5);
  }

  private updateMechanisms(dt: number) {
    for (const plate of this.world.switches) {
      const playerWeight = this.player.gravity.y < -0.95 && Math.hypot(this.player.position.x - plate.position.x, this.player.position.z - plate.position.z) < 0.7 && Math.abs(this.player.position.y - 0.89 - plate.position.y) < 0.24 && this.player.grounded;
      const active = this.switchHasCube(plate.id) || playerWeight;
      if (active !== plate.active) {
        plate.active = active;
        this.audio.play('switch', T.MathUtils.clamp((plate.position.x - this.player.position.x) / 15, -1, 1));
        (plate.light.material as T.MeshBasicMaterial).color.set(active ? '#a9eed1' : '#edb778');
        plate.mesh.material = this.world.material(active ? '#78b39a' : '#a58256');
        plate.mesh.position.y = plate.position.y + (active ? -0.075 : -0.015);
      }
    }
    for (const door of this.world.doors) {
      const pressurePowered = door.switchIds.length > 0 && door.switchIds.every(id => this.world.switches.find(s => s.id === id)?.active);
      let shouldOpen = pressurePowered || (door.minimumStage !== undefined && this.stage >= door.minimumStage);
      const size = door.collider.box.getSize(new T.Vector3());
      const closedCenter = door.mesh.position.clone(); closedCenter.y = door.homeY;
      const closedBox = new T.Box3().setFromCenterAndSize(closedCenter, size);
      if (door.open < 0.88 && [this.player, ...this.world.cubes].some(b => this.overlaps(b.position, this.halfExtents(b), closedBox))) shouldOpen = true;
      const oldOpen = door.open;
      door.open = T.MathUtils.damp(door.open, shouldOpen ? 1 : 0, 4.5, dt);
      if (oldOpen < 0.01 && door.open >= 0.01 && door.mesh.position.distanceTo(this.player.position) < 24) this.audio.play('door');
      door.mesh.position.y = door.homeY + door.open * (door.travel ?? 6.2);
      door.mesh.updateMatrixWorld();
      door.collider.box.setFromCenterAndSize(door.mesh.position, size);
      door.collider.enabled = door.open < 0.88;
    }
    if (this.stage === 0 && this.switchHasCube('discovery')) this.completeStage();
    if (this.stage === 3 && this.switchHasCube('lake')) this.completeStage();
  }

  private completeStage() {
    if (this.stage >= CHAPTERS.length) return;
    const completed = this.stage;
    this.stage++;
    if (completed === 5 && this.gravityUnlocked) {
      this.gravityMode = 0;
      this.player.gravity.set(...GRAVITY_DIRECTIONS[0]);
      this.player.up.copy(UP);
      this.player.position.y = 1.02;
      this.player.velocity.set(0, 0, 0);
      this.player.grounded = false;
    }
    this.audio.play('complete');
    this.say(CHAPTERS[completed].completion);
    this.notify(this.stage === CHAPTERS.length ? 'The Fold is stable. Walsenburg is home again.' : `Connection ${String(completed + 1).padStart(2, '0')} restored. Checkpoint saved.`);
    this.save(); this.emitSnapshot();
    if (this.stage === CHAPTERS.length) { this.pause(false); this.callbacks.win(); }
  }

  private checkZones() {
    if (!this.puebloGreeted && this.player.position.x > 215 && this.player.position.z < 300) {
      this.puebloGreeted = true;
      this.say('Pueblo. Five mountains wide, and not one of them in the way. The Fold reaches this far as well, so please place your folds responsibly. The city has a permit process. I have read all of it.');
      return;
    }
    if (!this.trinidadGreeted && this.player.position.z > 330) {
      this.trinidadGreeted = true;
      this.say('Trinidad! Brick streets, a neon theater, a lake with opinions, and a mesa that is frankly showing off. Everything broad and flat still takes a fold. The balloons are decorative. Probably.');
      return;
    }
    if (!this.deepGreeted && this.world.inComplex(this.player.position)) {
      this.deepGreeted = true;
      this.say('Welcome to the Deep Fold. Fifteen chambers, one rule per wall: white holds folds, dark does not. Press R to reset any chamber. I will be over here, pretending not to keep score.');
      return;
    }
    if (this.stage >= CHAPTERS.length || this.lastZone === this.stage || this.time < this.subtitleUntil + 2) return;
    const [x, z] = CHAPTERS[this.stage].location;
    if (Math.hypot(this.player.position.x - x, this.player.position.z - z) < 22) {
      this.lastZone = this.stage;
      this.say(CHAPTERS[this.stage].introduction);
    }
  }

  resetCheckpoint() {
    // In the Deep Fold, R resets only the current chamber: its core goes home and you go to its entrance.
    const room = this.world.deepRoomAt(this.player.position);
    if (room >= 0) {
      this.player.position.set(...this.world.deepEntry(room));
      this.player.velocity.set(0, 0, 0); this.player.cooldown = 0;
      this.gravityMode = 0; this.player.gravity.set(0, -1, 0); this.player.up.copy(UP);
      this.player.grounded = false; this.pitch = this.roll = 0;
      this.held = null; this.heldAcross = null;
      this.portals.clear();
      this.projectiles.forEach(p => { p.active = false; if (p.shot) { this.effects.endShot(p.shot); p.shot = null; } });
      for (const cube of this.world.cubes) if (cube.stage === 100 + room) {
        cube.position.copy(cube.spawn); cube.velocity.set(0, 0, 0); cube.rotation.identity(); cube.cooldown = 0;
      }
      this.respawnCooldown = 1.5;
      this.notify('Chamber reset. Same room, fresh angle.');
      this.updateCamera(0); this.updateAim(); this.emitSnapshot(); this.save();
      return;
    }
    const chapter = CHAPTERS[Math.min(this.stage, CHAPTERS.length - 1)];
    this.player.position.set(...(this.stage >= CHAPTERS.length ? [0, 0.95, 22] as Vec3 : chapter.checkpoint));
    this.player.velocity.set(0, 0, 0); this.player.gravity.set(0, -1, 0); this.player.up.copy(UP); this.player.cooldown = 0;
    this.gravityMode = 0;
    this.player.grounded = false; this.yaw = this.stage >= CHAPTERS.length ? 0 : chapter.yaw; this.pitch = this.roll = 0;
    this.held = null;
    this.heldAcross = null;
    this.clearPortalThreshold(0); this.clearPortalThreshold(1);
    this.portals.clear();
    this.projectiles.forEach(p => {
      p.active = false;
      if (p.shot) { this.effects.endShot(p.shot); p.shot = null; }
    });
    for (const cube of this.world.cubes) if (cube.stage === this.stage) {
      cube.position.copy(cube.spawn); cube.velocity.set(0, 0, 0); cube.rotation.identity(); cube.cooldown = 0;
    }
    for (const interaction of this.world.interactions) if (interaction.hatch && interaction.stage === this.stage) {
      interaction.hatch.enabled = true; interaction.hatch.mesh.visible = true;
    }
    this.respawnCooldown = 1.5;
    this.notify('Checkpoint restored. A fresh angle on the same problem.');
    this.updateCamera(0); this.updateAim(); this.emitSnapshot(); this.save();
  }

  private say(text: string) {
    this.subtitle = text;
    this.subtitleUntil = this.time + Math.max(10, Math.min(22, text.split(' ').length * 0.43));
    this.audio.speak(text);
  }

  notify(text: string) { this.toast = text; this.toastUntil = this.time + 5; }

  private emitSnapshot() {
    let prompt = this.currentInteraction?.label || (this.aimedCube && !this.held ? 'Pick up field core' : this.held ? 'Set down field core' : '');
    if (this.currentInteraction?.kind === 'relay' && this.stage > this.currentInteraction.stage) prompt = 'Relay calibrated';
    const canPlace = this.aimPlaceable;
    this.callbacks.snapshot({
      stage: this.stage, position: this.player.position.toArray() as Vec3, yaw: this.yaw, prompt,
      canPlace, portals: this.portals.portals.map(p => p.active) as [boolean, boolean],
      held: !!this.held, subtitle: this.time < this.subtitleUntil ? this.subtitle : '', toast: this.time < this.toastUntil ? this.toast : '',
      notes: [...this.notes], speed: this.player.velocity.length(), playtime: this.playtime,
      pointerLocked: document.pointerLockElement === this.renderer.domElement,
      gravityUnlocked: this.gravityUnlocked, gravityMode: this.gravityMode, fps: this.fps,
      wheelOpen: this.wheelOpen, wheelHover: this.wheelHover,
      gravityRelative: this.wheelOpen ? this.gravityRelative() : ['', '', '', '', '', ''],
    });
  }

  save() {
    if (this.destroyed) return;
    const save: SaveData = {
      version: 2, stage: this.stage, position: this.player.position.toArray() as Vec3, yaw: this.yaw, pitch: this.pitch,
      notes: [...this.notes], playtime: this.playtime, savedAt: Date.now(),
      gravityUnlocked: this.gravityUnlocked, gravityMode: this.gravityMode,
      cubes: this.world.cubes.map(c => ({ id: c.id, position: c.position.toArray() as Vec3, rotation: c.rotation.toArray() as [number, number, number, number] })),
    };
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); this.callbacks.saved(save); }
    catch { this.notify('Storage is unavailable. This session cannot be saved on this device.'); }
  }

  private load(save: SaveData) {
    this.stage = save.stage;
    this.playtime = save.playtime;
    this.notes = [...new Set(['orientation', ...save.notes])];
    this.gravityUnlocked = save.gravityUnlocked;
    this.gravityMode = this.gravityUnlocked ? save.gravityMode : 0;
    this.player.gravity.set(...GRAVITY_DIRECTIONS[this.gravityMode]);
    this.player.up.copy(this.gravityUnlocked ? this.player.gravity.clone().negate() : UP);
    this.player.position.set(...save.position);
    this.yaw = T.MathUtils.euclideanModulo(save.yaw, Math.PI * 2);
    this.pitch = save.pitch;
    for (const cube of this.world.cubes) {
      const saved = save.cubes.find(c => c.id === cube.id);
      if (saved) { cube.position.set(...saved.position); cube.rotation.set(...saved.rotation).normalize(); cube.group!.position.copy(cube.position); }
    }
    // Reload only grounded checkpoints; a mid-flight save must not lose its launch velocity.
    const half = this.halfExtents(this.player);
    const gravityAxis: 'x' | 'y' | 'z' = Math.abs(this.player.gravity.x) > 0.95 ? 'x' : Math.abs(this.player.gravity.y) > 0.95 ? 'y' : 'z';
    const gravitySign = this.player.gravity[gravityAxis];
    const tangentAxes = (['x', 'y', 'z'] as const).filter(axis => axis !== gravityAxis);
    const support = this.world.nearbyColliders(this.player.position, half, 0.4).some(c => c.enabled &&
      tangentAxes.every(axis => this.player.position[axis] + half[axis] > c.box.min[axis] && this.player.position[axis] - half[axis] < c.box.max[axis]) &&
      Math.abs(this.player.position[gravityAxis] - (gravitySign > 0 ? c.box.min[gravityAxis] - half[gravityAxis] : c.box.max[gravityAxis] + half[gravityAxis])) < 0.18);
    const blocked = this.world.colliders.some(c => c.enabled && this.overlaps(this.player.position, half, c.box));
    if (!support || blocked) {
      const chapter = CHAPTERS[Math.min(this.stage, CHAPTERS.length - 1)];
      this.gravityMode = 0; this.player.gravity.set(0, -1, 0); this.player.up.copy(UP);
      this.player.position.set(...(this.stage >= CHAPTERS.length ? [0, 0.95, 22] as Vec3 : chapter.checkpoint));
      this.yaw = this.stage >= CHAPTERS.length ? 0 : chapter.yaw; this.pitch = 0;
    }
  }

  dispose() {
    if (this.destroyed) return;
    this.save(); this.active = false; this.destroyed = true;
    this.abort.abort(); this.resizeObserver.disconnect();
    if (document.pointerLockElement === this.renderer.domElement) document.exitPointerLock();
    this.renderer.setAnimationLoop(null);
    this.portals.dispose();
    this.device.dispose();
    this.robot.dispose();
    this.effects.dispose();
    this.world.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}