import { Component, lazy, Suspense, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { BASE_PATH } from '../basePath';
const OfflineCodePane = lazy(() => import('../components/OfflineCodePane'));
const PdfPane = lazy(() => import('../components/PdfPane'));
import { IconChevronLeft } from '../components/Icons';
import { toggleTheme } from '../theme';
import { scanLatexDependencies } from '../util/latex-preflight';
import type { PreflightResult } from '../util/latex-preflight';
import { assessTeXLiveCoverage } from '../util/texlive-manifest';
import type { TeXLiveCoverage } from '../util/texlive-manifest';
import { diagnoseCompileLog } from '../util/latex-compile-diagnostics';
import type { CompileIssue } from '../util/latex-compile-diagnostics';
import { describeCompileEstimate, estimateCompileTime, formatCompileTime, historyKey, readCompileHistory, saveCompileHistory } from '../util/compile-estimate';
import type { CompileEstimate, CompilePhase } from '../util/compile-estimate';
import BrowserFileTree from '../components/BrowserFileTree';
import { readZipNames, decodeProjectText, safeProjectPath, projectFolders, chooseRoot, unwrapProject, parentFolders, repairLegacyPath } from '../util/latex-project-files';
import BrowserProjects from '../components/BrowserProjects';
import { createProject, listProjects, loadProject, saveProject, projectZip, deleteZipCache, deleteProject, setProjectStatus } from '../util/browser-projects';
import type { LocalProject, ProjectRecord } from '../util/browser-projects';
import './BrowserWorkspace.css';

// Browser-only projects deliberately bypass Aldine's server-only API, auth and Yjs.
type Engine = 'xelatex' | 'pdflatex' | 'lualatex';
type UserFile = { path: string; content: string | Uint8Array };
type Workspace = LocalProject;
type BusyLogEntry = { cmd?: string; log?: string; texmflog?: string; missfontlog?: string; stdout?: string; stderr?: string; exit_code?: number };
type BusyCompiler = { compile(options: Record<string, unknown>): Promise<{ success: boolean; pdf?: Uint8Array; log?: string; logs?: BusyLogEntry[]; exitCode?: number }> };
type BusyRunner = { initialize(useWorker?: boolean): Promise<void>; terminate(): void };
const DB_NAME = 'everflow-aldine-browser-v1';
const DB_KEY = 'workspace';
const TEXT_FILE = /\.(tex|sty|cls|bib|txt|md|cfg|def|bbx|cbx|bst|ist|lua)$/i;
const TEST_SOURCE = [
  '\\documentclass[12pt,a4paper]{article}',
  '\\usepackage{amsmath,amssymb}',
  '\\begin{document}',
  '\\section*{Everflow Browser XeLaTeX}',
  'This PDF was compiled in your browser, without a server.',
  '\\[',
  '\\int_0^1 x^2\\,dx = \\frac{1}{3}.',
  '\\]',
  '\\end{document}'
].join('\n');
const CJK_SOURCE = [
  '\\documentclass[12pt,a4paper]{ctexart}',
  '\\usepackage{amsmath,amssymb}',
  '\\begin{document}',
  '\\section*{中文 XeLaTeX 浏览器测试}',
  '测试中文、数学公式与 A4 排版。',
  '\\[',
  '\\int_0^1 x^2\\,\\mathrm{d}x=\\frac13',
  '\\]',
  '\\end{document}'
].join('\n');
async function zipLibrary(): Promise<any> {
  const path = BASE_PATH + '/browser-test/fflate.mjs';
  return await import(/* @vite-ignore */ path);
}

const fresh = (): Workspace => ({
  name: 'Everflow 本地 LaTeX 工程',
  rootFile: 'main.tex',
  engine: 'xelatex',
  files: [{ path: 'main.tex', content: TEST_SOURCE }]
});

function request<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function dbOpen(): Promise<IDBDatabase> {
  return await new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => {
      if (!r.result.objectStoreNames.contains('data')) r.result.createObjectStore('data');
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
let startupRead: Promise<Workspace | null> | undefined;
function readWorkspace(): Promise<Workspace | null> {
  return startupRead ||= restoreWorkspace();
}
async function restoreWorkspace(): Promise<Workspace | null> {
  const db = await dbOpen();
  try {
    const tx = db.transaction('data', 'readonly');
    const value = await request(tx.objectStore('data').get(DB_KEY));
    if (value?.projectId) return await loadProject(value.projectId);
    if (!value || !Array.isArray(value.files)) return null;
    if (value.name === 'Everflow 本地 LaTeX 工程' && value.files.length === 1 && value.files[0].path === 'main.tex' && value.files[0].content === TEST_SOURCE && !value.folders?.length) return value as Workspace;
    try {
      const migrated = await createProject(value as Workspace);
      await persistWorkspace(migrated, false);
      return migrated;
    } catch { return value as Workspace; }
  } finally { db.close(); }
}
async function persistWorkspace(w: Workspace, saveFiles = true): Promise<void> {
  if (saveFiles && w.projectId && !await saveProject(w)) return;
  const db = await dbOpen();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('data', 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
      tx.objectStore('data').put(w.projectId ? { projectId: w.projectId } : w, DB_KEY);
    });
  } finally { db.close(); }
}
function isText(file: UserFile): file is { path: string; content: string } {
  return typeof file.content === 'string';
}
const safePath = safeProjectPath;
function saveAs(data: Blob, name: string): void {
  const url = URL.createObjectURL(data);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 120000);
}

// The WASM library is built from the user's EverflowCN/texlyre-busytex fork
// by the main site's Pages workflow; its ~120MB assets are hosted at /latex/browser-test/core/busytex.
const BUSYTEX_ASSETS = BASE_PATH + '/browser-test/core/busytex';
const BUSYTEX_MODULE = BASE_PATH + '/browser-test/busytex-lib.mjs';
const PACKAGE_SERVICE = 'https://texlive2026.texlyre.org';

class PaneBoundary extends Component<{ children: ReactNode; fallback: ReactNode; resetKey: string }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidUpdate(previous: Readonly<{ resetKey: string }>) {
    if (this.state.failed && previous.resetKey !== this.props.resetKey) this.setState({ failed: false });
  }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

