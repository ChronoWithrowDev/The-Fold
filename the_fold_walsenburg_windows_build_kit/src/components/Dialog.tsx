import { useEffect, useRef, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { Icon } from './Icons';

export function Dialog({ children, onClose, className = '', label, reducedMotion = false }: { children: ReactNode; onClose: () => void; className?: string; label: string; reducedMotion?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const timer = window.setTimeout(() => ref.current?.querySelector<HTMLElement>('button, input, select, [tabindex="0"]')?.focus(), 80);
    return () => { clearTimeout(timer); previous?.focus(); };
  }, []);
  return <motion.div className="dialog-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reducedMotion ? 0 : 0.2 }} onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <motion.div ref={ref} role="dialog" aria-modal="true" aria-label={label} className={`dialog ${className}`} initial={{ opacity: 0, y: reducedMotion ? 0 : 18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: reducedMotion ? 0 : 8 }} transition={{ duration: 0.25 }} onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeRef.current(); }
      if (event.key === 'Tab') {
        const focusable = [...(ref.current?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input, select, [tabindex="0"]') || [])];
        const first = focusable[0]; const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }}>
      <button className="icon-button dialog-close" onClick={onClose} aria-label="Close menu"><Icon name="close" size={22} /></button>
      {children}
    </motion.div>
  </motion.div>;
}