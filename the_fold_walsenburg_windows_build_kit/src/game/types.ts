import type { Box3, Group, Mesh, Quaternion, Vector3 } from 'three';

export type Vec3 = [number, number, number];

export type Quality =
  | 'lowest'
  | 'wimpy'
  | 'low'
  | 'medium'
  | 'high'
  | 'higher'
  | 'highest'
  | 'ultra'
  | 'do you want your pc to explode';

export const ALL_QUALITIES: Quality[] = [
  'lowest',
  'wimpy',
  'low',
  'medium',
  'high',
  'higher',
  'highest',
  'ultra',
  'do you want your pc to explode',
];

export const QUALITY_CONFIG: Record<
  Quality,
  {
    label: string;
    sublabel: string;
    shadows: boolean;
    shadowMapSize: number;
    portalTargetMax: number;
    portalRecursion: number;
    pixelRatioLimit: number;
  }
> = {
  lowest: {
    label: 'Lowest',
    sublabel: 'Bare-bones performance, flat ambient light, 1-step portals.',
    shadows: false,
    shadowMapSize: 512,
    portalTargetMax: 256,
    portalRecursion: 1,
    pixelRatioLimit: 0.75,
  },
  wimpy: {
    label: 'Wimpy',
    sublabel: 'Ultra-lightweight for older laptops or battery saving.',
    shadows: false,
    shadowMapSize: 512,
    portalTargetMax: 320,
    portalRecursion: 1,
    pixelRatioLimit: 0.85,
  },
  low: {
    label: 'Low',
    sublabel: 'Clean simplified visuals with 2-step portal corridors.',
    shadows: false,
    shadowMapSize: 512,
    portalTargetMax: 384,
    portalRecursion: 2,
    pixelRatioLimit: 1.0,
  },
  medium: {
    label: 'Medium',
    sublabel: 'Smooth framerate, balanced resolution, and 2-step portals.',
    shadows: false,
    shadowMapSize: 1024,
    portalTargetMax: 480,
    portalRecursion: 2,
    pixelRatioLimit: 1.15,
  },
  high: {
    label: 'High',
    sublabel: 'Dynamic sun shadows enabled, 3-step recursive portals.',
    shadows: true,
    shadowMapSize: 1024,
    portalTargetMax: 640,
    portalRecursion: 3,
    pixelRatioLimit: 1.35,
  },
  higher: {
    label: 'Higher',
    sublabel: 'Crisp 2K shadow mapping and sharp 3-step portal views.',
    shadows: true,
    shadowMapSize: 2048,
    portalTargetMax: 768,
    portalRecursion: 3,
    pixelRatioLimit: 1.5,
  },
  highest: {
    label: 'Highest',
    sublabel: 'Full fidelity, 2K shadows, deep 4-step recursive portals.',
    shadows: true,
    shadowMapSize: 2048,
    portalTargetMax: 896,
    portalRecursion: 4,
    pixelRatioLimit: 1.75,
  },
  ultra: {
    label: 'Ultra',
    sublabel: '4K shadow map, 4-step deep portals, native display resolution.',
    shadows: true,
    shadowMapSize: 4096,
    portalTargetMax: 1024,
    portalRecursion: 4,
    pixelRatioLimit: 2.0,
  },
  'do you want your pc to explode': {
    label: 'Do You Want Your PC to Explode',
    sublabel: 'Extreme 5-step portal recursion, 4K shadows, 2.5x supersampling!',
    shadows: true,
    shadowMapSize: 4096,
    portalTargetMax: 1280,
    portalRecursion: 5,
    pixelRatioLimit: 2.5,
  },
};

export interface Settings {
  sensitivity: number;
  invertY: boolean;
  master: number;
  music: number;
  effects: number;
  muted: boolean;
  quality: Quality;
  resolution: number;
  reducedMotion: boolean;
  subtitles: boolean;
  narration: boolean;
  highContrast: boolean;
  fov: number;
}