export default function BrowserWorkspace() {
  const [workspace, setWorkspace] = useState<Workspace>(fresh);
  const [active, setActive] = useState('main.tex');
  const [selectedFolder, setSelectedFolder] = useState('');
  const folderUploadRef = useRef<HTMLInputElement>(null);
  const [ready, setReady] = useState(false);
  const [showProjects, setShowProjects] = useState(() => new URLSearchParams(location.search).get('local') !== '1');
  const [projectRecords, setProjectRecords] = useState<ProjectRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState('正在读取本地工程…');
  const [errorLog, setErrorLog] = useState('');
  const [allowPackages, setAllowPackages] = useState(true);
  // GitHub-hosted optional TeX Live bundles. The extra 528 MiB is NEVER
  // downloaded on first visit unless the user explicitly selects a tier.
  const [resourceTier, setResourceTier] = useState<'basic' | 'recommended' | 'extra'>(() => {
    try {
      const v = localStorage.getItem('everflow.busytex.resourceTier');
      return v === 'recommended' || v === 'extra' ? v : 'basic';
    } catch { return 'basic'; }
  });
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [unsaved, setUnsaved] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [compileIssues, setCompileIssues] = useState<CompileIssue[]>([]);
  const [showPreflight, setShowPreflight] = useState(false);
  const [preflight, setPreflight] = useState<PreflightResult | null>(null);
  const [coverage, setCoverage] = useState<TeXLiveCoverage | null>(null);
  const [coverageState, setCoverageState] = useState('尚未查询本站 TeX Live 资源目录。');
  const [sidebarHidden, setSidebarHidden] = useState(false);
  const [jump, setJump] = useState<{ line: number; tick: number }>();
  const [zoom, setZoom] = useState(1);
  // PDF.js can omit subset-embedded Chinese CID glyphs (e.g. FandolSong).
  // Chromium/Edge native PDFium is the safer default for XeLaTeX CJK output.
  const [pdfRenderer, setPdfRenderer] = useState<'native' | 'pdfjs'>(() => {
    try { return localStorage.getItem('aldine.local.pdfRenderer') === 'pdfjs' ? 'pdfjs' : 'native'; }
    catch { return 'native'; }
  });
  const [compileStatus, setCompileStatus] = useState<'idle' | 'compiling' | 'ok' | 'error'>('idle');
  const [compileEstimate, setCompileEstimate] = useState<CompileEstimate | null>(null);
  const [compilePhase, setCompilePhase] = useState<CompilePhase>('checking');
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const startedAtRef = useRef(0);
  const compileLock = useRef(false);
  const [pdfWidth, setPdfWidth] = useState(() => Math.max(330, Math.round(window.innerWidth * .40)));
  const [resizing, setResizing] = useState(false);
  const clampPdf = (w: number) => Math.min(Math.max(260, w), Math.max(280, window.innerWidth - (sidebarHidden ? 390 : 540)));
  const [cacheHint, setCacheHint] = useState('编译资源在首次编译时按需加载');
  const cacheSetup = useRef<Promise<any> | null>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const zipRef = useRef<HTMLInputElement>(null);
  const runnerBundles = useRef('');
  const runnerRef = useRef<BusyRunner | null>(null);
  const engineRef = useRef<Record<Engine, BusyCompiler> | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSaved = useRef<Workspace | null>(null);
  const latest = useRef(workspace);
  latest.current = workspace;
  const previewRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    readWorkspace().then((stored) => {
      if (cancelled) return;
      lastSaved.current = stored || latest.current;
      if (stored) {
        setWorkspace(stored);
        setActive(stored.rootFile);
      }
      setState(stored ? '本地工程已恢复。' : '新建本地工程。');
      void listProjects().then(setProjectRecords).catch(() => {});
      setReady(true);
    }).catch((err: unknown) => {
      if (cancelled) return;
      setState('浏览器存储不可用：可临时编译，但离开页面后可能丢失文件。' + String(err));
      setReady(true);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!ready || workspace === lastSaved.current) return;
    setUnsaved(true);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const saving = latest.current;
      persistWorkspace(saving)
        .then(() => { lastSaved.current = saving; if (latest.current === saving) setUnsaved(false); })
        .catch((err: unknown) => { setUnsaved(true); setState('自动保存失败：' + String(err)); });
    }, 500);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [workspace, ready]);

  function prepareCompileCache(): Promise<any> {
    if (!cacheSetup.current) cacheSetup.current = import(/* @vite-ignore */ BASE_PATH + '/busytex-cache.mjs')
      .then(lib => lib.prepareBusyTeXCache((progress: { phase: string; granted?: boolean; file?: string }) => {
        if (progress.phase === 'repairing') setCacheHint('正在恢复编译资源：' + (progress.file || ''));
        if (progress.phase === 'restored') setCacheHint('编译资源已恢复并缓存');
        if (progress.phase === 'persistence') setCacheHint(progress.granted ? '编译资源将优先保存在本机' : '编译资源按需缓存');
      })).catch(() => null);
    return cacheSetup.current;
  }

  useEffect(() => {
    if (compileStatus !== 'compiling') return;
    const timer = window.setInterval(() => setElapsedSeconds(Math.floor((performance.now() - startedAtRef.current) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [compileStatus]);

  useEffect(() => () => {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    runnerRef.current?.terminate();
  }, []);

  function resetProjectView(next: Workspace): void {
    lastSaved.current = next; setUnsaved(false);
    runnerRef.current?.terminate(); runnerRef.current = null; engineRef.current = null;
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = null; setPreviewUrl(null); setCompileStatus('idle');
    setErrorLog(''); setCompileIssues([]); setPreflight(null); setShowPreflight(false); setShowLog(false); setJump(undefined);
    setCompileEstimate(null); setElapsedSeconds(0);
    setWorkspace(next); setActive(next.rootFile); setSelectedFolder('');
  }
  async function flushProject(): Promise<void> {
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; }
    while (latest.current !== lastSaved.current) {
      const saving = latest.current; await persistWorkspace(saving); lastSaved.current = saving;
    }
    setUnsaved(false);
  }
  async function refreshProjects(): Promise<void> { setProjectRecords(await listProjects()); }
  async function showProjectList(): Promise<void> {
    setBusy(true);
    try { await flushProject(); await refreshProjects(); setShowProjects(true); }
    catch (error) { setState('无法读取工程记录：' + String(error)); }
    finally { setBusy(false); }
  }
  async function projectAction(action: () => Promise<void>): Promise<void> {
    setBusy(true);
    try { await action(); await refreshProjects(); }
    catch (error) { setState('工程操作失败：' + String(error)); }
    finally { setBusy(false); }
  }
  async function openSavedProject(id: string): Promise<void> {
    await projectAction(async () => {
      await flushProject(); const next = await loadProject(id);
      if (!next) throw Error('工程已删除或位于回收站');
      resetProjectView(next); await persistWorkspace(next, false); setShowProjects(false);
      setState('已打开工程：' + next.name);
    });
  }
  async function newProject(): Promise<void> {
    const name = prompt('新工程名称', '未命名工程'); if (!name?.trim()) return;
    await projectAction(async () => {
      await flushProject(); const next = await createProject({ ...fresh(), name: name.trim() });
      resetProjectView(next); await persistWorkspace(next, false); setShowProjects(false); setState('新工程已创建。');
    });
  }
  async function trashProject(id: string): Promise<void> {
    await projectAction(async () => {
      if (id === workspace.projectId) await flushProject();
      await setProjectStatus(id, 'trash');
      if (id === workspace.projectId) { const next = fresh(); resetProjectView(next); await persistWorkspace(next, false); }
      setState('工程已移入回收站，可恢复或彻底删除缓存。');
    });
  }
  async function eraseProject(id: string): Promise<void> {
    if (!confirm('彻底删除此工程、原 ZIP 和全部本地文件缓存？此操作无法恢复。')) return;
    await projectAction(async () => { await deleteProject(id); setState('此工程的 ZIP 与文件缓存已删除。'); });
  }
  async function eraseZip(id: string): Promise<void> {
    if (!confirm('删除此工程的原 ZIP 缓存？工程文件和编辑内容会保留。')) return;
    await projectAction(async () => { await deleteZipCache(id); setState('原 ZIP 缓存已删除，工程文件已保留。'); });
  }
  async function downloadOriginal(id: string): Promise<void> {
    await projectAction(async () => { const blob = await projectZip(id); if (!blob) throw Error('原 ZIP 缓存不存在');
      saveAs(blob, projectRecords.find(r => r.id === id)?.zipName || 'project.zip');
    });
  }
  function update(changes: Partial<Workspace>): void {
    setWorkspace((old) => ({ ...old, ...changes }));
  }
  function updateFile(path: string, content: string): void {
    setWorkspace((old) => ({
      ...old,
      files: old.files.map((file) => file.path === path ? { path, content } : file)
    }));
  }
  async function addFiles(list: FileList | null): Promise<void> {
    if (!list?.length) return;
    setBusy(true);
    try {
    const next: UserFile[] = [];
    let total = 0;
    for (const file of Array.from(list)) {
      const relative = file.webkitRelativePath || file.name;
      const path = safePath(selectedFolder ? selectedFolder + '/' + relative : relative);
      if (!path) { setState('跳过不安全的文件路径。'); continue; }
      total += file.size;
      if (total > 30 * 1024 * 1024) { setState('单次导入最多 30 MB；大型资源请分批导入。'); return; }
      next.push({ path, content: TEXT_FILE.test(path) ? decodeProjectText(new Uint8Array(await file.arrayBuffer())) : new Uint8Array(await file.arrayBuffer()) });
    }
    if (!next.length) return;
    const incoming = new Set(next.map(f => f.path));
    const combined = [...workspace.files.filter(f => !incoming.has(f.path)), ...next];
    const folderNames = projectFolders(combined, workspace.folders);
    if (combined.some(f => folderNames.includes(f.path))) throw new Error('上传文件与已有目录重名');
    setWorkspace((old) => {
      const map = new Map(old.files.map((f) => [f.path, f]));
      next.forEach((f) => map.set(f.path, f));
      const files = Array.from(map.values());
      const rootFile = map.has(old.rootFile) ? old.rootFile : (files.find((f) => f.path.endsWith('.tex'))?.path || old.rootFile);
      return { ...old, files, rootFile };
    });
    setActive(next.find((f) => isText(f))?.path || active);
    setState('已导入 ' + next.length + ' 个文件，仅保存在当前浏览器。');
    } catch (error) {
      setState('文件导入失败：' + (error instanceof Error ? error.message : String(error)));
    } finally { compileLock.current = false; setBusy(false); }
  }
  async function importZip(input: File | undefined): Promise<void> {
    if (!input) return;
    setBusy(true);
    setState('正在解析 ZIP 文件…');
    try {
      const bytes = new Uint8Array(await input.arrayBuffer());
      const names = readZipNames(bytes);
      const lib = await zipLibrary();
      const items = lib.unzipSync(bytes) as Record<string, Uint8Array>;
      const imported: UserFile[] = [];
      const importedFolders: string[] = [];
      for (const entry of names) {
        if (entry.path.split('/').some(part => part === '__MACOSX' || part === '.DS_Store')) continue;
        if (entry.directory) { importedFolders.push(entry.path); continue; }
        const data = items[entry.key];
        if (!data) throw new Error('ZIP 文件目录与内容不一致');
        imported.push({ path: entry.path, content: TEXT_FILE.test(entry.path) ? decodeProjectText(data) : data });
      }
      const { files, folders } = unwrapProject(imported, importedFolders);
      const root = chooseRoot(files);
      await flushProject();
      const next = await createProject({ name: input.name.replace(/\.zip$/i, '').slice(0, 100), engine: 'xelatex', rootFile: root.path, files, folders }, input);
      await persistWorkspace(next, false);
      resetProjectView(next); setShowProjects(false);
      setState('ZIP 已导入，共 ' + files.length + ' 个文件。已自动执行模板依赖检查。');
      auditWorkspaceFiles(files, root.path, true);
    } catch (err: unknown) {
      setState('ZIP 导入失败：' + (err instanceof Error ? err.message : String(err)));
    } finally { setBusy(false); }
  }

  async function exportZip(): Promise<void> {
    setState('正在打包本地工程…');
    try {
      const lib = await zipLibrary();
      const files: Record<string, Uint8Array> = Object.create(null);
      for (const folder of projectFolders(workspace.files, workspace.folders)) files[folder + '/'] = new Uint8Array();
      for (const file of workspace.files) {
        files[file.path] = typeof file.content === 'string' ? new TextEncoder().encode(file.content) : new Uint8Array(file.content);
      }
      const zip = lib.zipSync(files, { level: 6 }) as Uint8Array;
      saveAs(new Blob([new Uint8Array(zip)], { type: 'application/zip' }), (workspace.name || 'everflow-project').replace(/[\\/:*?"<>|]/g, '_') + '.zip');
      setState('ZIP 已生成，建议妥善保存备份。');
    } catch (err: unknown) {
      setState('ZIP 导出失败：' + String(err));
    }
  }

  function createFile(): void {
    const raw = prompt('请输入文件路径，可用 / 放入文件夹', (selectedFolder ? selectedFolder + '/' : '') + '新文件.tex');
    if (raw === null) return;
    const path = safePath(raw);
    if (!path) { setState('文件名无效，不能包含上级目录或绝对路径。'); return; }
    if (!availablePath(path)) { setState('路径已存在，或有同名文件阻挡目录。'); return; }
    setWorkspace((old) => ({ ...old, files: [...old.files, { path, content: '' }] }));
    setActive(path);
  }
  function availablePath(path: string, excluding = ''): boolean {
    const all = [...workspace.files.map(f => f.path), ...projectFolders(workspace.files, workspace.folders)]
      .filter(p => p !== excluding && !p.startsWith(excluding + '/'));
    return !all.includes(path) && !workspace.files.some(f => f.path !== excluding && parentFolders(path).includes(f.path));
  }
  function repairNames(): void {
    const files = workspace.files.map(f => ({ ...f, path: repairLegacyPath(f.path) }));
    const changed = files.filter((f, i) => f.path !== workspace.files[i].path);
    if (!changed.length) { setState('未发现可恢复的旧中文文件名。若内容已有乱码，请重新导入原始 ZIP。'); return; }
    if (new Set(files.map(f => f.path)).size !== files.length) { setState('修复后出现重名，请重新导入原始 ZIP。'); return; }
    if (!confirm('将修复 ' + changed.length + ' 个旧中文文件名，例如：' + changed.slice(0, 3).map(f => f.path).join('、') + '。确定继续吗？')) return;
    setWorkspace(old => ({ ...old, files, folders: (old.folders || []).map(repairLegacyPath), rootFile: repairLegacyPath(old.rootFile) }));
    setActive(repairLegacyPath(active)); setSelectedFolder(repairLegacyPath(selectedFolder));
    auditWorkspaceFiles(files, repairLegacyPath(workspace.rootFile));
    setState('旧中文文件名已修复。若正文仍有乱码，请重新导入原始 ZIP 恢复原始字节。');
  }
  function createFolder(): void {
    const raw = prompt('请输入文件夹路径', (selectedFolder ? selectedFolder + '/' : '') + '新文件夹');
    if (raw === null) return;
    const path = safePath(raw);
    if (!path || !availablePath(path)) { setState('文件夹路径无效或已存在。'); return; }
    update({ folders: [...(workspace.folders || []), path] });
    setSelectedFolder(path);
    setState('已创建文件夹：' + path);
  }
  function renamePath(path: string, directory: boolean): void {
    const raw = prompt('输入新路径；修改父目录即可移动。引用此路径的 LaTeX 指令需要同步修改。', path);
    if (raw === null || raw === path) return;
    const target = safePath(raw);
    if (!target || !availablePath(target, path) || (directory && target.startsWith(path + '/'))) {
      setState('新路径无效、已存在或位于自身目录中。'); return;
    }
    const rewrite = (value: string) => value === path ? target : directory && value.startsWith(path + '/') ? target + value.slice(path.length) : value;
    const files = workspace.files.map(f => ({ ...f, path: rewrite(f.path) }));
    const folders = projectFolders(workspace.files, workspace.folders).map(rewrite);
    if (new Set(files.map(f => f.path)).size !== files.length || folders.some(p => files.some(f => f.path === p))) {
      setState('移动后存在文件与文件夹重名，请选择其他路径。'); return;
    }
    setWorkspace(old => ({ ...old, files, folders, rootFile: rewrite(old.rootFile) }));
    setActive(rewrite(active)); setSelectedFolder(rewrite(selectedFolder));
    setPreflight(null); setShowPreflight(false);
    setState('路径已更新：' + target + '。请同步修改代码中的引用路径。');
  }
  function deletePath(path: string, directory: boolean): void {
    if (!directory) { removeFile(path); return; }
    if (workspace.rootFile.startsWith(path + '/')) { setState('文件夹包含主文件，请先更换主文件。'); return; }
    const count = workspace.files.filter(f => f.path.startsWith(path + '/')).length;
    if (!confirm('删除文件夹“' + path + '”及其中 ' + count + ' 个文件？')) return;
    setWorkspace(old => ({ ...old, files: old.files.filter(f => !f.path.startsWith(path + '/')),
      folders: projectFolders(old.files, old.folders).filter(p => p !== path && !p.startsWith(path + '/')) }));
    if (active.startsWith(path + '/')) setActive(workspace.rootFile);
    if (selectedFolder === path || selectedFolder.startsWith(path + '/')) setSelectedFolder('');
  }
  function removeFile(path: string): void {
    if (path === workspace.rootFile) { setState('不能删除主文件，请先设置其他主文件。'); return; }
    if (!confirm('确定删除 ' + path + '？此文件只存放在本机浏览器。')) return;
    setWorkspace((old) => ({ ...old, files: old.files.filter((f) => f.path !== path) }));
    if (path === active) setActive(workspace.rootFile);
  }
  function insertChineseDemo(): void {
    if (!confirm('将主文件替换为中文测试示例？请先保存原有代码。')) return;
    updateFile(workspace.rootFile, CJK_SOURCE);
    setActive(workspace.rootFile);
    setState('已加入 ctexart 中文测试，点击编译进行字体及宏包兼容性验证。');
  }
  function auditWorkspaceFiles(projectFiles: UserFile[], mainFile: string, isImported = false): void {
    const report = scanLatexDependencies(projectFiles, mainFile);
    setPreflight(report);
    setCoverage(null);
    setCoverageState('正在对照 GitHub Pages 上的 Basic、Recommended、Extra 三套宏包目录…');
    setShowPreflight(true);
    setShowLog(false);
    if (!isImported) setState('静态依赖检查完成：' + report.packages.length + ' 个宏包、' +
      report.fontNames.length + ' 个字体候选、' + report.imageCount + ' 张图片；实际兼容性仍须编译验证。');
    void assessTeXLiveCoverage(report.packages, BUSYTEX_ASSETS, projectFiles.map(f => f.path))
      .then((data) => {
        setCoverage(data);
        setCoverageState(data.byTier.unlisted
          ? '有 ' + data.byTier.unlisted + ' 个宏包未在三套目录中直接找到，需查看日志或按需补充。'
          : '已完成三档 GitHub 托管宏包归属核对；实际是否可编译仍需运行 XeLaTeX。');
      }).catch((e: unknown) => {
        setCoverageState('无法加载 GitHub Pages 上的宏包目录：' + String(e));
      });
  }
  function auditWorkspace(): void {
    auditWorkspaceFiles(workspace.files, workspace.rootFile);
  }

  async function compile(): Promise<void> {
    if (busy || compileLock.current) return;
    const main = workspace.files.find((f) => f.path === workspace.rootFile);
    if (!main || !isText(main)) { setState('请选择有效的 .tex 主文件。'); return; }
    compileLock.current = true;
    const started = performance.now();
    startedAtRef.current = started;
    setElapsedSeconds(0);
    setCompilePhase('checking');
    setCompileEstimate(estimateCompileTime(workspace.files, resourceTier, Boolean(runnerRef.current),
      readCompileHistory(historyKey(workspace.files, resourceTier))));
    setBusy(true);
    setCompileStatus('compiling');
    setShowPreflight(false);
    setShowLog(true);
    setState('正在检查编译资源缓存…');
    setErrorLog('');
    setCompileIssues([]);
    try {
      const report = scanLatexDependencies(workspace.files, workspace.rootFile);
      // A failed/offline catalog lookup must never silently downgrade a complex
      // Everflow/TikZ/CJK project to Basic. The static source scan is our floor.
      let effectiveTier: 'basic' | 'recommended' | 'extra' =
        resourceTier === 'basic' && report.recommendedTier === 'recommended' ? 'recommended' : resourceTier;
      try {
        const required = await assessTeXLiveCoverage(report.packages, BUSYTEX_ASSETS, workspace.files.map(f => f.path));
        const ranks = { basic: 0, recommended: 1, extra: 2 };
        if (ranks[required.suggested] > ranks[effectiveTier]) effectiveTier = required.suggested;
      } catch { /* A failed metadata request must not block an offline compile. */ }
      setCompilePhase('loading');
      const bundles = effectiveTier === 'extra'
        ? [BUSYTEX_ASSETS + '/texlive-recommended.js', BUSYTEX_ASSETS + '/texlive-extra.js']
        : effectiveTier === 'recommended' ? [BUSYTEX_ASSETS + '/texlive-recommended.js'] : [];
      if (effectiveTier !== resourceTier) {
        setResourceTier(effectiveTier);
        try { localStorage.setItem('everflow.busytex.resourceTier', effectiveTier); } catch {}
      }
      const signature = bundles.join('|');
      if (runnerRef.current && runnerBundles.current !== signature) {
        runnerRef.current.terminate(); runnerRef.current = null; engineRef.current = null;
      }
      if (!runnerRef.current || !engineRef.current) {
        // Dynamic import intentionally points to the static library built from our fork.
        const libPath = BUSYTEX_MODULE;
        // Ensure the cache-first worker controls the page before requesting WASM assets.
        const status = await prepareCompileCache();
        const lib = await import(/* @vite-ignore */ libPath);
        const dataReady = typeof lib.isPackageCached === 'function'
          ? await lib.isPackageCached(BUSYTEX_ASSETS + '/texlive-basic.js').catch(() => false)
          : false;
        setCompileEstimate(estimateCompileTime(workspace.files, effectiveTier, Boolean(status?.coreCached || dataReady),
          readCompileHistory(historyKey(workspace.files, effectiveTier))));
        setCompilePhase('initializing');
        setState((status?.coreCached || dataReady)
          ? '正在从本地缓存恢复 XeLaTeX 引擎（仍需初始化 WebAssembly）…'
          : '首次加载编译资源；预计时间包含下载，实际取决于网络速度…');
        const runner = new lib.BusyTexRunner({
          busytexBasePath: BUSYTEX_ASSETS,
          engineMode: 'combined',
          preloadDataPackages: [BUSYTEX_ASSETS + '/texlive-basic.js', ...bundles],
          onDownloadProgress: (p: { percent: number }) => setState('正在准备 TeX Live：' + p.percent + '%')
        }) as BusyRunner;
        try { await runner.initialize(true); }
        catch (e) { runner.terminate(); throw e; }
        runnerBundles.current = signature;
        runnerRef.current = runner;
        engineRef.current = {
          xelatex: new lib.XeLatex(runner),
          pdflatex: new lib.PdfLatex(runner),
          lualatex: new lib.LuaLatex(runner)
        };
      }
      import(/* @vite-ignore */ BASE_PATH + '/busytex-cache.mjs').then((cacheApi) =>
        cacheApi.getBusyTeXCacheStatus().then((cache: { coreCached: boolean }) =>
          setCacheHint(cache.coreCached ? '编译资源已保存在本机浏览器中。' : '编译资源缓存写入中或被浏览器存储策略限制。')
        )
      ).catch(() => {});
      setCompilePhase('compiling');
      setState('编译中：' + workspace.engine + '（计算在你的浏览器内进行；预计时长仅供参考）…');
      const others = workspace.files.filter((f) => f.path !== workspace.rootFile);
      // BusyTeX's default 180-second worker watchdog killed the private
      // Everflow preamble even when the worker had not crashed. Its existing
      // compileTimeoutMs option supports up to 15 minutes. Extend the deadline
      // ONLY for multi-file/large projects; keep simple exercises responsive.
      const complexProject = workspace.files.length >= 30
        || workspace.files.some((f) => typeof f.content === 'string' && f.content.length > 120000);
      const options: Record<string, unknown> = {
        compileTimeoutMs: complexProject ? 15 * 60 * 1000 : undefined,
        mainTexPath: workspace.rootFile,
        input: main.content,
        additionalFiles: others,
        dataPackagesJs: bundles.length ? bundles : undefined,
        rerun: true,
        verbose: 'info',
        remoteEndpoint: allowPackages ? PACKAGE_SERVICE : undefined
      };
      let result = await engineRef.current[workspace.engine].compile(options);
      let recoveryNote = '';
      // BusyTeX can return exitCode=0 for an intermediate -no-pdf pass yet
      // provide no final PDF. In that specific case retry a single PDF pass.
      if (!result.pdf?.length && result.exitCode === 0) {
        recoveryNote = '多轮编译未返回 PDF，已自动尝试一次单轮直接生成；目录/引用可能需要再次编译。';
        setState('未收到 PDF，正在尝试单轮直接编译…');
        result = await engineRef.current[workspace.engine].compile({ ...options, rerun: false });
      }
      setCompilePhase('finishing');
      // BusyTeX's top-level log can be empty even when its stage logs
      // contain the actual XeLaTeX error. Preserve stage stdout/stderr and
      // missing-font information for the LOCAL browser user only.
      const detailed = (result.logs || []).map((entry, index) => {
        const parts = ['【编译阶段 ' + (index + 1) + '】' +
          (entry.cmd ? ' ' + entry.cmd : '') +
          (entry.exit_code !== undefined ? ' · 退出码 ' + entry.exit_code : '')];
        for (const [label, value] of [
          ['TeX', entry.log], ['TeX 文件查找', entry.texmflog],
          ['缺失字体', entry.missfontlog], ['标准错误', entry.stderr],
          ['标准输出', entry.stdout]
        ] as Array<[string, string | undefined]>) {
          if (value?.trim()) parts.push('--- ' + label + ' ---\n' + value.slice(-120000));
        }
        return parts.join('\n');
      }).join('\n\n');
      const diagnosticLog = [recoveryNote, result.log, detailed].filter(Boolean).join('\n\n') || '(编译器未返回日志)';
      setErrorLog(diagnosticLog);
      setCompileIssues(diagnoseCompileLog(diagnosticLog));
      if (!result.success || !result.pdf?.length) {
        setCompileStatus('error');
        const hint = /(?:file .* not found|cannot find file|kpse_remote)/i.test(diagnosticLog)
          ? '可能缺少宏包或引用文件，请检查模板依赖和扩展资源。'
          : /(?:fontspec error|font .* not found|missfont|missing character)/i.test(diagnosticLog)
            ? '检测到字体相关错误，请检查 Times New Roman 回退字体及中文字体。'
            : /(?:out of memory|memory access out of bounds|TeX capacity exceeded)/i.test(diagnosticLog)
              ? '内存或 TeX 容量不足，尝试减少单次编译页数。'
              : '请查看下面的详细日志，定位出错的宏包或 LaTeX 命令。';
        setState('编译失败（' + (result.exitCode ? '退出码：' + result.exitCode : '未生成 PDF') + '）。' + hint);
        return;
      }
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
      const data = new Uint8Array(result.pdf);
      const url = URL.createObjectURL(new Blob([data], { type: 'application/pdf' }));
      previewRef.current = url;
      setPreviewUrl(url);
      setCompileStatus('ok');
      setShowLog(false);
      const duration = Math.round((performance.now() - started) / 1000);
      saveCompileHistory(historyKey(workspace.files, effectiveTier), duration);
      setElapsedSeconds(duration);
      setState('编译成功，耗时 ' + formatCompileTime(duration) + '（含资源加载）。' +
        (recoveryNote ? ' 已通过单轮编译恢复 PDF；请检查目录和交叉引用。' : ''));
    } catch (err: unknown) {
      setCompileStatus('error');
      setErrorLog(err instanceof Error ? err.stack || err.message : String(err));
      setCompileIssues(diagnoseCompileLog(err instanceof Error ? err.stack || err.message : String(err)));
      const reason = err instanceof Error ? err.message : String(err);
      setState(/Compilation timeout|超时/i.test(reason)
        ? '复杂工程编译超过浏览器限定时间。可精简题源后重试；TeX Live 资源未全部缓存时可能更加耗时。'
        : '浏览器编译失败。请查看日志；手机内存不足或资源未就绪都可能导致失败。');
      runnerRef.current?.terminate();
      runnerRef.current = null;
      engineRef.current = null;
    } finally { setBusy(false); }
  }

  const current = workspace.files.find((f) => f.path === active);
  const textFile = current && isText(current) ? current : null;
  const outline = textFile ? [...textFile.content.matchAll(/^[ \t]*\\(part|chapter|section|subsection|subsubsection)\*?(?:\[[^\]]*\])?\{([^}]+)\}/gm)].map(m => ({ title: m[2], level: ['part','chapter','section','subsection','subsubsection'].indexOf(m[1]), line: textFile.content.slice(0, m.index).split('\n').length })) : [];
  const lineCount = textFile ? textFile.content.split('\n').length : 0;
  const localReady = ready && !unsaved;
  const changePdfWidth = (w: number) => setPdfWidth(clampPdf(w));
  const statusMessage = state;
  const phaseName: Record<CompilePhase, string> = {
    checking: '分析工程依赖', loading: '准备宏包资源',
    initializing: '初始化编译器', compiling: '生成 PDF', finishing: '整理 PDF'
  };
  const choosePdfRenderer = (renderer: 'native' | 'pdfjs') => {
    setPdfRenderer(renderer);
    try { localStorage.setItem('aldine.local.pdfRenderer', renderer); } catch { /* private mode */ }
  };
  return (
    <div className={"editor-shell browser-aldine" + (showProjects ? " browser-aldine--home" : "")} data-testid="editor-shell">
      <div className="browser-aldine__editing" hidden={showProjects}>
      <header className="toolbar browser-aldine__toolbar">
        <button className="btn btn--ghost" disabled={busy || !ready} onClick={() => void showProjectList()} title="返回工程列表" aria-label="返回工程列表"><IconChevronLeft /></button>
        <button className="btn" type="button" data-testid="open-projects" disabled={!ready || busy} onClick={() => void showProjectList()}>我的工程</button>
        <input className="toolbar__name browser-aldine__project" value={workspace.name}
          aria-label="项目名称" onChange={(e) => update({ name: e.target.value.slice(0, 100) })} />
        <span className="browser-aldine__branch" title="工程保存在当前浏览器，不通过服务器同步">本地项目</span>
        <span className="toolbar__spacer" />
        <label className="browser-aldine__tool-label" htmlFor="browser-engine">编译器</label>
        <select id="browser-engine" className="browser-aldine__engine"
          value={workspace.engine} onChange={(e) => update({ engine: e.target.value as Engine })}>
          <option value="xelatex">XeLaTeX</option>
          <option value="pdflatex">pdfLaTeX</option>
          <option value="lualatex">LuaLaTeX</option>
        </select>
        <label className="browser-aldine__tool-label" htmlFor="browser-bundle">本地宏包</label>
        <select id="browser-bundle" aria-label="TeX Live 资源包" className="browser-aldine__engine"
          disabled={busy} value={resourceTier}
          onChange={(e) => {
            const next = e.target.value as 'basic' | 'recommended' | 'extra';
            setResourceTier(next);
            try { localStorage.setItem('everflow.busytex.resourceTier', next); } catch {}
          }}>
          <option value="basic">基础（约 90 MB）</option>
          <option value="recommended">推荐（再加 192 MB）</option>
          <option value="extra">扩展（再加约 518 MB）</option>
        </select>
        <button className="btn btn--ghost browser-aldine__minor" onClick={() => setSidebarHidden((v) => !v)}>
          {sidebarHidden ? '显示文件' : '隐藏文件'}
        </button>
        <button className="btn btn--ghost browser-aldine__minor" title="切换 Aldine 明暗主题" onClick={() => toggleTheme()}>主题</button>
        <button className="btn browser-aldine__minor" disabled={busy} onClick={() => zipRef.current?.click()}>导入 ZIP</button>
        <button className="btn browser-aldine__minor" disabled={busy} onClick={() => void exportZip()}>导出 ZIP</button>
        <button className="btn browser-aldine__minor" type="button" data-testid="preflight-open" onClick={auditWorkspace}>检查模板依赖</button>
        <div className="toolbar__group">
          <button className="btn btn--primary" onClick={() => void compile()} disabled={!ready || busy}
            aria-busy={busy} data-testid="browser-compile" title="浏览器 XeLaTeX 编译（Ctrl/⌘ + S）">
            {busy && <span className="spinner" />}
            {busy ? '编译中 · ' + formatCompileTime(elapsedSeconds) : '编译'}
          </button>
        </div>
      </header>

      {compileStatus === 'compiling' && compileEstimate && <div className="browser-aldine__compile-progress" role="timer" aria-label="本地编译预计时间" data-testid="compile-eta">
        <span className="browser-aldine__phase">{phaseName[compilePhase]}</span>
        <span>已用 {formatCompileTime(elapsedSeconds)}</span>
        <strong>{describeCompileEstimate(compileEstimate, elapsedSeconds)}</strong>
        <span className="browser-aldine__estimate-note">仅估算 · 首次加载/字体缓存可能较慢</span>
      </div>}
      <div className="browser-aldine__info" role="status">
        <span className="browser-aldine__status-text" title={statusMessage}>{statusMessage}</span>
        <span className="browser-aldine__save">{localReady ? '✓ 本地已保存' : '○ 正在保存'}</span>
        <span className="browser-aldine__cache" data-testid="busytex-cache-status" title={cacheHint}>{cacheHint}</span>
        <span className="browser-aldine__info-spacer" />
        <span className="browser-aldine__mode">WebAssembly · 离线编译</span>
      </div>

      <div className={'workspace browser-aldine__workspace' + (resizing ? ' workspace--resizing' : '')}>
        <aside className={'pane sidebar' + (sidebarHidden ? ' sidebar--hidden' : '')} data-testid="sidebar">
          <div className="sidebar__tabs" role="tablist" aria-label="文件面板">
            <button role="tab" aria-selected="true" className="sidebar__tab sidebar__tab--active">文件</button>
            <button role="tab" aria-selected="false" className="sidebar__tab"
              onClick={() => setShowLog((v) => !v)}>日志</button>
          </div>
          <div className="sidebar__body browser-aldine__tree" data-testid="file-tree">
            <div className="browser-aldine__root">
              <span>项目文件</span><small>{workspace.files.length}</small>
            </div>
            <BrowserFileTree files={workspace.files} folders={workspace.folders || []} active={active}
              root={workspace.rootFile} selectedFolder={selectedFolder} disabled={busy}
              onSelect={path => { setActive(path); setSelectedFolder(path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''); }}
              onFolder={setSelectedFolder} onRoot={path => { update({ rootFile: path }); setActive(path); }}
              onRename={renamePath} onDelete={deletePath} />
            <div className="browser-aldine__folder-target" title={selectedFolder || '项目根目录'}>当前位置：{selectedFolder || '项目根目录'}</div>
            <div className="tree__actions browser-aldine__actions">
              <button className="btn btn--ghost btn--small" disabled={busy} onClick={createFile}>新建文件</button>
              <button className="btn btn--ghost btn--small" data-testid="create-folder" disabled={busy} onClick={createFolder}>新建文件夹</button>
              <button className="btn btn--ghost btn--small" disabled={busy} onClick={() => folderUploadRef.current?.click()}>上传文件夹</button>
              <button className="btn btn--ghost btn--small" disabled={busy} onClick={() => uploadRef.current?.click()}>↑ 上传</button>
              <button className="btn btn--ghost btn--small" disabled={busy} onClick={() => zipRef.current?.click()}>导入 ZIP</button>
              <button className="btn btn--ghost btn--small" disabled={busy} onClick={() => void exportZip()}>导出 ZIP</button>
              <button className="btn btn--ghost btn--small" type="button" onClick={auditWorkspace}>检查模板</button>
              <button className="btn btn--ghost btn--small" type="button" disabled={busy} onClick={repairNames}>修复旧中文名称</button>
            </div>
            <div className="browser-aldine__settings">
              <label htmlFor="browser-main-file">主文档</label>
              <select id="browser-main-file" value={workspace.rootFile} onChange={(e) => {
                update({ rootFile: e.target.value }); setActive(e.target.value);
              }}>
                {workspace.files.filter((file) => /\.tex$/i.test(file.path) && isText(file)).map((file) =>
                  <option key={file.path} value={file.path}>{file.path}</option>)}
              </select>
              <details><summary>更多编译设置</summary>
              <label className="browser-aldine__package-toggle">
                <input type="checkbox" checked={allowPackages} onChange={(e) => setAllowPackages(e.target.checked)} />
                自动获取缺失宏包
              </label>
              <p>编译引擎和基础／推荐／扩展宏包来自本站 GitHub Pages。选择较大资源包会增加下载和内存占用，超出这些资源包的字体或宏包仍需按需联网；完整 TeX Live 尚未离线镜像。工程只存储在本机浏览器，请定期导出 ZIP。</p>
              </details>
            </div>
          </div>
          <section className="browser-aldine__outline" data-testid="file-outline" aria-label="文件大纲">
            <h3>文件大纲</h3>
            {outline.length ? outline.map((item, i) => <button key={i} className="btn btn--ghost" style={{ paddingLeft: 12 + Math.max(0, item.level - 2) * 12 }} onClick={() => setJump({line: item.line, tick: Date.now()})}>{item.title}</button>) : <p>当前文件没有章节标题</p>}
          </section>
        </aside>

        <main className="pane pane--editor browser-aldine__source">
          <div className="pane__header">
            <span className="statusbar__file" data-testid="active-file">{active}</span>
            <span className="toolbar__spacer" />
            {current && <button className="btn btn--ghost btn--small" onClick={() => saveAs(
              new Blob([typeof current.content === 'string' ? current.content : new Uint8Array(current.content)]),
              current.path.split('/').pop() || 'main.tex')}>下载文件</button>}
            <span className="pdf-status">{lineCount} 行</span>
          </div>
          {textFile && !showProjects
            ? <PaneBoundary resetKey={active} fallback={<div className="browser-editor-loading" role="alert"><p>编辑器资源已更新，请重新打开页面。</p><button className="btn" onClick={() => void flushProject().then(() => location.reload()).catch(error => setState('保存失败：' + String(error)))}>保存并重新加载</button></div>}><Suspense fallback={<div className="browser-editor-loading">正在准备编辑器…</div>}><OfflineCodePane key={active} path={active} value={textFile.content}
                jump={jump} onChange={(value) => updateFile(active, value)} onCompile={() => void compile()} /></Suspense></PaneBoundary>
            : <div className="pdf-empty"><p>{current ? '二进制资源不能直接编辑，可在编译时引用。' : '选择文件开始编辑。'}</p></div>}
        </main>

        <div className={'resizer' + (resizing ? ' resizer--drag' : '')}
          role="separator" aria-orientation="vertical" aria-label="调整 PDF 预览宽度"
          aria-valuenow={Math.round(pdfWidth)} aria-valuemin={260}
          aria-valuemax={Math.max(280, window.innerWidth - 540)} tabIndex={0}
          onPointerDown={(e) => {
            if (e.button !== 0 || window.innerWidth < 760) return;
            e.preventDefault();
            const node = e.currentTarget;
            node.setPointerCapture(e.pointerId);
            const initialX = e.clientX, initialWidth = pdfWidth;
            setResizing(true);
            const move = (ev: PointerEvent) => changePdfWidth(initialWidth + initialX - ev.clientX);
            const up = () => {
              setResizing(false); node.removeEventListener('pointermove', move);
              node.removeEventListener('pointerup', up); node.removeEventListener('pointercancel', up);
            };
            node.addEventListener('pointermove', move);
            node.addEventListener('pointerup', up);
            node.addEventListener('pointercancel', up);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft') changePdfWidth(pdfWidth + 25);
            if (e.key === 'ArrowRight') changePdfWidth(pdfWidth - 25);
          }}
          onDoubleClick={() => changePdfWidth(window.innerWidth * .40)}
        />

        <section className="pane pane--preview browser-aldine__preview" style={{ width: pdfWidth, flex: 'none' }}>
          <div className="pane__header browser-aldine__preview-head">
            <div className="browser-aldine__output-tabs" role="tablist" aria-label="编译输出">
              <button role="tab" aria-selected={!showLog} className="btn btn--small" onClick={() => setShowLog(false)}>PDF</button>
              <button role="tab" aria-selected={showLog} className="btn btn--small" onClick={() => {setShowLog(true); setShowPreflight(false);}}>日志 {compileIssues.length ? compileIssues.length : ''}</button>
            </div>
            <span className="pdf-status">
              {compileStatus === 'compiling' ? '编译中' : compileStatus === 'ok' ? '已编译' : compileStatus === 'error' ? '编译失败' : '尚未编译'}
            </span>
            <span className="toolbar__spacer" />
            <label className="browser-aldine__preview-mode" title="浏览器内核更适合预览含中文字体的 XeLaTeX PDF">
              <span>预览模式</span>
              <select aria-label="PDF 预览模式" value={pdfRenderer}
                onChange={(e) => choosePdfRenderer(e.target.value as 'native' | 'pdfjs')}>
                <option value="native">浏览器（中文兼容）</option>
                <option value="pdfjs">Aldine PDF.js</option>
              </select>
            </label>
            {pdfRenderer === 'pdfjs' && <div className="zoom" aria-label="调整 PDF 缩放">
              <button className="btn btn--small" aria-label="缩小 PDF" onClick={() => setZoom((v) => Math.max(.5, v - .1))}>−</button>
              <span className="zoom__label">{Math.round(zoom * 100)}%</span>
              <button className="btn btn--small" aria-label="放大 PDF" onClick={() => setZoom((v) => Math.min(3, v + .1))}>＋</button>
            </div>}
            {previewUrl && <a className="btn btn--small" href={previewUrl}
              download={(workspace.name || 'everflow').replace(/[\\/:*?"<>|]/g, '-') + '.pdf'}>下载 PDF</a>}
            <button className="btn btn--ghost btn--small" onClick={() => setShowLog((v) => !v)}>日志</button>
          </div>
          <div className="browser-aldine__pdf-content" hidden={showLog}>
          {!previewUrl ? <div className="browser-ws__empty" data-testid="pdf-empty"><strong>{compileStatus === 'compiling' ? '正在编译…' : 'PDF 预览'}</strong><span>点击编译后在此查看 PDF</span></div>
            : pdfRenderer === 'native' ? <iframe key={previewUrl} className="browser-aldine__native-pdf"
                title="浏览器原生 PDF 预览（兼容中文嵌入字体）" data-testid="pdf-native" src={previewUrl + '#view=FitH&navpanes=0'} />
            : <PaneBoundary resetKey={previewUrl} fallback={<iframe className="browser-aldine__native-pdf" data-testid="pdf-fallback" title="备用浏览器 PDF 预览" src={previewUrl + '#view=FitH&navpanes=0'} />}><Suspense fallback={<div className="browser-editor-loading">正在准备 PDF 预览…</div>}><PdfPane pdfUrl={previewUrl} branch={workspace.projectId || 'local'} status={compileStatus} zoom={zoom}
                locale="zh" stale={compileStatus === 'error'} ready={ready} hasTex={true} onFirstOpen={() => {}} /></Suspense></PaneBoundary>}
          {pdfRenderer === 'native' && previewUrl && (
            <div className="browser-aldine__pdfhint" role="note">
              中文文字由浏览器 PDF 内核渲染。如果当前浏览器仍不显示，请点击「下载 PDF」使用系统阅读器。
            </div>
          )}
          </div>
      {showLog && <section className="browser-aldine__log-panel" aria-label="编译日志">
        <div className="pane__header">
          <strong>编译日志</strong>
          <span className="toolbar__spacer" />
          <button className="btn btn--ghost btn--small" onClick={() => setShowLog(false)}>收起</button>
        </div>
        {compileIssues.length > 0 && <div className="browser-aldine__diagnostics" data-testid="compile-issues">
          <strong>诊断提示（依据编译日志推断）</strong>
          <button className="btn btn--small" disabled={busy} data-testid="retry-compile" onClick={() => { runnerRef.current?.terminate(); runnerRef.current = null; engineRef.current = null; void compile(); }}>重新初始化并编译</button>
          {compileIssues.map((issue, i) => <div key={i}
              className={'browser-aldine__diagnostic browser-aldine__diagnostic--' + issue.level}>
              <b>{issue.level === 'error' ? '错误' : '注意'} · {issue.title}</b>
              <span>{issue.advice}</span>
            </div>)}
        </div>}
        <pre data-testid="browser-compile-log">{errorLog || '尚无编译日志。'}</pre>
      </section>}
        </section>
      </div>
      {showPreflight && preflight && <section className="browser-aldine__preflight" data-testid="preflight-panel">
        <div className="pane__header">
          <strong>LaTeX 模板依赖检查（静态分析）</strong>
          <span className="toolbar__spacer" />
          <button type="button" className="btn btn--ghost btn--small" onClick={() => setShowPreflight(false)}>关闭</button>
        </div>
        <div className="browser-aldine__preflight-content">
          <div className="browser-aldine__preflight-summary">
            <span>{preflight.isEverflow ? '已识别 Everflow 原版工程' : '普通 LaTeX 工程'}</span>
            <span>{preflight.packages.length} 个直接依赖宏包</span>
            <span>{preflight.fontNames.length} 个字体候选</span>
            <span>{preflight.imageCount} 个图像资源</span>
            <span>建议资源：{coverage ? (coverage.suggested === 'extra' ? '扩展' : coverage.suggested === 'recommended' ? '推荐' : '基础') : '索引核对中'}</span>
          </div>
          {preflight.entrypoints.length > 0 && <div className="browser-aldine__preflight-row">
            <b>编译入口</b><span>{preflight.entrypoints.join('　|　')}</span>
          </div>}
          <div className="browser-aldine__preflight-row">
            <b>宏包依赖</b><span>{preflight.packages.join('、') || '未声明宏包'}</span>
          </div>
          <div className="browser-aldine__preflight-row" data-testid="preflight-coverage">
            <b>GitHub 宏包归属</b>
            <div>
              <p>{coverageState}</p>
              {coverage && <>
                <div className="browser-aldine__preflight-summary">
                  <span>Basic：{coverage.byTier.basic}</span>
                  <span>Recommended：{coverage.byTier.recommended}</span>
                  <span>Extra：{coverage.byTier.extra}</span>
                  <span>工程自带：{coverage.byTier.local}</span>
                  <span>尚未列出：{coverage.byTier.unlisted}</span>
                </div>
                <p>{coverage.note}</p>
                {coverage.suggested !== resourceTier && <button className="btn btn--small" type="button" disabled={busy}
                  title="仅改变下次编译的资源档位，不会立刻下载宏包"
                  onClick={() => { setResourceTier(coverage.suggested); try { localStorage.setItem('everflow.busytex.resourceTier', coverage.suggested); } catch {} }}>
                  设为建议的{coverage.suggested === 'extra' ? '扩展' : coverage.suggested === 'recommended' ? '推荐' : '基础'}资源档位（下次编译生效）
                </button>}
                {coverage.matches.filter(item => item.tier !== 'basic' && item.tier !== 'local').length > 0 &&
                  <p>{coverage.matches.filter(item => item.tier !== 'basic' && item.tier !== 'local')
                    .map(item => item.name + '（' + ({ recommended: '推荐', extra: '扩展', unlisted: '目录外' } as Record<string,string>)[item.tier] + '）').join('、')}</p>}
              </>}
            </div>
          </div>
          <div className="browser-aldine__preflight-row">
            <b>字体候选</b><span>{preflight.fontNames.join('、') || '未指定字体'}</span>
          </div>
          {preflight.warnings.map((issue, i) => <div key={i}
            className={'browser-aldine__preflight-issue browser-aldine__preflight-issue--' + issue.severity}>
            <b>{issue.severity === 'error' ? '错误' : issue.severity === 'warning' ? '注意' : '提示'}</b>
            <span>{issue.message}{issue.file ? '：' + issue.file : ''}</span>
          </div>)}
          <p>说明：静态扫描不代表宏包或字体已经安装；是否支持 XeLaTeX、中文、TikZ 和完整页数，必须用 BusyTeX 实际编译检验。</p>
        </div>
      </section>}
      </div>
      {showProjects && <BrowserProjects records={projectRecords} current={workspace.projectId} pending={busy || !ready}
        onClose={() => setShowProjects(false)} onUpload={() => zipRef.current?.click()} onNew={() => void newProject()}
        onOpen={id => void openSavedProject(id)} onZip={id => void downloadOriginal(id)} onDeleteZip={id => void eraseZip(id)}
        onTrash={id => void trashProject(id)} onRestore={id => void projectAction(async () => { await setProjectStatus(id, 'active'); })}
        onDelete={id => void eraseProject(id)} />}
      <input ref={folderUploadRef} type="file" multiple hidden {...{ webkitdirectory: '', directory: '' }} onChange={async e => {
        await addFiles(e.target.files); e.target.value = '';
      }} />
      <input ref={uploadRef} type="file" multiple hidden onChange={async (e) => {
        await addFiles(e.target.files); e.target.value = '';
      }} />
      <input ref={zipRef} type="file" accept=".zip,application/zip" hidden onChange={async (e) => {
        await importZip(e.target.files?.[0]); e.target.value = '';
      }} />
    </div>
  );
}
