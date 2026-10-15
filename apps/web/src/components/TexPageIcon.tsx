/** Everflow UI outline icons: self-contained SVG inspired by open outline icon conventions.
 * No TeXPage font files, logos, remote CDNs, or private brand resources. */
import type { SVGProps, ReactNode } from 'react';

export type TexIconName =
  | 'home' | 'plus' | 'filePlus' | 'folderPlus' | 'folder' | 'upload' | 'download'
  | 'search' | 'star' | 'archive' | 'trash' | 'restore' | 'list' | 'grid'
  | 'chevronLeft' | 'chevronDown' | 'chevronRight' | 'more' | 'settings'
  | 'help' | 'info' | 'clock' | 'check' | 'refresh' | 'document'
  | 'code' | 'file' | 'copy' | 'external' | 'panelLeft' | 'panelRight'
  | 'play' | 'book' | 'history' | 'sun' | 'moon' | 'maximize' | 'layout'
  | 'eye' | 'edit' | 'x' | 'menu';

const drawings: Record<TexIconName, ReactNode> = {
  home: <><path d="m2 7 6-5 6 5v7H2Z" /><path d="M6 14V9h4v5" /></>,
  plus: <path d="M8 2v12M2 8h12" />,
  filePlus: <><path d="M4 1.5h5.5L13 5v9H4a1 1 0 0 1-1-1V2.5a1 1 0 0 1 1-1Z"/><path d="M9.5 1.5V5H13M8 7v5M5.5 9.5h5"/></>,
  folderPlus: <><path d="M1.5 4h5l1.5 2h6v7.5h-12Z"/><path d="M8 8v4M6 10h4"/></>,
  folder: <path d="M1.5 4h5l1.5 2h6v7.5h-12Z" />,
  upload: <><path d="M8 11V2m0 0L5 5m3-3 3 3"/><path d="M2 10v3.5h12V10"/></>,
  download: <><path d="M8 2v9m0 0-3-3m3 3 3-3"/><path d="M2 11v3h12v-3"/></>,
  search: <><circle cx="7" cy="7" r="4.7"/><path d="m10.5 10.5 3.8 3.8"/></>,
  star: <path d="m8 1.5 2 4.2 4.5.6-3.2 3.2.7 4.6L8 12l-4 2.1.8-4.6-3.3-3.2 4.5-.6Z"/>,
  archive: <><rect x="2" y="2" width="12" height="3" rx=".6"/><path d="M3 5v9h10V5M6 9h4"/></>,
  trash: <><path d="M3 4h10M6 2h4M5 4l.5 10h5L11 4M7 7v4M9 7v4"/></>,
  restore: <><path d="M3 7V3m0 0 4 0M3 3l3.2 3"/><path d="M3 10A5.5 5.5 0 1 0 5 4"/></>,
  list: <><path d="M5 3h9M5 8h9M5 13h9"/><path d="M2 3h.01M2 8h.01M2 13h.01"/></>,
  grid: <><rect x="2" y="2" width="5" height="5" rx=".6"/><rect x="9" y="2" width="5" height="5" rx=".6"/><rect x="2" y="9" width="5" height="5" rx=".6"/><rect x="9" y="9" width="5" height="5" rx=".6"/></>,
  chevronLeft: <path d="m10.5 3-5 5 5 5"/>,
  chevronRight: <path d="m5.5 3 5 5-5 5"/>,
  chevronDown: <path d="m3 5.5 5 5 5-5"/>,
  more: <><circle cx="3" cy="8" r="1"/><circle cx="8" cy="8" r="1"/><circle cx="13" cy="8" r="1"/></>,
  settings: <><circle cx="8" cy="8" r="2.2"/><path d="M6 2.1 7 1h2l1 1.1 1.5.6 1.5-.3 1 1.7-.9 1.3v1.5l.9 1.3-1 1.7-1.5-.3-1.5.6L9 15H7l-1-1.1-1.5-.6-1.5.3-1-1.7.9-1.3V9.1L2 7.8l1-1.7 1.5.3L6 5.8Z" transform="translate(0 -1) scale(1 .98)"/></>,
  help: <><circle cx="8" cy="8" r="6.5"/><path d="M6.4 6a1.9 1.9 0 0 1 3.7.6c0 1.5-2.1 1.5-2.1 3M8 12.7h.01"/></>,
  info: <><circle cx="8" cy="8" r="6.4"/><path d="M8 7v4M8 4.3h.01"/></>,
  clock: <><circle cx="8" cy="8" r="6"/><path d="M8 4.2V8l2.6 2.1"/></>,
  check: <path d="m2 8 4 4 8-8"/>,
  refresh: <><path d="M13.5 7A5.5 5.5 0 0 0 4 4M3 1.5V5h3.5M2.5 9A5.5 5.5 0 0 0 12 12M13 14.5V11H9.5"/></>,
  document: <><path d="M4 1.5h5.5L13 5v9H4a1 1 0 0 1-1-1V2.5a1 1 0 0 1 1-1Z"/><path d="M9.5 1.5V5H13M5.5 8h5M5.5 10.5h5"/></>,
  code: <><path d="M6 4 2.5 8 6 12m4-8 3.5 4L10 12M9 2 7 14"/></>,
  file: <><path d="M4 1.5h5.5L13 5v9H4a1 1 0 0 1-1-1V2.5a1 1 0 0 1 1-1Z"/><path d="M9.5 1.5V5H13"/></>,
  copy: <><rect x="5" y="5" width="9" height="9" rx="1"/><path d="M11 5V2H2v9h3"/></>,
  external: <><path d="M8.5 3H13v4.5M13 3 7.3 8.7"/><path d="M13 9.5V13H3V3h3.5"/></>,
  panelLeft: <><rect x="1.5" y="2" width="13" height="12" rx="1"/><path d="M6 2v12"/></>,
  panelRight: <><rect x="1.5" y="2" width="13" height="12" rx="1"/><path d="M10 2v12"/></>,
  play: <path d="M5 3.1 12 8l-7 4.9Z" />,
  book: <><path d="M2 2.5h5.5c1 0 1.5.6 1.5 1.5V14c0-1-1-1.5-2-1.5H2ZM14 2.5H9.5c-1 0-1.5.6-1.5 1.5V14c0-1 1-1.5 2-1.5h4Z"/></>,
  history: <><path d="M3.5 4.5V2m0 2.5H1M3.6 4.4a5.5 5.5 0 1 1-1 6.5"/><path d="M8 4.5V8l2.7 1.7"/></>,
  sun: <><circle cx="8" cy="8" r="2.5"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.4 1.4M11.6 11.6 13 13M3 13l1.4-1.4M11.6 4.4 13 3"/></>,
  moon: <path d="M13.7 10.5A5.7 5.7 0 0 1 5.5 2.3 5.7 5.7 0 1 0 13.7 10.5Z"/>,
  maximize: <><path d="M6 2H2v4M10 2h4v4M2 10v4h4M14 10v4h-4"/></>,
  layout: <><rect x="1.5" y="2" width="13" height="12" rx="1"/><path d="M1.5 5.5h13M6 5.5V14"/></>,
  eye: <><path d="M1.5 8s2.3-4.5 6.5-4.5 6.5 4.5 6.5 4.5-2.3 4.5-6.5 4.5S1.5 8 1.5 8Z"/><circle cx="8" cy="8" r="2"/></>,
  edit: <><path d="m3 11.5 7.5-7.5 2.5 2.5-7.5 7.5-3.4.7Z"/><path d="m9.5 5 2.5 2.5"/></>,
  x: <path d="M3 3l10 10M13 3 3 13"/>,
  menu: <path d="M2 4h12M2 8h12M2 12h12"/>
};
export function TexPageIcon({ name, ...props }: { name: TexIconName } & SVGProps<SVGSVGElement>) {
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor"
    strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
    focusable="false" {...props}>{drawings[name]}</svg>;
}