export const DEFAULT_SETTINGS: Settings = {
  sensitivity: 1,
  invertY: false,
  master: 70,
  music: 35,
  effects: 75,
  muted: false,
  quality: 'medium',
  resolution: 1.0,
  reducedMotion: false,
  subtitles: true,
  narration: false,
  highContrast: false,
  fov: 76,
};

export interface SaveData {
  version: 1 | 2;
  stage: number;
  position: Vec3;
  yaw: number;
  pitch: number;
  notes: string[];
  cubes: { id: string; position: Vec3; rotation: [number, number, number, number] }[];
  playtime: number;
  savedAt: number;
  gravityUnlocked: boolean;
  gravityMode: number;
}

export const SAVE_KEY = 'the-fold.walsenburg.save.v1';
export const SETTINGS_KEY = 'the-fold.walsenburg.settings.v1';

const finiteVector = (v: unknown): v is Vec3 => Array.isArray(v) && v.length === 3 && v.every(n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) < 2000);

export function readSave(): SaveData | null {
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
    if (!s || ![1, 2].includes(s.version) || !Number.isInteger(s.stage) || s.stage < 0 || s.stage > (s.version === 1 ? 6 : 7) || !finiteVector(s.position) || !Number.isFinite(s.yaw)) return null;
    const migratedStage = s.version === 1 && s.stage === 6 ? 7 : s.stage;
    return {
      ...s,
      stage: migratedStage,
      pitch: Number.isFinite(s.pitch) ? Math.max(-1.45, Math.min(1.45, s.pitch)) : 0,
      notes: Array.isArray(s.notes) ? s.notes.filter((v: unknown) => typeof v === 'string') : [],
      playtime: Number.isFinite(s.playtime) ? Math.max(0, s.playtime) : 0,
      gravityUnlocked: s.gravityUnlocked === true || (s.version === 1 && migratedStage >= 7),
      gravityMode: Number.isInteger(s.gravityMode) && s.gravityMode >= 0 && s.gravityMode < 6 ? s.gravityMode : 0,
      cubes: Array.isArray(s.cubes) ? s.cubes.filter((c: { id: unknown; position: unknown; rotation: unknown }) => typeof c.id === 'string' && finiteVector(c.position) && Array.isArray(c.rotation) && c.rotation.length === 4 && c.rotation.every(Number.isFinite)) : [],
    };
  } catch { return null; }
}

export function readSettings(): Settings {
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    const settings = { ...DEFAULT_SETTINGS };
    for (const key of ['invertY', 'muted', 'reducedMotion', 'subtitles', 'narration', 'highContrast'] as const) {
      if (typeof s[key] === 'boolean') settings[key] = s[key];
    }
    for (const key of ['master', 'music', 'effects'] as const) {
      if (Number.isFinite(s[key])) settings[key] = Math.max(0, Math.min(100, s[key]));
    }
    if (Number.isFinite(s.sensitivity)) settings.sensitivity = Math.max(0.2, Math.min(2.5, s.sensitivity));
    if (Number.isFinite(s.fov)) settings.fov = Math.max(60, Math.min(100, s.fov));
    if (s.quality === 'balanced') settings.quality = 'medium';
    else if (ALL_QUALITIES.includes(s.quality)) settings.quality = s.quality;
    if ([0.5, 0.75, 1].includes(s.resolution)) settings.resolution = s.resolution;
    return settings;
  } catch { return { ...DEFAULT_SETTINGS }; }
}

export interface Chapter {
  name: string;
  place: string;
  objective: string;
  detail: string;
  checkpoint: Vec3;
  yaw: number;
  location: [number, number];
  hints: string[];
  introduction: string;
  completion: string;
}

