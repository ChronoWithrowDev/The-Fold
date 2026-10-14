import type { CSSProperties } from 'react';

export type IconName =
  | 'arrow'
  | 'arrowLeft'
  | 'volume'
  | 'volumeOff'
  | 'expand'
  | 'close'
  | 'book'
  | 'mouse'
  | 'play'
  | 'pause'
  | 'settings'
  | 'check'
  | 'map'
  | 'chevron'
  | 'reset'
  | 'save'
  | 'headphones'
  | 'info'
  | 'home'
  | 'compass'
  | 'external'
  | 'trash'
  | 'download'
  | 'upload';

export function Icon({ name, size = 20, className = '', style }: { name: IconName; size?: number; className?: string; style?: CSSProperties }) {
  const paths: Record<IconName, React.ReactNode> = {
    arrow: <><path d="M4 12h15M13 5l7 7-7 7" /></>,
    arrowLeft: <><path d="M20 12H5m6-7-7 7 7 7" /></>,
    volume: <><path d="m11 4-5 4H3v8h3l5 4V4Z" /><path d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14" /></>,
    volumeOff: <><path d="m11 4-5 4H3v8h3l5 4V4Zm5 5 6 6m0-6-6 6" /></>,
    expand: <><path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5" /></>,
    close: <path d="m6 6 12 12M18 6 6 18" />,
    book: <><path d="M12 5c-3-2-6-2-10-1v15c4-1 7-1 10 1 3-2 6-2 10-1V4c-4-1-7-1-10 1Z" /><path d="M12 5v15M5 8h3m-3 4h3m8-4h3m-3 4h3" /></>,
    mouse: <><rect x="6" y="2" width="12" height="20" rx="6" /><path d="M12 2v7m-6 1h12" /></>,
    play: <path d="m8 4 12 8-12 8V4Z" />,
    pause: <><path d="M8 5v14M16 5v14" strokeWidth="3" /></>,
    settings: <><path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z" /><path d="m9 3 1-2h4l1 2 3 2 2 .1 2 3.8-1.2 2.1v2l1.2 2.1-2 3.8-2 .1-3 2-1 2h-4l-1-2-3-2-2-.1L2 15l1.2-2v-2L2 9l2-3.9L6 5l3-2Z" transform="translate(1.1 1.1) scale(.9)" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    map: <><path d="m3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2V5Z" /><path d="M9 3v16m6-14v16" /></>,
    chevron: <path d="m9 5 7 7-7 7" />,
    reset: <><path d="M3 4v6h6M4 10a8 8 0 1 1 1 8" /></>,
    save: <><path d="M5 3h12l4 4v14H3V3h2Z" /><path d="M7 3v6h10V3M7 21v-8h10v8" /></>,
    headphones: <><path d="M4 14v-3a8 8 0 0 1 16 0v3" /><rect x="3" y="12" width="4" height="8" rx="1.5" /><rect x="17" y="12" width="4" height="8" rx="1.5" /></>,
    info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v6m0-10v.1" /></>,
    home: <><path d="m3 10 9-7 9 7v10H3V10Z" /><path d="M9 20v-7h6v7" /></>,
    compass: <><circle cx="12" cy="12" r="9" /><path d="m16 8-2.6 5.4L8 16l2.6-5.4L16 8Z" /></>,
    external: <><path d="M14 3h7v7M10 14 21 3M10 4H4v16h16v-6" /></>,
    trash: <><path d="M3 6h18m-2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></>,
    download: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4m4-5 5 5 5-5m-5 5V3" /></>,
    upload: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4m14-7-5-5-5 5m5-5v12" /></>,
  };
  return <svg className={className} style={style} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

export function FoldMark({ size = 36, className = '' }: { size?: number; className?: string }) {
  return <svg className={className} width={size} height={size} viewBox="0 0 40 44" fill="none" aria-hidden="true"><path d="m3 12 17-9 17 9v20l-17 9L3 32V12Z" stroke="currentColor" strokeWidth="1.35" /><path d="m3 12 17 10 17-10M20 22v19M3 32l17-10 17 10M20 3v19" stroke="currentColor" strokeWidth="1.35" /><path d="m11.5 17 8.5-4.6 8.5 4.6L20 32l-8.5-15Z" fill="currentColor" fillOpacity=".12" /></svg>;
}

export function Key({ children, wide = false }: { children: React.ReactNode; wide?: boolean }) { return <kbd className={wide ? 'key key-wide' : 'key'}>{children}</kbd>; }