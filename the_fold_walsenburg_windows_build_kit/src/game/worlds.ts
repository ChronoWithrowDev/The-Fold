import type { SaveData, Vec3 } from './types';
import { SAVE_KEY } from './types';

export interface WorldProfile {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  data: SaveData;
}

export const WORLDS_LIST_KEY = 'the-fold.walsenburg.worlds.v2';
export const CURRENT_WORLD_ID_KEY = 'the-fold.walsenburg.current-world-id.v2';

const finiteVector = (v: unknown): v is Vec3 =>
  Array.isArray(v) && v.length === 3 && v.every(n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) < 2000);

function sanitizeSaveData(s: unknown): SaveData | null {
  if (!s || typeof s !== 'object') return null;
  const raw = s as Record<string, unknown>;
  const version = raw.version === 1 || raw.version === 2 ? raw.version : 2;
  const stage = typeof raw.stage === 'number' && Number.isInteger(raw.stage) ? Math.max(0, Math.min(7, raw.stage)) : 0;
  if (!finiteVector(raw.position) || typeof raw.yaw !== 'number' || !Number.isFinite(raw.yaw)) return null;

  return {
    version: version as 1 | 2,
    stage,
    position: raw.position,
    yaw: raw.yaw,
    pitch: typeof raw.pitch === 'number' && Number.isFinite(raw.pitch) ? Math.max(-1.45, Math.min(1.45, raw.pitch)) : 0,
    notes: Array.isArray(raw.notes) ? raw.notes.filter((v: unknown): v is string => typeof v === 'string') : [],
    playtime: typeof raw.playtime === 'number' && Number.isFinite(raw.playtime) ? Math.max(0, raw.playtime) : 0,
    savedAt: typeof raw.savedAt === 'number' && Number.isFinite(raw.savedAt) ? raw.savedAt : Date.now(),
    gravityUnlocked: raw.gravityUnlocked === true,
    gravityMode: typeof raw.gravityMode === 'number' && Number.isInteger(raw.gravityMode) && raw.gravityMode >= 0 && raw.gravityMode < 6 ? raw.gravityMode : 0,
    cubes: Array.isArray(raw.cubes)
      ? raw.cubes.filter(
          (c: unknown): c is { id: string; position: Vec3; rotation: [number, number, number, number] } => {
            if (!c || typeof c !== 'object') return false;
            const obj = c as Record<string, unknown>;
            return (
              typeof obj.id === 'string' &&
              finiteVector(obj.position) &&
              Array.isArray(obj.rotation) &&
              obj.rotation.length === 4 &&
              obj.rotation.every(n => typeof n === 'number' && Number.isFinite(n))
            );
          }
        )
      : [],
  };
}

export function listWorlds(): WorldProfile[] {
  try {
    const raw = localStorage.getItem(WORLDS_LIST_KEY);
    if (!raw) {
      // Migrate legacy single-save if present
      const legacyRaw = localStorage.getItem(SAVE_KEY);
      if (legacyRaw) {
        const parsed = JSON.parse(legacyRaw);
        const valid = sanitizeSaveData(parsed);
        if (valid) {
          const initialWorld: WorldProfile = {
            id: 'world-default',
            name: 'Original Journey',
            createdAt: valid.savedAt || Date.now(),
            updatedAt: valid.savedAt || Date.now(),
            data: valid,
          };
          saveWorld(initialWorld);
          setActiveWorldId(initialWorld.id);
          return [initialWorld];
        }
      }
      return [];
    }
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    return list
      .map((item: unknown) => {
        if (!item || typeof item !== 'object') return null;
        const entry = item as Record<string, unknown>;
        const data = sanitizeSaveData(entry.data);
        if (!data || typeof entry.id !== 'string') return null;
        return {
          id: entry.id,
          name: typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : 'Unnamed World',
          createdAt: typeof entry.createdAt === 'number' ? entry.createdAt : Date.now(),
          updatedAt: typeof entry.updatedAt === 'number' ? entry.updatedAt : Date.now(),
          data,
        };
      })
      .filter((w): w is WorldProfile => w !== null)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

export function getActiveWorldId(): string | null {
  try {
    return localStorage.getItem(CURRENT_WORLD_ID_KEY) || null;
  } catch {
    return null;
  }
}

export function setActiveWorldId(id: string | null): void {
  try {
    if (id) localStorage.setItem(CURRENT_WORLD_ID_KEY, id);
    else localStorage.removeItem(CURRENT_WORLD_ID_KEY);
  } catch {
    // Ignore quota errors
  }
}

export function getWorld(id: string): WorldProfile | null {
  const worlds = listWorlds();
  return worlds.find(w => w.id === id) || null;
}

export function saveWorld(world: WorldProfile): void {
  try {
    const worlds = listWorlds();
    const index = worlds.findIndex(w => w.id === world.id);
    const updated = {
      ...world,
      updatedAt: Date.now(),
    };
    if (index >= 0) {
      worlds[index] = updated;
    } else {
      worlds.unshift(updated);
    }
    localStorage.setItem(WORLDS_LIST_KEY, JSON.stringify(worlds));
    // Also update legacy save for backward compatibility
    localStorage.setItem(SAVE_KEY, JSON.stringify(updated.data));
  } catch (err) {
    console.warn('Could not save world to localStorage', err);
  }
}

export function createNewWorldProfile(name?: string, initialData?: SaveData | null): WorldProfile {
  const id = `world-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const defaultData: SaveData = {
    version: 2,
    stage: 0,
    position: [-22, 1.08, 23],
    yaw: 0.73,
    pitch: 0,
    notes: ['orientation'],
    cubes: [],
    playtime: 0,
    savedAt: Date.now(),
    gravityUnlocked: false,
    gravityMode: 0,
  };

  const profile: WorldProfile = {
    id,
    name: name && name.trim() ? name.trim() : `Walsenburg ${new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    data: initialData ? { ...initialData, savedAt: Date.now() } : defaultData,
  };
  saveWorld(profile);
  setActiveWorldId(profile.id);
  return profile;
}

export function deleteWorld(id: string): void {
  try {
    const worlds = listWorlds().filter(w => w.id !== id);
    localStorage.setItem(WORLDS_LIST_KEY, JSON.stringify(worlds));
    if (getActiveWorldId() === id) {
      setActiveWorldId(worlds.length > 0 ? worlds[0].id : null);
    }
  } catch {
    // Ignore error
  }
}

export function exportWorldJson(world: WorldProfile): string {
  return JSON.stringify(world, null, 2);
}

export function downloadWorldFile(world: WorldProfile): void {
  try {
    const json = exportWorldJson(world);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${world.name.toLowerCase().replace(/[^a-z0-9_-]/g, '_')}_save.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error('Failed to download world file', err);
  }
}

export function importWorldJson(jsonString: string): WorldProfile | null {
  try {
    const parsed = JSON.parse(jsonString);
    if (!parsed || typeof parsed !== 'object') return null;

    let data: SaveData | null = null;
    let name = 'Imported World';

    if ('data' in parsed) {
      data = sanitizeSaveData(parsed.data);
      if (typeof parsed.name === 'string' && parsed.name.trim()) {
        name = parsed.name.trim();
      }
    } else {
      // Direct SaveData export
      data = sanitizeSaveData(parsed);
    }

    if (!data) return null;

    return createNewWorldProfile(`Import: ${name}`, data);
  } catch {
    return null;
  }
}