export const CHAPTERS: Chapter[] = [
  {
    name: 'The Discovery Lab', place: 'MAIN STREET FIELD STATION',
    objective: 'A door is only one possibility.',
    detail: 'Bring the field core across the fence and onto the floor switch.',
    checkpoint: [-22, 1.08, 23], yaw: 0.73, location: [-23, 18],
    hints: [
      'Large, solid walls and floors can hold a fold. Aim for a clear, flat patch.',
      'Place one fold on the brick panel and its partner on the pale surface beyond the fence. You can fire through the gaps.',
      'Walk through, pick up the core with E, and bring it back through. Set it on the illuminated floor switch beside the exit.',
    ],
    introduction: 'Hello? A person. Excellent. I am NORA, the local research assistant. The door is locked, but we have recently made some very encouraging mistakes with walls.',
    completion: 'A perfectly ordinary shortcut through two entirely different places. Please do not tell the building inspector. Look for a broad, flat, solid surface to place your next fold. The momentum chamber is east of Main Street.',
  },
  {
    name: 'The Momentum Chamber', place: 'EASTERN SERVICE ROAD',
    objective: 'Take the long way down.',
    detail: 'Use a fall to reach the elevated receiver. Activate it with E.',
    checkpoint: [27, 0.96, -25], yaw: -1.25, location: [42, -38],
    hints: [
      'The device changes where you are going, not how fast you get there.',
      'Link the floor panel beneath the drop hatch to the high panel on the north wall. Then climb the stairs.',
      'Stand in the center of the grated hatch and press E. Let gravity do the work, then activate the receiver on the landing ledge.',
    ],
    introduction: 'The chamber is east of town. Our last researcher called this a leap of faith. I prefer a controlled disagreement with distance.',
    completion: 'Momentum preserved. Dignity: difficult to measure. There is a relay above the Mesa Theater back on Main Street. Its stairs are, regrettably, theoretical.',
  },
  {
    name: 'The Downtown Transit Lab', place: 'MESA THEATER ROOFTOP',
    objective: 'Find a different way up.',
    detail: 'Connect Main Street to the theater roof and restore the transit relay.',
    checkpoint: [0, 0.94, 13], yaw: -0.8, location: [22, 0],
    hints: [
      'The Mesa Theater is the rust-red building on the east side of Main Street.',
      'Look up. There is a ceramic anchor on the rooftop enclosure, and another at street level.',
      'Place a fold on each anchor, step through the street-level fold, and use the glowing rooftop console.',
    ],
    introduction: 'Walsenburg once connected people by rail. We thought we could improve the commute. In hindsight, the rails were doing important work.',
    completion: 'The transit relay is listening. Follow the west road toward Lathrop. And no, the lake is not a portal. We did test that.',
  },
  {
    name: 'The Lakeshore Experiment', place: 'LATHROP FIELD RESERVE',
    objective: 'Bring the shore a little closer.',
    detail: 'Transport the shore core to the switch on the research island.',
    checkpoint: [-42, 0.95, -26], yaw: 0.8, location: [-74, -49],
    hints: [
      'There is no need to swim. The island has a pale anchor facing the shore.',
      'Link the shore anchor to the island anchor. The core waits beside the dock.',
      'Carry the core through your fold and place it on the island switch. The water will return you to your checkpoint if you fall in.',
    ],
    introduction: 'The lake is unusually calm. I am told that is pleasant. Most of my experience with calm things involves waiting for them to explode.',
    completion: 'Lakeshore calibration complete. The Spanish Peaks array is north of town. You cannot miss the unnecessarily large antenna.',
  },
  {
    name: 'The Spanish Peaks Array', place: 'NORTH RIDGE OVERLOOK',
    objective: 'Two weights. One balance.',
    detail: 'Power both array switches, then activate the ridge console.',
    checkpoint: [-12, 0.95, -77], yaw: 0, location: [-15, -99],
    hints: [
      'Both floor switches need to remain pressed when you use the console.',
      'One core is on the main deck. The second is on the high service ledge, beside a portal anchor.',
      'Use the deck and ledge anchors to retrieve the second core. Leave one core on each switch, then use the console at the back of the array.',
    ],
    introduction: 'The peaks have been here a very long time. It is reassuring to work beside something that has never once requested a firmware update.',
    completion: 'The array is balanced. Its north relay has activated the mountain observatory. The outer field-lab shutter is already open; the upper room is beyond its second door.',
  },
  {
    name: 'The Inversion Laboratory', place: 'SPANISH PEAKS / INVERSION LAB',
    objective: 'Find out what the mountain is keeping.',
    detail: 'Follow the north-ridge path, enter the field lab, and retrieve the Vector Shifter.',
    checkpoint: [68, 0.96, -157], yaw: 0, location: [68, -178],
    hints: [
      'The mountain pass begins beyond the Spanish Peaks array. Follow the green-brown marker lights north.',
      'The entrance is cut into the rock face, and the outer shutter is already open. The upper observatory is beyond its second field door.',
      'The Vector Shifter is on its instrument pedestal. Find the upper receiver in the observatory and use gravity to reach it.',
    ],
    introduction: 'This facility predates the array. The rock is a remarkably effective soundproofing material. It also makes an alarming sound when you drill into it.',
    completion: 'Vector Shifter calibrated. The Fold Engine is southeast of the ridge. Hold G to open the gravity wheel and choose a direction; pick DOWN to return to ordinary footing.',
  },
  {
    name: 'The Fold Engine', place: 'SUBSTATION ZERO',
    objective: 'Put the world back together.',
    detail: 'Carry the final core through a momentum fold. Power the engine and stabilize it.',
    checkpoint: [35, 0.95, -76], yaw: -1.3, location: [54, -92],
    hints: [
      'This engine needs a core on its elevated switch. Walking through a fold will not provide enough speed.',
      'Connect the anchor under the drop hatch to the high north-wall anchor. Climb up and pick up the final core.',
      'Stand on the center of the hatch. While holding the core, press E near the hatch control to release it. Carry the core through the fall, set it on the landing switch, then use the stabilization console.',
    ],
    introduction: 'I should mention that I am rather fond of this town. There are very few places where being slightly impossible barely makes the local paper.',
    completion: 'There. Main Street leads to Main Street. The mountains are back to being far away. And you are exactly where you should be. Thank you. Shall we keep the device? Just in case.',
  },
];

