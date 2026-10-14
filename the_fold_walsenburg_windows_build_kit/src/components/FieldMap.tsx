import { useState } from 'react';
import { CHAPTERS, type GameSnapshot } from '../game/types';
import { Icon } from './Icons';

const point = (x: number, z: number) => [36 + (x + 100) * 2.65, 24 + (z + 200) * 1.5];

export function FieldMap({ snapshot, onReturn, isPlaying = true }: { snapshot: GameSnapshot; onReturn?: () => void; isPlaying?: boolean }) {
  const [selected, setSelected] = useState(Math.min(snapshot.stage, CHAPTERS.length - 1));
  const [hintLevel, setHintLevel] = useState(0);
  const chapter = CHAPTERS[selected];
  const [rawX, rawY] = point(snapshot.position[0], snapshot.position[2]);
  // Pueblo sits far east of this sheet, so the marker pins to the edge rather than drifting off it.
  const px = Math.max(14, Math.min(606, rawX));
  const py = Math.max(14, Math.min(456, rawY));
  const offSheet = px !== rawX || py !== rawY;
  return <div className="field-map-layout">
    <div className="map-drawing">
      <div className="map-caption"><span>WALSENBURG & VICINITY</span><span>NOT TO SCALE</span></div>
      <svg viewBox="0 0 620 470" aria-label="Map of seven connected research sites in fictionalized Walsenburg" className="world-map">
        <defs><pattern id="map-grid" width="26" height="26" patternUnits="userSpaceOnUse"><path d="M26 0H0V26" fill="none" stroke="#a8c2ae" strokeOpacity=".045" strokeWidth="1" /></pattern></defs>
        <rect width="620" height="470" fill="url(#map-grid)" />
        <g fill="none" stroke="#849682" strokeWidth="1" opacity=".15">
          <path d="M1 109Q77 65 143 95T249 38T411 32T620 68M0 95Q79 51 143 81T249 24T411 18T620 54M0 82Q80 40 146 66T249 10T411 4T620 40" />
          <path d="M620 398Q556 344 525 381T434 403T417 459M620 414Q556 360 528 395T449 421T433 470M620 430Q556 376 531 412T464 439T449 480" />
          <path d="M17 439Q122 346 168 401T255 448M1 445Q110 335 172 387T272 455M-9 451Q112 319 180 373T289 467" />
        </g>
        <path d="m221 44 30-27 26 27 37-37 38 38" fill="none" stroke="#8fa28d" strokeOpacity=".36" strokeWidth="1.2" />
        <text x="285" y="64" textAnchor="middle" className="map-place-label">THE SPANISH PEAKS</text>
        <path d="M52 166Q93 141 136 159L165 212Q150 251 106 252L56 228Z" fill="#416958" fillOpacity=".3" stroke="#7ca28b" strokeOpacity=".2" />
        <text x="105" y="201" textAnchor="middle" className="map-place-label">LATHROP</text><text x="105" y="216" textAnchor="middle" className="map-place-label">RESERVE</text>
        <g stroke="#839688" fill="none" strokeOpacity=".32" strokeWidth="6">
          <path d={`M${point(0, 54).join(' ')}L${point(0, -103).join(' ')}`} />
          <path d={`M${point(-88, -25).join(' ')}L${point(70, -25).join(' ')}`} />
        </g>
        <g stroke="#acc0ad" fill="none" strokeOpacity=".28" strokeWidth="1" strokeDasharray="4 5">
          <path d={`M${point(-12, -101).join(' ')}V${point(-12, -75)[1]}H${point(0, -75)[0]}`} />
          <path d={`M${point(48, -76).join(' ')}H${point(0, -76)[0]}`} />
          <path d={`M${point(42, -38).join(' ')}V${point(42, -25)[1]}`} />
          <path d={`M${point(-15, -110).join(' ')}L${point(19, -120).join(' ')}H${point(64, -143)[0]}V${point(64, -161)[1]}`} />
        </g>
        <g fill="#6f8272" fillOpacity=".26">
          {[-1, 1].flatMap(side => [36, 20, 3, -11, -43].map((z, i) => { const [x, y] = point(side * 21, z); return <rect key={`${side}-${i}`} x={x - 14} y={y - 9} width={28} height={19} rx="1" />; }))}
        </g>
        <text transform={`translate(${point(0, 12)[0] + 4} ${point(0, 12)[1]}) rotate(-90)`} className="map-place-label">MAIN STREET</text>
        <g transform="translate(571 31)"><path d="m0 22 0-18m-5 6 5-6 5 6" fill="none" stroke="#b8c8b5" /><text y="0" textAnchor="middle" className="map-north">N</text></g>
        {CHAPTERS.map((site, index) => {
          const [x, y] = point(...site.location);
          const completed = index < snapshot.stage;
          return <g key={site.name} role="button" tabIndex={0} aria-label={`${index + 1}: ${site.name}${completed ? ', restored' : ''}`} className={`map-site ${selected === index ? 'selected' : ''}`} transform={`translate(${x} ${y})`} onClick={() => { setSelected(index); setHintLevel(0); }} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelected(index); setHintLevel(0); } }}>
            <circle r="22" fill="transparent" />
            {selected === index && <circle className="map-site-halo" r="20" fill="none" stroke="#b8d9a9" strokeOpacity=".35" />}
            <circle r="13" fill={selected === index ? '#bfd8af' : '#263c31'} stroke={selected === index ? '#d6e9c8' : '#789782'} />
            {completed ? <path d="m-5 0 3 3 7-6" fill="none" stroke={selected === index ? '#22352c' : '#bddbad'} strokeWidth="1.4" /> : <text textAnchor="middle" y="4" fill={selected === index ? '#22352c' : '#bfd1ba'}>{String(index + 1).padStart(2, '0')}</text>}
          </g>;
        })}
        <g transform="translate(548 404)">
          <path d="M-16 32h30l14-14" fill="none" stroke="#9fb79c" strokeOpacity=".5" strokeWidth="1.4" strokeDasharray="5 4" />
          <path d="M36 12h12m0 0-5-5m5 5-5 5" fill="none" stroke="#b8cdae" strokeOpacity=".7" strokeWidth="1.2" />
          <text x="34" y="2" textAnchor="middle" className="map-place-label">PUEBLO</text>
          <text x="34" y="-10" textAnchor="middle" className="map-place-label">EAST HIGHWAY</text>
        </g>
        <g transform="translate(150 428)">
          <path d="M10 -14v22l-12 12" fill="none" stroke="#9fb79c" strokeOpacity=".5" strokeWidth="1.4" strokeDasharray="5 4" />
          <path d="M10 22v12m0 0-5-5m5 5 5-5" fill="none" stroke="#b8cdae" strokeOpacity=".7" strokeWidth="1.2" />
          <text x="10" y="-20" textAnchor="middle" className="map-place-label">TRINIDAD</text>
          <text x="10" y="-32" textAnchor="middle" className="map-place-label">SOUTH HIGHWAY</text>
        </g>
        {isPlaying && <g transform={`translate(${px} ${py}) rotate(${-snapshot.yaw * 180 / Math.PI})`}><circle r="8" fill="#f2f2d9" fillOpacity=".1" />{offSheet && <circle r="11" fill="none" stroke="#f1f0da" strokeOpacity=".5" strokeWidth="1" strokeDasharray="3 3" />}<path d="m0-7 4.5 11L0 2l-4.5 2Z" fill="#f1f0da" stroke="#18392d" strokeWidth="1" /></g>}
      </svg>
      <div className="map-legend"><span><i className="legend-player" />You</span><span><i className="legend-site" />Research site</span><span>{offSheet ? 'YOU ARE OFF THIS SHEET' : 'FICTIONALIZED FIELD MAP'}</span></div>
    </div>
    <div className="map-information">
      <div className="map-sites-list">
        {CHAPTERS.map((site, index) => <button key={site.name} className={`map-site-row ${selected === index ? 'selected' : ''}`} onClick={() => { setSelected(index); setHintLevel(0); }}><span className="site-number">{index < snapshot.stage ? <Icon name="check" size={14} /> : String(index + 1).padStart(2, '0')}</span><span>{site.name.replace('The ', '')}</span>{selected === index && <Icon name="chevron" size={13} />}</button>)}
      </div>
      <div className="map-site-detail"><span className="eyebrow">{chapter.place}</span><h3>{chapter.objective}</h3><p>{chapter.detail}</p>
        {isPlaying && <button className="text-button hint-button" onClick={() => setHintLevel(level => Math.min(3, level + 1))}>{hintLevel === 0 ? 'Need a little nudge?' : hintLevel < 3 ? 'A little more help' : 'All field hints revealed'}<Icon name={hintLevel === 3 ? 'check' : 'chevron'} size={14} /></button>}
        {hintLevel > 0 && <p className="hint-text" aria-live="polite">{chapter.hints[hintLevel - 1]}</p>}
      </div>
      {onReturn && <button className="subtle-button checkpoint-button" onClick={onReturn}><Icon name="reset" size={16} />Return to current checkpoint</button>}
    </div>
  </div>;
}