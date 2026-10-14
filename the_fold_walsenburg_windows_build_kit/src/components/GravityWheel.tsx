import { motion } from 'framer-motion';
import { GRAVITY_LABELS, WHEEL_ORDER } from '../game/gravity';

const OUTER = 150;
const INNER = 58;
const GAP = 0.035;

function wedge(slot: number) {
  // Slot 0 is centred at the top; angles run clockwise, matching how the cursor picks slots.
  const from = (slot - 0.5) * (Math.PI / 3) + GAP;
  const to = (slot + 0.5) * (Math.PI / 3) - GAP;
  const point = (radius: number, angle: number) => `${Math.sin(angle) * radius} ${-Math.cos(angle) * radius}`;
  return `M${point(INNER, from)} L${point(OUTER, from)} A${OUTER} ${OUTER} 0 0 1 ${point(OUTER, to)} L${point(INNER, to)} A${INNER} ${INNER} 0 0 0 ${point(INNER, from)} Z`;
}

/** A small arrow pointing the way gravity would pull, drawn in the wedge's own frame. */
const ARROWS: Record<string, string> = {
  DOWN: 'M0 -9v16m0 0-6-6m6 6 6-6',
  UP: 'M0 9v-16m0 0-6 6m6-6 6 6',
  NORTH: 'M0 9v-16m0 0-6 6m6-6 6 6',
  SOUTH: 'M0 -9v16m0 0-6-6m6 6 6-6',
  EAST: 'M-9 0h16m0 0-6-6m6 6-6 6',
  WEST: 'M9 0h-16m0 0 6-6m-6 6 6 6',
};

interface Props {
  hover: number;
  current: number;
  relative: string[];
  reducedMotion: boolean;
  onChoose: (mode: number) => void;
  onCancel: () => void;
}

export function GravityWheel({ hover, current, relative, reducedMotion, onChoose, onCancel }: Props) {
  const focus: number = hover >= 0 ? WHEEL_ORDER[hover] : -1;
  return (
    <motion.div
      className="gravity-wheel"
      initial={{ opacity: 0, scale: reducedMotion ? 1 : 0.86 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: reducedMotion ? 1 : 0.92 }}
      transition={{ duration: reducedMotion ? 0 : 0.14 }}
      role="dialog"
      aria-label="Vector Shifter: choose a gravity direction"
    >
      <svg viewBox="-170 -170 340 340" className="gravity-wheel-svg">
        <circle r={OUTER + 8} className="wheel-halo" />
        {WHEEL_ORDER.map((mode, slot) => {
          const angle = slot * (Math.PI / 3);
          const labelRadius = (OUTER + INNER) / 2 + 6;
          const x = Math.sin(angle) * labelRadius;
          const y = -Math.cos(angle) * labelRadius;
          const label = GRAVITY_LABELS[mode];
          const classes = ['wheel-wedge', slot === hover ? 'is-hover' : '', mode === current ? 'is-current' : ''].join(' ');
          return (
            <g key={mode} className={classes} onClick={() => onChoose(mode)} role="button" aria-label={`Gravity ${label}${mode === current ? ', current' : ''}`}>
              <path d={wedge(slot)} />
              <g transform={`translate(${x} ${y - 16})`}><path d={ARROWS[label]} className="wheel-arrow" /></g>
              <text x={x} y={y + 7} textAnchor="middle" className="wheel-label">{label}</text>
              {relative[mode] && <text x={x} y={y + 21} textAnchor="middle" className="wheel-relative">{relative[mode]}</text>}
              {mode === current && <circle cx={x} cy={y + 31} r="2.6" className="wheel-current-dot" />}
            </g>
          );
        })}
        <g className="wheel-center" onClick={onCancel} role="button" aria-label="Cancel">
          <circle r={INNER - 8} />
          <text y="-6" textAnchor="middle" className="wheel-center-title">{focus >= 0 ? GRAVITY_LABELS[focus] : 'GRAVITY'}</text>
          <text y="12" textAnchor="middle" className="wheel-center-sub">{focus >= 0 ? (focus === current ? 'CURRENT' : 'RELEASE TO SHIFT') : `NOW ${GRAVITY_LABELS[current]}`}</text>
        </g>
      </svg>
      <div className="wheel-help">Flick toward a direction · release <kbd className="key">G</kbd> or click to shift · right-click to cancel</div>
    </motion.div>
  );
}