export const RESEARCH_NOTES = [
  { id: 'orientation', title: 'A note on distance', place: 'NORA / FIELD ORIENTATION', text: 'A fold joins two compatible surfaces. Blue is the first endpoint, orange the second. Step into either and leave through the other. Your momentum comes with you. Please account for it.' },
  { id: 'coffee', title: 'The coffee incident', place: 'MAIN STREET FIELD STATION', text: 'Test 014: Connected the break room to the ridge station. Travel time: negligible. Coffee temperature: unchanged. Number of researchers who walked into the same doorframe twice: three. Promising.' },
  { id: 'rail', title: 'A town built on connections', place: 'MESA THEATER / MAINTENANCE', text: 'The old rail routes made this place a crossroads. Our proposal was modest: remove the distance, keep the destination. Somewhere along the way, we forgot to ask the destination.' },
  { id: 'lake', title: 'Still water', place: 'LATHROP FIELD RESERVE', text: 'The reflected mountains arrived 0.4 seconds before the actual mountains this morning. NORA insists this is an improvement. Suspended all experiments involving mirrors until further notice.' },
  { id: 'peaks', title: 'Two peaks, two anchors', place: 'SPANISH PEAKS ARRAY', text: 'The array does not bend the mountains. It uses them as a reference. The land remembers where it belongs, even when the rooms beneath it forget. Balance the weights. Let the landscape do the rest.' },
  { id: 'gravity', title: 'The Vector Shifter', place: 'SPANISH PEAKS / INVERSION LAB', text: 'Six directions, one very small control. Direction is the important part: momentum is not erased when gravity changes. Overhead surfaces still need to hold you. Please test this safely. There are mats in the other room. We did not find the mats.' },
  { id: 'pueblo', title: 'Five mountains wide', place: 'PUEBLO / CIVIC HALL', text: 'Walsenburg has one Main Street. Pueblo has a grid of them, a river that declines to take the direct route, and a steelworks that has outlived three separate opinions about its future. Every broad wall out here will hold a fold, which the city has opinions about. Mind the channel. The water is colder than the paperwork.' },
  { id: 'deep', title: 'All the way down', place: 'THE DEEP FOLD / CHAMBER 16', text: 'Fifteen chambers, carved under Walsenburg while the town upstairs argued about parking. White panels hold folds; dark metal does not. Glass stops feet, not geometry. The goo is not load-bearing, and the lift is not optional. If you are reading this, you solved every one of them. NORA is choosing to be impressed out loud.' },
  { id: 'trinidad', title: 'Brick, neon, and one enormous mesa', place: 'TRINIDAD / CORAZON PLAZA', text: 'South on the old trail: a brick downtown that remembers the coal trains, a theater blade sign visible from two counties, boxcars parked like punctuation, and Fisher\u2019s Peak looming over all of it. The lake is real water. The balloons are just balloons. NORA checked twice, which is exactly as reassuring as it sounds.' },
];

