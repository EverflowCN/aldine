# Everflow LaTeX UI — TeXPage-style reference layout

These layouts were reconstructed **from two user-provided HTML snapshots**, without copying
TeXPage scripts, stylesheets, fonts, backend interfaces, account information, or other assets.
The interface is entirely implemented in the open Everflow/Aldine components.

## Project console

- White header: 50px, brand and local-data status.
- White left project navigation: 280px at wide viewport (210px compact).
- Light-gray workspace and blue information banner.
- Main project list: white full-width bordered rows with project title, local version,
  last modified date, source ZIP size, star marker and overflow menu.
- Functional: create, upload ZIP, search, sort, star, restore, move to trash,
  download/delete original ZIP; stored in browser IndexedDB and localStorage.

## Source + PDF workspace

- Dark main header: 40px; dark 32px source and PDF header bars.
- Left explorer: 250px dark panel, icon toolbar (new source, folder, upload,
  find files), real folder tree, collapsible advanced operations and file outline.
- Middle: existing CodeMirror editor with functioning undo, redo, search,
  toggle comment and display-math insertion actions.
- Right: split PDF viewer/logs with optional native PDFium CJK viewer and downloadable
  generated PDF. The splitter remains draggable.
- Functional view menu: split / source-only / PDF-only / show-hide file explorer.
- Bottom: slim local status line (file, line count, engine, saving state).

## Icons

- [TexPageIcon.tsx](../apps/web/src/components/TexPageIcon.tsx) renders locally bundled
  outline SVG paths; no icon-font downloads, external CDNs, or TeXPage font files.
- Appearance is compatible with the style of freely available outline sets such as
  [Lucide](https://lucide.dev/), without requiring runtime installation.

## Integrity and constraints

- Existing browser local data and original ZIP caches are retained.
- XeLaTeX/BusyTeX compilation is unchanged by the layout refresh.
- Original user HTML was **not** committed; it contains account-specific data and
  third-party scripts. This is a visual and interaction adaptation, not a claim that
  proprietary server-only features (cloud collaboration, full version history,
  Git hosting, AI tools) are implemented.
- UI/browser regression suite: `e2e/tests/61-browser-local-files.spec.ts`,
  `62-browser-project-history.spec.ts`,
  `63-texpage-reference-layout.spec.ts`.
- Zero monthly fees: static GitHub Pages hosting and browser-only storage/compilation.
