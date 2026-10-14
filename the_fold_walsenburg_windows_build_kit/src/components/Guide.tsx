import { useState } from 'react';
import { FieldMap } from './FieldMap';
import { FoldMark, Icon, Key } from './Icons';
import { INITIAL_SNAPSHOT, RESEARCH_NOTES, type GameSnapshot } from '../game/types';

export type GuideTab = 'world' | 'controls' | 'notes' | 'about';

const controls = [
  { keys: ['W', 'A', 'S', 'D'], action: 'Explore', detail: 'Move through the world.' },
  { keys: ['MOUSE'], action: 'Look around', detail: 'Drag to look if mouse capture is unavailable.' },
  { keys: ['LMB', '1'], action: 'Blue fold', detail: 'Place your first spatial anchor.' },
  { keys: ['RMB', '2'], action: 'Orange fold', detail: 'Place the other end of the connection.' },
  { keys: ['SPACE'], action: 'Jump', detail: 'A little height can go a long way.' },
  { keys: ['SHIFT'], action: 'Run', detail: 'Pick up speed. Keep your momentum.' },
  { keys: ['E'], action: 'Interact', detail: 'Pick up a core, set it down, or use a console.' },
  { keys: ['F'], action: 'Throw a core', detail: 'Send a carried object on its way.' },
  { keys: ['G'], action: 'Gravity wheel', detail: 'Hold G, flick toward a direction, and release. Tap G to keep the wheel open and click instead. Time slows while it is open.' },
  { keys: ['R'], action: 'Try another angle', detail: 'Reset the current puzzle at your checkpoint.' },
  { keys: ['TAB'], action: 'Field map', detail: 'Review your objective or ask for a hint.' },
  { keys: ['ESC'], action: 'Take a breath', detail: 'Pause, change settings, or save and leave.' },
];

export function Guide({ tab, setTab, snapshot, playing }: { tab: GuideTab; setTab: (tab: GuideTab) => void; snapshot?: GameSnapshot; playing: boolean }) {
  const [selectedNote, setSelectedNote] = useState('orientation');
  const current = snapshot || INITIAL_SNAPSHOT;
  const note = RESEARCH_NOTES.find(n => n.id === selectedNote) || RESEARCH_NOTES[0];
  return <>
    <div className="dialog-heading"><span className="eyebrow">HUERFANO SPATIAL RESEARCH</span><h2>A field guide to the impossible.</h2><p>Curiosity is the only qualification you need.</p></div>
    <div className="menu-tabs" role="tablist" aria-label="Field guide sections">{(['world', 'controls', 'notes', 'about'] as const).map(item => <button role="tab" aria-selected={tab === item} className={tab === item ? 'active' : ''} key={item} onClick={() => setTab(item)}>{item === 'world' ? 'The world' : item === 'notes' ? 'Field notes' : item === 'about' ? 'This build' : item}</button>)}</div>
    {tab === 'world' && <FieldMap snapshot={current} isPlaying={playing} />}
    {tab === 'controls' && <div className="controls-guide"><div className="control-principle"><div className="portal-diagram"><span className="diagram-portal mint" /><span className="diagram-line" /><FoldMark size={28} /><span className="diagram-line" /><span className="diagram-portal amber" /></div><h3>Two folds. One connection.</h3><p>Fire at any clear, broad, solid, flat surface. Folds orient to you: on walls they stand upright to your gravity, and on floors and ceilings their top edge points the way you face. A tiny blue circle marks any spot that can hold one. Step through either end and take your momentum with you — and if you can see a fold through a fold, you can see yourself, too. Cores can make the journey, too. Find a Vector Shifter in the mountain lab for six directions of gravity.</p></div><div className="control-list">{controls.map(control => <div className="control-line" key={control.action}><div className="control-key-group">{control.keys.map(key => <Key key={key} wide={key.length > 1}>{key}</Key>)}</div><div><strong>{control.action}</strong><p>{control.detail}</p></div></div>)}</div></div>}
    {tab === 'notes' && <div className="journal-layout"><div className="journal-list"><span className="eyebrow">{current.notes.length} / {RESEARCH_NOTES.length} ENTRIES RECOVERED</span>{RESEARCH_NOTES.map(entry => <button key={entry.id} className={`journal-entry ${selectedNote === entry.id ? 'selected' : ''}`} disabled={!current.notes.includes(entry.id)} onClick={() => setSelectedNote(entry.id)}><Icon name="book" size={16} /><span>{current.notes.includes(entry.id) ? entry.title : 'Undiscovered field note'}</span>{current.notes.includes(entry.id) && <Icon name="chevron" size={14} />}</button>)}<p className="muted-note">Look for green field-log terminals as you explore. Read them with E.</p></div><article className="journal-page"><span className="eyebrow">{note.place}</span><h3>{note.title}</h3><p>{note.text}</p><div className="journal-signature">NORA<span>LOCAL RESEARCH ASSISTANT</span></div></article></div>}
    {tab === 'about' && <div className="about-build"><FoldMark size={54} /><div><span className="eyebrow">THE FOLD / WALSENBURG / V0.2</span><h3>An ordinary town.<br />An extraordinary wrong turn.</h3><p>A compact, original portal-puzzle adventure set in a fictionalized Walsenburg, Colorado. Seven connected story sites, a curious local assistant, and a device that takes the distance out of getting somewhere.</p><p>The mountain trail leads to a working inversion lab, where a Vector Shifter lets you change the direction of your personal gravity. Broad, flat, solid surfaces around the world can accept your portals.</p><p>This playable WebGL prototype includes live portal views, momentum, movable cores, checkpoints, and an ending. The title artwork is conceptual; the playable world uses procedural 3D art.</p><div className="build-disclosure"><Icon name="info" size={18} /><p>This is not a release-certified Windows game. Desktop packaging source and instructions are included in the project. Native packaging and a full end-to-end playtest have not been verified in this environment.</p></div><span className="eyebrow about-credit">ORIGINAL WORLD / ORIGINAL SOUND / BUILT FOR CURIOSITY</span></div></div>}
  </>;
}