export interface Collider {
  id: number;
  box: Box3;
  mesh: Mesh;
  enabled: boolean;
}

export interface PortalSurface {
  id: string;
  mesh: Mesh;
  position: Vector3;
  quaternion: Quaternion;
  normal: Vector3;
  width: number;
  height: number;
  colliders: number[];
}

export interface Body {
  id: string;
  position: Vector3;
  velocity: Vector3;
  half: Vector3;
  up: Vector3;
  gravity: Vector3;
  rotation: Quaternion;
  grounded: boolean;
  cooldown: number;
  group?: Group;
  spawn: Vector3;
  stage: number;
}

export interface FloorSwitch {
  id: string;
  position: Vector3;
  mesh: Mesh;
  light: Mesh;
  active: boolean;
}

export interface Door {
  mesh: Mesh;
  collider: Collider;
  homeY: number;
  switchIds: string[];
  minimumStage?: number;
  travel?: number;
  open: number;
}

export interface Interaction {
  id: string;
  kind: 'relay' | 'hatch' | 'note' | 'gravity' | 'door' | 'lift';
  /** Where a lift takes you. */
  target?: Vec3;
  position: Vector3;
  stage: number;
  label: string;
  mesh: Mesh;
  requiredSwitches?: string[];
  requiredGravity?: number;
  door?: Door;
  hatch?: Collider;
  used?: boolean;
}

export interface GameSnapshot {
  stage: number;
  position: Vec3;
  yaw: number;
  prompt: string;
  canPlace: boolean;
  portals: [boolean, boolean];
  held: boolean;
  subtitle: string;
  toast: string;
  notes: string[];
  speed: number;
  playtime: number;
  pointerLocked: boolean;
  gravityUnlocked: boolean;
  gravityMode: number;
  fps: number;
  /** The gravity wheel: whether it is open, which wheel slot the cursor points at (-1 for none), and
   *  where each gravity mode sits relative to your current view (AHEAD, BELOW, LEFT...). */
  wheelOpen: boolean;
  wheelHover: number;
  gravityRelative: string[];
}

export const INITIAL_SNAPSHOT: GameSnapshot = {
  stage: 0, position: [-22, 1.08, 23], yaw: 0.73, prompt: '', canPlace: false,
  portals: [false, false], held: false, subtitle: '', toast: '', notes: ['orientation'],
  speed: 0, playtime: 0, pointerLocked: false, gravityUnlocked: false, gravityMode: 0, fps: 60,
  wheelOpen: false, wheelHover: -1, gravityRelative: ['', '', '', '', '', ''],
};