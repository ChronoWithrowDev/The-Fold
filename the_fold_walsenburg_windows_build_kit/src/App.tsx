import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, MotionConfig } from 'framer-motion';
import { FoldMark, Icon, Key } from './components/Icons';
import { Dialog } from './components/Dialog';
import GameView from './components/GameView';
import { FieldMap } from './components/FieldMap';
import { SettingsPanel } from './components/SettingsPanel';
import { Guide, type GuideTab } from './components/Guide';
import { GravityWheel } from './components/GravityWheel';
import { WorldSaveModal } from './components/WorldSaveModal';
import { FoldAudio } from './game/audio';
import type { FoldEngine } from './game/engine';
import { GRAVITY_LABELS } from './game/gravity';
import { CHAPTERS, INITIAL_SNAPSHOT, SAVE_KEY, SETTINGS_KEY, readSave, readSettings, type GameSnapshot, type SaveData } from './game/types';
import { setActiveWorldId, type WorldProfile } from './game/worlds';

type Overlay = 'guide' | 'settings' | 'map' | 'pause' | 'ending' | 'new' | 'worlds' | null;

export default function App() {
  const [settings, setSettings] = useState(readSettings);
  const [savedGame, setSavedGame] = useState(readSave);
  const [scene, setScene] = useState<'title' | 'game'>('title');
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [returnToPause, setReturnToPause] = useState(false);
  const [guideTab, setGuideTab] = useState<GuideTab>('world');
  const [snapshot, setSnapshot] = useState<GameSnapshot>(INITIAL_SNAPSHOT);
  const [session, setSession] = useState({ id: 0, save: null as SaveData | null });
  const [ready, setReady] = useState(false);
  const [entered, setEntered] = useState(false);
  const [error, setError] = useState('');
  const [fullscreen, setFullscreen] = useState(false);
  const [notice, setNotice] = useState('');
  const engineRef = useRef<FoldEngine | null>(null);
  const audioRef = useRef<FoldAudio | null>(null);
  if (!audioRef.current) audioRef.current = new FoldAudio(settings);
  const audio = audioRef.current;
  const chapter = CHAPTERS[Math.min(snapshot.stage, CHAPTERS.length - 1)];

  useEffect(() => {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); }
    catch { setNotice('Local storage is unavailable. Preferences apply to this session only.'); }
    audio.configure(settings);
    engineRef.current?.configure(settings);
  }, [settings, audio]);

  useEffect(() => {
    const changed = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', changed);
    return () => { document.removeEventListener('fullscreenchange', changed); audio.dispose(); };
  }, [audio]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 6500);
    return () => clearTimeout(timer);
  }, [notice]);

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
      else setNotice('Fullscreen is unavailable in this browser. The game still fits your window.');
    } catch { setNotice('This preview does not allow fullscreen. Try opening the game in its own window.'); }
  };

  const openOverlay = (next: Overlay, fromPause = false) => {
    if (scene === 'game') engineRef.current?.pause(false);
    setReturnToPause(fromPause);
    setOverlay(next);
  };
  const openGuide = (tab: GuideTab = 'world', fromPause = false) => { setGuideTab(tab); openOverlay('guide', fromPause); };
  const closeOverlay = () => {
    if (returnToPause) { setOverlay('pause'); setReturnToPause(false); return; }
    setOverlay(null);
    if (scene === 'game' && entered) engineRef.current?.capture();
  };
  const begin = (fresh: boolean) => {
    audio.start(); audio.play('open');
    const save = fresh ? null : savedGame;
    if (fresh) { try { localStorage.removeItem(SAVE_KEY); } catch { /* Session-only play remains available. */ } }
    setSnapshot(save ? { ...INITIAL_SNAPSHOT, stage: save.stage, notes: save.notes, position: save.position } : INITIAL_SNAPSHOT);
    setSession({ id: Date.now(), save });
    setReady(false); setEntered(false); setError(''); setOverlay(null); setReturnToPause(false); setScene('game');
  };
  const enterWorld = () => { setEntered(true); setOverlay(null); setReturnToPause(false); engineRef.current?.capture(); };
  const leave = () => {
    engineRef.current?.pause(false); setSavedGame(readSave());
    setScene('title'); setOverlay(null); setReady(false); setEntered(false); setReturnToPause(false);
  };
  const checkpoint = () => { engineRef.current?.resetCheckpoint(); setOverlay(null); setReturnToPause(false); engineRef.current?.capture(); };
  const handleLoadWorld = (world: WorldProfile) => {
    setActiveWorldId(world.id);
    setSavedGame(world.data);
    setSnapshot({ ...INITIAL_SNAPSHOT, stage: world.data.stage, notes: world.data.notes, position: world.data.position });
    setSession({ id: Date.now(), save: world.data });
    setReady(false);
    setEntered(false);
    setError('');
    setOverlay(null);
    setReturnToPause(false);
    setScene('game');
  };
  const fade = { initial: { opacity: 0, y: settings.reducedMotion ? 0 : 16 }, animate: { opacity: 1, y: 0 } };

  return <MotionConfig reducedMotion={settings.reducedMotion ? 'always' : 'user'}>
    <main className={`fold-app ${settings.highContrast ? 'high-contrast' : ''}`} data-reduced-motion={settings.reducedMotion}>
      <AnimatePresence mode="wait">
        {scene === 'title' ? <motion.section key="title" className="title-screen" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.45 }} aria-label="The Fold, Walsenburg. Main menu">
          <div className="title-art" aria-hidden="true"><img src="./images/walsenburg-dusk.jpg" alt="" /><div className="art-shade" /><div className="art-grain" /></div>
          <motion.header className="title-header" {...fade} transition={{ duration: 0.8, delay: 0.08 }}>
            <a href="#" className="brand-lockup" onClick={event => { event.preventDefault(); setOverlay(null); }} aria-label="The Fold home"><FoldMark size={34} /><span className="brand-type">THE FOLD<small>WALSENBURG</small></span></a>
            <nav className="title-navigation" aria-label="Main menu"><button className="nav-link active" onClick={() => document.getElementById('begin-journey')?.focus()}>The experience</button><button className="nav-link" onClick={() => openOverlay('worlds')}>Saved worlds</button><button className="nav-link" onClick={() => openGuide()}>Field guide</button><button className="nav-link" onClick={() => openOverlay('settings')}>Settings</button></nav>
            <div className="header-tools"><span className="system-status"><i />SYSTEM READY</span><button className={`icon-button ${settings.muted ? 'muted' : ''}`} aria-label={settings.muted ? 'Enable sound' : 'Mute sound'} title={settings.muted ? 'Enable sound' : 'Mute sound'} onClick={() => { audio.start(); setSettings({ ...settings, muted: !settings.muted }); }}><Icon name={settings.muted ? 'volumeOff' : 'volume'} size={18} /></button><button className="icon-button fullscreen-button" aria-label={fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'} title="Toggle fullscreen" onClick={toggleFullscreen}><Icon name="expand" size={18} /></button></div>
          </motion.header>
          <div className="title-composition">
            <motion.div className="title-eyebrow" {...fade} transition={{ duration: 0.8, delay: 0.2 }}><span />AN ORDINARY TOWN. AN IMPOSSIBLE CONNECTION.</motion.div>
            <motion.h1 className="game-title" {...fade} transition={{ duration: 1, delay: 0.3 }}>THE FOLD</motion.h1>
            <motion.div className="title-location" {...fade} transition={{ duration: 0.8, delay: 0.42 }}><span>WALSENBURG</span><i /><span>COLORADO</span></motion.div>
            <motion.div className="title-description" {...fade} transition={{ duration: 0.8, delay: 0.52 }}><h2>Some places are closer than they should be.</h2><p>Step into a quiet Colorado town where distance is broken,<br className="desktop-break" /> and every wall is a possibility.</p></motion.div>
            <motion.div {...fade} transition={{ duration: 0.8, delay: 0.64 }}><div className="title-actions"><button id="begin-journey" className="primary-button journey-button" onClick={() => begin(!savedGame)}><Icon name="play" size={16} /><span>{savedGame ? 'Continue your journey' : 'Begin your journey'}</span><Icon name="arrow" size={19} /></button><button className="guide-button" onClick={() => openOverlay('worlds')}><Icon name="save" size={17} /><span>Saved worlds</span></button><button className="guide-button" onClick={() => openGuide('controls')}><Icon name="book" size={17} /><span>Before you begin</span></button></div><div className="save-caption"><Icon name="save" size={12} /><span>{savedGame ? `CHECKPOINT ${String(Math.min(savedGame.stage + 1, CHAPTERS.length)).padStart(2, '0')} SAVED LOCALLY` : 'YOUR PROGRESS IS SAVED AUTOMATICALLY'}</span>{savedGame && <button onClick={() => openOverlay('new')}>New journey<Icon name="chevron" size={11} /></button>}</div></motion.div>
          </div>
          <motion.div className="title-bottom" {...fade} transition={{ duration: 0.85, delay: 0.8 }}>
            <div className="field-strip"><div className="chapter-intro"><span className="chapter-index">01<span>/</span></span><div><span className="eyebrow">THE DISCOVERY</span><p>It starts with a door.</p></div></div><button className="quick-control" onClick={() => openGuide('controls')}><span className="key-cluster"><Key>W</Key><Key>A</Key><Key>S</Key><Key>D</Key></span><span>Explore</span></button><button className="quick-control" onClick={() => openGuide('controls')}><Icon name="mouse" size={25} /><span>Look around</span></button><button className="quick-control portal-control" onClick={() => openGuide('controls')}><span className="mini-fold mint" /><span className="mini-fold amber" /><span>Bend the rules</span></button><div className="headphones-note"><Icon name="headphones" size={18} /><span>Best experienced<br />with headphones</span></div></div>
            <footer className="title-footer"><span>V0.2 <i /> PLAYABLE PROTOTYPE</span><span className="footer-tagline">A LITTLE CURIOSITY GOES A LONG WAY.</span><button onClick={() => openGuide('about')}>About this build<Icon name="external" size={11} /></button></footer>
          </motion.div>
        </motion.section> : <motion.section key={`game-${session.id}`} className="game-screen" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.35 }} aria-label="The Fold playable world">
          <GameView session={session.id} engineRef={engineRef} settings={settings} audio={audio} initialSave={session.save} onReady={() => setReady(true)} onError={setError} onSnapshot={setSnapshot} onPause={() => { setReturnToPause(false); setOverlay('pause'); }} onMap={() => { setReturnToPause(false); setOverlay('map'); }} onWin={() => setOverlay('ending')} onSave={setSavedGame} />
          {ready && <div className={`game-hud ${overlay || !entered ? 'hud-dimmed' : ''}`}>
            <div className="hud-top"><div className="hud-location"><FoldMark size={27} /><div><span className="eyebrow">{snapshot.stage >= CHAPTERS.length ? 'WALSENBURG / REALITY RESTORED' : `${String(snapshot.stage + 1).padStart(2, '0')} / ${chapter.place}`}</span><h2>{snapshot.stage >= CHAPTERS.length ? 'Welcome home. More or less.' : chapter.objective}</h2></div></div><div className="hud-tools"><span className="hud-fps" aria-label={`${snapshot.fps} frames per second`}><i />{snapshot.fps}<small>FPS</small></span><button className="hud-icon-button" onClick={() => openOverlay('map')} aria-label="Open field map"><Icon name="map" size={19} /><Key>Tab</Key></button><button className="hud-icon-button" onClick={() => openOverlay('pause')} aria-label="Pause game"><Icon name="pause" size={19} /><Key>Esc</Key></button></div></div>
            <div className="hud-compass"><span className="compass-ticks">|<i>|</i>|<i>|</i>|</span><span>{snapshot.stage < CHAPTERS.length ? `${chapter.name.replace('The ', '').toUpperCase()} / ${Math.round(Math.hypot(snapshot.position[0] - chapter.location[0], snapshot.position[2] - chapter.location[1]))} M` : 'ALL SEVEN CONNECTIONS RESTORED'}</span></div>
            {!snapshot.wheelOpen && <div className={`crosshair ${snapshot.canPlace ? 'compatible' : ''}`}><i className="crosshair-a" /><span /><i className="crosshair-b" /></div>}
            <AnimatePresence>{snapshot.wheelOpen && <GravityWheel key="wheel" hover={snapshot.wheelHover} current={snapshot.gravityMode} relative={snapshot.gravityRelative} reducedMotion={settings.reducedMotion} onChoose={mode => engineRef.current?.chooseGravity(mode)} onCancel={() => engineRef.current?.closeGravityWheel(false)} />}</AnimatePresence>
            {snapshot.prompt && <div className="interaction-prompt"><Key>E</Key><span>{snapshot.prompt}</span></div>}
            <AnimatePresence>{snapshot.toast && <motion.div key={snapshot.toast} className="game-toast" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}><span className="toast-dot" />{snapshot.toast}</motion.div>}</AnimatePresence>
            <div className="hud-bottom"><AnimatePresence mode="wait">{snapshot.subtitle && settings.subtitles && <motion.div className="nora-subtitle" key={snapshot.subtitle} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}><div className="nora-label"><span className="voice-wave"><i /><i /><i /><i /><i /></span><span>NORA</span><small>LOCAL RESEARCH ASSISTANT</small></div><p>{snapshot.subtitle}</p></motion.div>}</AnimatePresence><div className="device-status"><span className="eyebrow">F-02 / SPATIAL FIELD DEVICE</span><div className="portal-status-row"><span className={`portal-status mint ${snapshot.portals[0] ? 'linked' : ''}`}><i /><span>01</span><small>{snapshot.portals[0] ? 'ANCHORED' : 'READY'}</small></span><span className="link-line" /><span className={`portal-status amber ${snapshot.portals[1] ? 'linked' : ''}`}><i /><span>02</span><small>{snapshot.portals[1] ? 'ANCHORED' : 'READY'}</small></span></div></div>{snapshot.gravityUnlocked && <div className="gravity-status"><Icon name="compass" size={17} /><span>VECTOR SHIFTER<small>GRAVITY / <strong>{GRAVITY_LABELS[snapshot.gravityMode]}</strong></small></span><Key>G</Key></div>}</div>
            <div className="game-control-footer"><span><Key>E</Key>Interact</span><span><Key>R</Key>Checkpoint</span><span><Key>1</Key><Key>2</Key>Place folds</span>{snapshot.gravityUnlocked && <span><Key>G</Key>Gravity</span>}<span className="hud-objective-hint"><Key>Tab</Key>Map & hints</span></div>
            <div className="touch-controls"><div className="touch-dpad">{[{ key: 'W', x: 0, y: -1 }, { key: 'A', x: -1, y: 0 }, { key: 'S', x: 0, y: 1 }, { key: 'D', x: 1, y: 0 }].map(direction => <button key={direction.key} className={`touch-${direction.key}`} aria-label={`Move ${direction.key}`} onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); engineRef.current?.setTouchMovement(direction.x, direction.y); }} onPointerUp={() => engineRef.current?.setTouchMovement(0, 0)} onPointerCancel={() => engineRef.current?.setTouchMovement(0, 0)}>{direction.key}</button>)}</div><div className="touch-actions"><button className="touch-mint" onClick={() => engineRef.current?.fire(0)}>01</button><button className="touch-amber" onClick={() => engineRef.current?.fire(1)}>02</button><button onClick={() => engineRef.current?.jump()}>Jump</button><button onClick={() => engineRef.current?.interact()}>E / Use</button>{snapshot.gravityUnlocked && <button className="touch-gravity" onClick={() => engineRef.current?.openGravityWheel()}>{GRAVITY_LABELS[snapshot.gravityMode]}</button>}</div></div>
          </div>}
          {!ready && !error && <div className="loading-screen"><FoldMark size={46} /><span className="eyebrow">THE FOLD / WALSENBURG</span><h2>Making a few<br />impossible connections.</h2><div className="loading-progress"><span /></div><span className="loading-label">PREPARING YOUR FIELD STATION</span></div>}
          {error && <div className="capture-screen"><div className="capture-content"><Icon name="info" size={30} /><span className="eyebrow">A SMALL TECHNICAL DETOUR</span><h2>The world could not open.</h2><p>This game needs WebGL 2 and hardware acceleration. Try a recent version of Chrome or Edge.</p><p className="error-detail">{error}</p><button className="primary-button" onClick={() => begin(!savedGame)}>Try again<Icon name="reset" size={17} /></button><button className="text-button" onClick={leave}>Return to the title</button></div></div>}
          {ready && !entered && !error && <div className="capture-screen"><motion.div className="capture-content" {...fade}><FoldMark size={42} /><span className="eyebrow">YOUR FIELD KIT IS READY</span><h2>The door is locked.<br />The world isn't.</h2><p>{chapter.detail} Look for broad, flat, solid surfaces for your folds. NORA will take it from there.</p><button className="primary-button" onClick={enterWorld}>Enter Walsenburg<Icon name="arrow" size={19} /></button><span className="capture-note">WASD TO MOVE / MOUSE TO LOOK / ESC TO PAUSE</span><button className="text-button" onClick={leave}>Back to the title</button></motion.div></div>}
        </motion.section>}
      </AnimatePresence>
      <AnimatePresence>
        {overlay && <Dialog key={overlay} label={overlay === 'settings' ? 'Settings' : overlay === 'map' ? 'Field map' : overlay === 'guide' ? 'Field guide' : overlay === 'worlds' ? 'Saved Worlds' : overlay === 'ending' ? 'Journey complete' : overlay === 'new' ? 'Start a new journey' : 'Game paused'} onClose={closeOverlay} reducedMotion={settings.reducedMotion} className={overlay === 'pause' || overlay === 'new' ? 'compact-dialog' : overlay === 'ending' ? 'ending-dialog' : overlay === 'settings' ? 'settings-dialog' : 'wide-dialog'}>
          {overlay === 'settings' && <SettingsPanel settings={settings} onChange={next => { audio.start(); setSettings(next); }} onFullscreen={toggleFullscreen} fullscreen={fullscreen} />}
          {overlay === 'guide' && <Guide tab={guideTab} setTab={setGuideTab} snapshot={scene === 'game' ? snapshot : savedGame ? { ...INITIAL_SNAPSHOT, notes: savedGame.notes, stage: savedGame.stage, position: savedGame.position } : undefined} playing={scene === 'game'} />}
          {overlay === 'map' && <><div className="dialog-heading"><span className="eyebrow">YOUR FIELD MAP / {Math.min(snapshot.stage, CHAPTERS.length)} OF {CHAPTERS.length} CONNECTIONS RESTORED</span><h2>Everything is connected.</h2><p>Sometimes, getting lost is a matter of perspective.</p></div><FieldMap snapshot={snapshot} onReturn={checkpoint} /><div className="dialog-footer"><span><Icon name="save" size={14} />Your progress is saved</span><button className="text-button" onClick={closeOverlay}>Back to the world<Icon name="arrow" size={16} /></button></div></>}
          {overlay === 'pause' && <div className="pause-menu"><FoldMark size={38} /><span className="eyebrow">THE WORLD CAN WAIT.</span><h2>Take a breath.</h2><p>{snapshot.stage >= CHAPTERS.length ? 'Walsenburg is back where it belongs.' : `${String(snapshot.stage + 1).padStart(2, '0')} / ${chapter.name}`}</p><button className="primary-button" onClick={enterWorld}>Back to the world<Icon name="arrow" size={19} /></button><div className="pause-links"><button onClick={checkpoint}><Icon name="reset" size={18} />Restart from checkpoint<Icon name="chevron" size={16} /></button><button onClick={() => openOverlay('worlds', true)}><Icon name="save" size={18} />Manage saved worlds<Icon name="chevron" size={16} /></button><button onClick={() => openOverlay('map', true)}><Icon name="map" size={18} />Field map & objectives<Icon name="chevron" size={16} /></button><button onClick={() => openGuide('notes', true)}><Icon name="book" size={18} />Field notes<Icon name="chevron" size={16} /></button><button onClick={() => openOverlay('settings', true)}><Icon name="settings" size={18} />Settings<Icon name="chevron" size={16} /></button></div><button className="leave-button" onClick={leave}><Icon name="home" size={16} />Save & return to title</button><span className="pause-save-note"><i />YOUR JOURNEY IS SAVED LOCALLY</span></div>}
          {overlay === 'new' && <div className="confirmation-menu"><span className="eyebrow">ANOTHER WAY THROUGH.</span><h2>A fresh beginning?</h2><p>Starting a new journey replaces your current local checkpoint. Your settings will stay just as you left them.</p><button className="primary-button" onClick={() => begin(true)}>Begin a new journey<Icon name="arrow" size={17} /></button><button className="text-button" onClick={closeOverlay}>Keep my current journey</button></div>}
          {overlay === 'worlds' && <WorldSaveModal onLoadWorld={handleLoadWorld} onSaveCurrentWorld={name => { engineRef.current?.save(); setSavedGame(readSave()); setNotice(`Saved world "${name || 'Current World'}"`); }} currentSaveData={savedGame} isInGame={scene === 'game'} onClose={closeOverlay} />}
          {overlay === 'ending' && <div className="ending-content"><FoldMark size={56} /><span className="eyebrow">SEVEN CONNECTIONS. ONE PLACE TO CALL HOME.</span><h2>A little closer<br />to where we belong.</h2><p>The engine is quiet. The streets lead where they should.<br />And somewhere beneath Walsenburg, a light stays on.</p><blockquote>"There are very few places where being slightly impossible barely makes the local paper."<cite>NORA / LOCAL RESEARCH ASSISTANT</cite></blockquote><div className="ending-actions"><button className="primary-button" onClick={enterWorld}>Keep exploring<Icon name="arrow" size={18} /></button><button className="text-button" onClick={leave}>Return to title</button></div><span className="ending-caption">THE END OF THIS FOLD. NOT THE END OF THE ROAD.</span></div>}
        </Dialog>}
      </AnimatePresence>
      <AnimatePresence>{notice && <motion.div className="app-notice" role="status" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}><Icon name="info" size={17} /><span>{notice}</span><button aria-label="Dismiss message" onClick={() => setNotice('')}><Icon name="close" size={15} /></button></motion.div>}</AnimatePresence>
    </main>
  </MotionConfig>;
}