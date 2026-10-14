import { useEffect, useRef, type MutableRefObject } from 'react';
import type { FoldEngine } from '../game/engine';
import type { FoldAudio } from '../game/audio';
import type { GameSnapshot, SaveData, Settings } from '../game/types';

interface Props {
  engineRef: MutableRefObject<FoldEngine | null>;
  settings: Settings;
  audio: FoldAudio;
  initialSave: SaveData | null;
  session: number;
  onReady: () => void;
  onError: (message: string) => void;
  onSnapshot: (snapshot: GameSnapshot) => void;
  onPause: () => void;
  onMap: () => void;
  onWin: () => void;
  onSave: (save: SaveData) => void;
}

export default function GameView(props: Props) {
  const container = useRef<HTMLDivElement>(null);
  const callbacks = useRef(props);
  callbacks.current = props;

  useEffect(() => {
    let cancelled = false;
    let engine: FoldEngine | null = null;
    const initialize = async () => {
      try {
        const { FoldEngine: Engine } = await import('../game/engine');
        await document.fonts.ready;
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        if (cancelled || !container.current) return;
        const p = callbacks.current;
        engine = new Engine(container.current, p.settings, p.audio, p.initialSave, {
          snapshot: snapshot => callbacks.current.onSnapshot(snapshot),
          pause: () => callbacks.current.onPause(),
          map: () => callbacks.current.onMap(),
          win: () => callbacks.current.onWin(),
          saved: save => callbacks.current.onSave(save),
        });
        p.engineRef.current = engine;
        await engine.renderer.compileAsync(engine.scene, engine.camera);
        if (!cancelled) callbacks.current.onReady();
      } catch (error) {
        console.error('The Fold could not initialize', error);
        if (!cancelled) callbacks.current.onError(error instanceof Error ? error.message : 'WebGL 2 is unavailable.');
      }
    };
    void initialize();
    return () => {
      cancelled = true;
      engine?.dispose();
      callbacks.current.engineRef.current = null;
    };
  }, [props.session]);

  return <div ref={container} className="game-world" />;
}