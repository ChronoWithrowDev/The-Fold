import { useState } from 'react';
import { ALL_QUALITIES, DEFAULT_SETTINGS, QUALITY_CONFIG, type Settings } from '../game/types';
import { Icon } from './Icons';

function Toggle({ label, description, checked, onChange }: { label: string; description?: string; checked: boolean; onChange: () => void }) {
  return <div className="setting-row"><div><span className="setting-label">{label}</span>{description && <p>{description}</p>}</div><button type="button" role="switch" aria-checked={checked} aria-label={label} className={`toggle ${checked ? 'on' : ''}`} onClick={onChange}><span /></button></div>;
}

function Slider({ label, description, value, onChange, min = 0, max = 100, step = 1, format }: { label: string; description?: string; value: number; onChange: (value: number) => void; min?: number; max?: number; step?: number; format?: (value: number) => string }) {
  return <div className="setting-row slider-row"><div><label className="setting-label" htmlFor={`setting-${label}`}>{label}</label>{description && <p>{description}</p>}</div><div className="slider-control"><input id={`setting-${label}`} type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(Number(e.target.value))} style={{ '--range-progress': `${(value - min) / (max - min) * 100}%` } as React.CSSProperties} /><output>{format ? format(value) : `${value}%`}</output></div></div>;
}

export function SettingsPanel({ settings, onChange, onFullscreen, fullscreen }: { settings: Settings; onChange: (settings: Settings) => void; onFullscreen: () => void; fullscreen: boolean }) {
  const [tab, setTab] = useState<'controls' | 'audio' | 'display'>('controls');
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => onChange({ ...settings, [key]: value });
  return <>
    <div className="dialog-heading"><span className="eyebrow">YOUR FIELD PREFERENCES</span><h2>Make yourself at home.</h2><p>A few adjustments before you bend reality.</p></div>
    <div className="menu-tabs" role="tablist" aria-label="Settings categories">{(['controls', 'audio', 'display'] as const).map(item => <button role="tab" aria-selected={tab === item} className={tab === item ? 'active' : ''} key={item} onClick={() => setTab(item)}>{item}</button>)}</div>
    <div className="settings-content" role="tabpanel" aria-label={`${tab} settings`}>
      {tab === 'controls' && <>
        <Slider label="Mouse sensitivity" description="The speed at which you look around." value={settings.sensitivity} min={0.2} max={2.5} step={0.05} onChange={value => set('sensitivity', value)} format={value => `${value.toFixed(2)}x`} />
        <Slider label="Field of view" description="A wider perspective on the impossible." value={settings.fov} min={60} max={100} onChange={value => set('fov', value)} format={value => `${value}`} />
        <Toggle label="Invert vertical look" description="Move the mouse up to look down." checked={settings.invertY} onChange={() => set('invertY', !settings.invertY)} />
        <Toggle label="Reduce motion" description="Disable device bob, ripples, and interface movement." checked={settings.reducedMotion} onChange={() => set('reducedMotion', !settings.reducedMotion)} />
        <div className="settings-note"><Icon name="info" size={17} /><p>Arrow keys also look around. Use 1 and 2 to place folds without a mouse. On touchscreens, drag to look and use the on-screen controls.</p></div>
      </>}
      {tab === 'audio' && <>
        <Slider label="Master volume" value={settings.master} onChange={value => set('master', value)} />
        <Slider label="Ambient score" description="An original, generative soundscape." value={settings.music} onChange={value => set('music', value)} />
        <Slider label="World & effects" description="Wind, footsteps, mechanisms, and spatial folds." value={settings.effects} onChange={value => set('effects', value)} />
        <Toggle label="Subtitles" description="Display NORA's dialogue on screen." checked={settings.subtitles} onChange={() => set('subtitles', !settings.subtitles)} />
        <Toggle label="Spoken narration" description="Read NORA's dialogue using your device's available voice." checked={settings.narration} onChange={() => set('narration', !settings.narration)} />
        <Toggle label="Mute all audio" checked={settings.muted} onChange={() => set('muted', !settings.muted)} />
      </>}
      {tab === 'display' && <>
        <div className="setting-row">
          <div>
            <label className="setting-label" htmlFor="quality">Graphics quality</label>
            <p>{QUALITY_CONFIG[settings.quality]?.sublabel || 'Adjust shadows, render scale, and live portal depth.'}</p>
          </div>
          <select id="quality" value={settings.quality} onChange={e => set('quality', e.target.value as Settings['quality'])}>
            {ALL_QUALITIES.map(q => (
              <option key={q} value={q}>
                {QUALITY_CONFIG[q].label}
              </option>
            ))}
          </select>
        </div>
        <div className="setting-row"><div><label className="setting-label" htmlFor="resolution">Render scale</label><p>Lower values improve performance on integrated graphics.</p></div><select id="resolution" value={settings.resolution} onChange={e => set('resolution', Number(e.target.value))}><option value={1}>100% / Native</option><option value={0.75}>75%</option><option value={0.5}>50%</option></select></div>
        <div className="setting-row"><div><span className="setting-label">Display mode</span><p>Your monitor resolution is detected automatically.</p></div><button className="subtle-button" onClick={onFullscreen}><Icon name="expand" size={15} />{fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}</button></div>
        <Toggle label="High-contrast interface" description="Stronger text, crosshair, and HUD contrast." checked={settings.highContrast} onChange={() => set('highContrast', !settings.highContrast)} />
        <div className="settings-note"><Icon name="info" size={17} /><p>Live portal views use a single rendering depth. Choose Performance if frame pacing feels uneven.</p></div>
      </>}
    </div>
    <div className="dialog-footer"><span><Icon name="check" size={14} />Preferences save automatically</span><button className="text-button" onClick={() => onChange({ ...DEFAULT_SETTINGS })}>Restore defaults<Icon name="reset" size={14} /></button></div>
  </>;
}