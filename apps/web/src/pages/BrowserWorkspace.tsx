import { useEffect, useRef, useState } from 'react';
import { BASE_PATH } from '../basePath';
import OfflineCodePane from '../components/OfflineCodePane';
import PdfPane from '../components/PdfPane';
import { IconChevronLeft } from '../components/Icons';
import { toggleTheme } from '../theme';
import { scanLatexDependencies } from '../util/latex-preflight';
import type { PreflightResult } from '../util/latex-preflight';
import { assessTeXLiveCoverage } from '../util/texlive-manifest';
import type { TeXLiveCoverage } from '../util/texlive-manifest';
import './BrowserWorkspace.css';

// Browser-only projects deliberately bypass Aldine's server-only API, auth and Yjs.
type Engine = 'xelatex' | 'pdflatex' | 'lualatex';
type UserFile = { path: string; content: string | Uint8Array };
type Workspace = { name: string; rootFile: string; engine: Engine; files: UserFile[] };
type BusyCompiler = { compile(options: Record<string, unknown>): Promise<{ success: boolean; pdf?: Uint8Array; log?: string; exitCode?: number }> };
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
// ZIP central-directory preflight: bound inflated size before passing data to fflate.
function validateZip(buffer: Uint8Array): void {
  if (buffer.byteLength > 32 * 1024 * 1024) throw new Error('ZIP 压缩包不能超过 32 MB');
  const dv = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  let eocd = -1;
  for (let p = buffer.length - 22; p >= Math.max(0, buffer.length - 65557); p--) {
    if (dv.getUint32(p, true) === 0x06054b50) { eocd = p; break; }
  }
  if (eocd < 0) throw new Error('找不到 ZIP 目录，文件可能损坏');
  const count = dv.getUint16(eocd + 10, true);
  if (count > 300 || count === 65535) throw new Error('ZIP 文件数过多或 ZIP64 格式不受支持');
  let p = dv.getUint32(eocd + 16, true);
  let total = 0;
  for (let i = 0; i < count; i++) {
    if (p + 46 > buffer.length || dv.getUint32(p, true) !== 0x02014b50) throw new Error('ZIP 中央目录格式错误');
    const flags = dv.getUint16(p + 8, true);
    const method = dv.getUint16(p + 10, true);
    const size = dv.getUint32(p + 24, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    total += size;
    if (flags & 1) throw new Error('不支持带密码的 ZIP');
    if (method !== 0 && method !== 8) throw new Error('ZIP 使用了不支持的压缩算法');
    if (total > 80 * 1024 * 1024 || size > 25 * 1024 * 1024) throw new Error('ZIP 解压后资源过大，请精简图片或字体');
    p += 46 + nameLen + extraLen + commentLen;
    if (p > buffer.length) throw new Error('ZIP 中央目录超过文件边界');
  }
}

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
async function readWorkspace(): Promise<Workspace | null> {
  const db = await dbOpen();
  try {
    const tx = db.transaction('data', 'readonly');
    const value = await request(tx.objectStore('data').get(DB_KEY));
    return value && Array.isArray(value.files) ? value as Workspace : null;
  } finally { db.close(); }
}
async function persistWorkspace(w: Workspace): Promise<void> {
  const db = await dbOpen();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('data', 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
      tx.objectStore('data').put(w, DB_KEY);
    });
  } finally { db.close(); }
}
function isText(file: UserFile): file is { path: string; content: string } {
  return typeof file.content === 'string';
}
function safePath(input: string): string | null {
  const p = input.replace(/\\/g, '/').replace(/^\/+/, '').trim();
  if (!p || p.includes('\0') || p.length > 240 || p.split('/').some((x) => x === '..' || x === '.' || !x)) return null;
  return p;
}
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

export default function BrowserWorkspace() {
  const [workspace, setWorkspace] = useState<Workspace>(fresh);
  const [active, setActive] = useState('main.tex');
  const [ready, setReady] = useState(false);
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
  const [showPreflight, setShowPreflight] = useState(false);
  const [preflight, setPreflight] = useState<PreflightResult | null>(null);
  const [coverage, setCoverage] = useState<TeXLiveCoverage | null>(null);
  const [coverageState, setCoverageState] = useState('尚未查询本站 TeX Live 资源目录。');
  const [sidebarHidden, setSidebarHidden] = useState(false);
  const [zoom, setZoom] = useState(1);
  // PDF.js can omit subset-embedded Chinese CID glyphs (e.g. FandolSong).
  // Chromium/Edge native PDFium is the safer default for XeLaTeX CJK output.
  const [pdfRenderer, setPdfRenderer] = useState<'native' | 'pdfjs'>(() => {
    try { return localStorage.getItem('aldine.local.pdfRenderer') === 'pdfjs' ? 'pdfjs' : 'native'; }
    catch { return 'native'; }
  });
  const [compileStatus, setCompileStatus] = useState<'idle' | 'compiling' | 'ok' | 'error'>('idle');
  const [pdfWidth, setPdfWidth] = useState(() => Math.max(330, Math.round(window.innerWidth * .40)));
  const [resizing, setResizing] = useState(false);
  const clampPdf = (w: number) => Math.min(Math.max(260, w), Math.max(280, window.innerWidth - (sidebarHidden ? 390 : 540)));
  const [cacheHint, setCacheHint] = useState('正在检查编译资源缓存…');
  const cacheSetup = useRef<Promise<any> | null>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const zipRef = useRef<HTMLInputElement>(null);
  const runnerRef = useRef<BusyRunner | null>(null);
  const engineRef = useRef<Record<Engine, BusyCompiler> | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(workspace);
  latest.current = workspace;
  const previewRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    readWorkspace().then((stored) => {
      if (cancelled) return;
      if (stored) {
        setWorkspace(stored);
        setActive(stored.rootFile);
      }
      setState(stored ? '本地工程已恢复。' : '新建本地工程。');
      setReady(true);
    }).catch((err: unknown) => {
      if (cancelled) return;
      setState('浏览器存储不可用：可临时编译，但离开页面后可能丢失文件。' + String(err));
      setReady(true);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!ready) return;
    setUnsaved(true);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      persistWorkspace(latest.current)
        .then(() => setUnsaved(false))
        .catch((err: unknown) => { setUnsaved(true); setState('自动保存失败：' + String(err)); });
    }, 500);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [workspace, ready]);

  useEffect(() => {
    let mounted = true;
    cacheSetup.current = import(/* @vite-ignore */ BASE_PATH + '/busytex-cache.mjs')
      .then(async (lib) => {
        const cache = await lib.prepareBusyTeXCache((progress: { phase: string; granted?: boolean; file?: string; message?: string }) => {
          if (!mounted) return;
          if (progress.phase === 'evicted') setCacheHint('检测到本机编译资源被清理，正在自动恢复…');
          if (progress.phase === 'repairing') setCacheHint('自动补全缺失的编译资源：' + (progress.file || ''));
          if (progress.phase === 'restored') setCacheHint('被清理的编译资源已自动恢复。');
          if (progress.phase === 'repair-failed') setCacheHint('缓存自动修复未完成，下次编译将尝试重新获取资源。');
          if (progress.phase === 'persistence') setCacheHint(progress.granted
            ? '浏览器已允许持久存储；手动清理网站数据仍会删除缓存。'
            : '浏览器尚未授予持久存储；资源仍会自动缓存，但可能被系统清理。');
        });
        // Emscripten can already hold TeX Live .data in IndexedDB before our new
        // Service Worker was introduced. Don't label that state as "downloading".
        let legacyPackageCached = false;
        if (!cache.coreCached) {
          try {
            const busytex = await import(/* @vite-ignore */ BUSYTEX_MODULE);
            legacyPackageCached = await busytex.isPackageCached(BUSYTEX_ASSETS + '/texlive-basic.js');
          } catch { /* The editor remains usable without a cache-status probe. */ }
        }
        if (mounted) setCacheHint(cache.coreCached
          ? cache.persistent
            ? '已自动启用持久存储，编译资源完整，下次打开仅需初始化。'
            : '编译资源完整且已缓存；持久存储由浏览器决定。'
          : legacyPackageCached
            ? '基础宏包已保存在 IndexedDB；其他资源将在编译时自动缓存。'
            : '当前编译资源不完整，首次编译时自动补齐并保存到本机。');
        return { ...cache, legacyPackageCached };
      }).catch(() => {
        if (mounted) setCacheHint('缓存功能不可用；编译仍可尝试。');
        return null;
      });
    return () => { mounted = false; };
  }, []);

  useEffect(() => () => {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    runnerRef.current?.terminate();
  }, []);

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
    const next: UserFile[] = [];
    let total = 0;
    for (const file of Array.from(list)) {
      const path = safePath(file.webkitRelativePath || file.name);
      if (!path) { setState('跳过不安全的文件路径。'); continue; }
      total += file.size;
      if (total > 30 * 1024 * 1024) { setState('单次导入最多 30 MB；大型资源请分批导入。'); return; }
      next.push({ path, content: TEXT_FILE.test(path) ? await file.text() : new Uint8Array(await file.arrayBuffer()) });
    }
    if (!next.length) return;
    setWorkspace((old) => {
      const map = new Map(old.files.map((f) => [f.path, f]));
      next.forEach((f) => map.set(f.path, f));
      const files = Array.from(map.values());
      const rootFile = map.has(old.rootFile) ? old.rootFile : (files.find((f) => f.path.endsWith('.tex'))?.path || old.rootFile);
      return { ...old, files, rootFile };
    });
    setActive(next.find((f) => isText(f))?.path || active);
    setState('已导入 ' + next.length + ' 个文件，仅保存在当前浏览器。');
  }
  async function importZip(input: File | undefined): Promise<void> {
    if (!input) return;
    if (!confirm('导入 ZIP 将替换当前浏览器工程。请先导出 ZIP 备份。确定继续吗？')) return;
    setBusy(true);
    setState('正在解析 ZIP 文件…');
    try {
      const bytes = new Uint8Array(await input.arrayBuffer());
      validateZip(bytes);
      const lib = await zipLibrary();
      const items = lib.unzipSync(bytes) as Record<string, Uint8Array>;
      const files: UserFile[] = [];
      const decoder = new TextDecoder('utf-8');
      for (const [name, data] of Object.entries(items)) {
        if (name.endsWith('/') || name.startsWith('__MACOSX/') || name.endsWith('/.DS_Store')) continue;
        const path = safePath(name);
        if (!path) throw new Error('ZIP 包含不安全的文件路径：' + name);
        files.push({ path, content: TEXT_FILE.test(path) ? decoder.decode(data) : data });
      }
      const candidates = files.filter((f) => /\.tex$/i.test(f.path) && isText(f));
      if (!candidates.length) throw new Error('ZIP 中没有 .tex 文件');
      const root = candidates.find((f) => /(^|\/)main\.tex$/i.test(f.path)) || candidates.find((f) => /(^|\/)root\.tex$/i.test(f.path)) || candidates[0];
      setWorkspace({ name: input.name.replace(/\.zip$/i, '').slice(0, 100), engine: 'xelatex', rootFile: root.path, files });
      setActive(root.path);
      setErrorLog('');
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
      const files: Record<string, Uint8Array> = {};
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
    const raw = prompt('请输入新文件名，例如 chapter.tex 或 preamble.sty');
    if (raw === null) return;
    const path = safePath(raw);
    if (!path) { setState('文件名无效，不能包含上级目录或绝对路径。'); return; }
    if (workspace.files.some((f) => f.path === path)) { setState('文件已存在。'); return; }
    setWorkspace((old) => ({ ...old, files: [...old.files, { path, content: '' }] }));
    setActive(path);
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
    if (busy) return;
    const main = workspace.files.find((f) => f.path === workspace.rootFile);
    if (!main || !isText(main)) { setState('请选择有效的 .tex 主文件。'); return; }
    setBusy(true);
    setCompileStatus('compiling');
    setShowLog(true);
    setState('正在检查编译资源缓存…');
    setErrorLog('');
    const started = performance.now();
    try {
      if (!runnerRef.current || !engineRef.current) {
        // Dynamic import intentionally points to the static library built from our fork.
        const libPath = BUSYTEX_MODULE;
        // Ensure the cache-first worker controls the page before requesting WASM assets.
        const status = await cacheSetup.current;
        const lib = await import(/* @vite-ignore */ libPath);
        const dataReady = typeof lib.isPackageCached === 'function'
          ? await lib.isPackageCached(BUSYTEX_ASSETS + '/texlive-basic.js').catch(() => false)
          : false;
        setState((status?.coreCached || dataReady)
          ? '正在从本地缓存恢复 XeLaTeX 引擎（仍需初始化 WebAssembly）…'
          : '首次加载编译资源，约 120 MB；以后优先使用浏览器缓存…');
        const runner = new lib.BusyTexRunner({
          busytexBasePath: BUSYTEX_ASSETS,
          engineMode: 'combined',
          preloadDataPackages: [BUSYTEX_ASSETS + '/texlive-basic.js'],
          onDownloadProgress: (p: { percent: number }) => setState('正在准备 TeX Live：' + p.percent + '%')
        }) as BusyRunner;
        try { await runner.initialize(true); }
        catch (e) { runner.terminate(); throw e; }
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
      setState('编译中：' + workspace.engine + '（计算在你的浏览器内进行）…');
      const others = workspace.files.filter((f) => f.path !== workspace.rootFile);
      // The pinned bundles are served by zuotiben.top itself via GitHub Pages.
      // The original on-demand remote endpoint remains an optional fallback for
      // packages outside TeX Live Basic/Recommended/Extra.
      const bundles = resourceTier === 'extra'
        ? [BUSYTEX_ASSETS + '/texlive-recommended.js', BUSYTEX_ASSETS + '/texlive-extra.js']
        : resourceTier === 'recommended'
          ? [BUSYTEX_ASSETS + '/texlive-recommended.js'] : [];
      if (bundles.length) setState(
        resourceTier === 'extra'
          ? '正在加载 GitHub 托管的推荐与扩展宏包（首次约 528 MB，仅当前设备下载）…'
          : '正在加载 GitHub 托管的推荐宏包（首次约 192 MB，仅当前设备下载）…'
      );
      const result = await engineRef.current[workspace.engine].compile({
        mainTexPath: workspace.rootFile,
        input: main.content,
        additionalFiles: others,
        dataPackagesJs: bundles.length ? bundles : undefined,
        rerun: true,
        verbose: 'info',
        remoteEndpoint: allowPackages ? PACKAGE_SERVICE : undefined
      });
      setErrorLog(result.log || '(无编译日志)');
      if (!result.success || !result.pdf?.length) {
        setCompileStatus('error');
        setState('编译失败：请查看日志，检查缺失字体或宏包。退出码：' + result.exitCode);
        return;
      }
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
      const data = new Uint8Array(result.pdf);
      const url = URL.createObjectURL(new Blob([data], { type: 'application/pdf' }));
      previewRef.current = url;
      setPreviewUrl(url);
      setCompileStatus('ok');
      setState('编译成功，耗时 ' + ((performance.now() - started) / 1000).toFixed(1) + ' 秒（含资源加载）。');
    } catch (err: unknown) {
      setCompileStatus('error');
      setErrorLog(err instanceof Error ? err.stack || err.message : String(err));
      setState('浏览器编译失败。请查看日志；手机内存不足或资源未就绪都可能导致失败。');
      runnerRef.current?.terminate();
      runnerRef.current = null;
      engineRef.current = null;
    } finally { setBusy(false); }
  }

  const current = workspace.files.find((f) => f.path === active);
  const textFile = current && isText(current) ? current : null;
  const lineCount = textFile ? textFile.content.split('\n').length : 0;
  const localReady = ready && !unsaved;
  const displayFiles = [...workspace.files].sort((a, b) => a.path.localeCompare(b.path, 'zh-CN'));
  const changePdfWidth = (w: number) => setPdfWidth(clampPdf(w));
  const statusMessage = state;
  const choosePdfRenderer = (renderer: 'native' | 'pdfjs') => {
    setPdfRenderer(renderer);
    try { localStorage.setItem('aldine.local.pdfRenderer', renderer); } catch { /* private mode */ }
  };
  return (
    <div className="editor-shell browser-aldine" data-testid="editor-shell">
      {/* Keep Aldine's toolbar, panes, CodeMirror editor and PDF renderer native.
          Only the storage/compile transport is swapped from Fastify to IndexedDB+BusyTeX. */}
      <header className="toolbar browser-aldine__toolbar">
        <a className="btn btn--ghost" href="/paper/" title="返回做题本" aria-label="返回做题本"><IconChevronLeft /></a>
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
            {busy ? '编译中…' : '编译'}
          </button>
        </div>
      </header>

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
            {displayFiles.map((file) => {
              const isRoot = file.path === workspace.rootFile;
              const isDir = file.path.includes('/');
              return (
                <div className={'browser-aldine__tree-row' + (active === file.path ? ' browser-aldine__tree-row--active' : '')} key={file.path}>
                  <button className={'tree__item' + (active === file.path ? ' tree__item--active' : '')}
                    title={file.path} data-testid={'file-' + file.path}
                    onClick={() => setActive(file.path)}>
                    <span className="tree__icon" aria-hidden="true">{isText(file) ? '▤' : '▧'}</span>
                    <span className="browser-aldine__filename">{isDir ? file.path : file.path.split('/').pop()}</span>
                    {isRoot && <span className="tree__root-tag">主</span>}
                  </button>
                  <button className="browser-aldine__tree-more" title={'设置 ' + file.path + ' 为主文件'}
                    disabled={!/\.tex$/i.test(file.path) || !isText(file)}
                    onClick={() => { update({ rootFile: file.path }); setActive(file.path); }}>☆</button>
                  <button className="browser-aldine__tree-more" title={'删除 ' + file.path}
                    disabled={isRoot} onClick={() => removeFile(file.path)}>×</button>
                </div>
              );
            })}
            <div className="tree__actions browser-aldine__actions">
              <button className="btn btn--ghost btn--small" onClick={createFile}>＋ 新建</button>
              <button className="btn btn--ghost btn--small" disabled={busy} onClick={() => uploadRef.current?.click()}>↑ 上传</button>
              <button className="btn btn--ghost btn--small" disabled={busy} onClick={() => zipRef.current?.click()}>导入 ZIP</button>
              <button className="btn btn--ghost btn--small" disabled={busy} onClick={() => void exportZip()}>导出 ZIP</button>
              <button className="btn btn--ghost btn--small" type="button" onClick={auditWorkspace}>检查模板</button>
            </div>
            <div className="browser-aldine__settings">
              <label htmlFor="browser-main-file">主文档</label>
              <select id="browser-main-file" value={workspace.rootFile} onChange={(e) => {
                update({ rootFile: e.target.value }); setActive(e.target.value);
              }}>
                {workspace.files.filter((file) => /\.tex$/i.test(file.path) && isText(file)).map((file) =>
                  <option key={file.path} value={file.path}>{file.path}</option>)}
              </select>
              <label className="browser-aldine__package-toggle">
                <input type="checkbox" checked={allowPackages} onChange={(e) => setAllowPackages(e.target.checked)} />
                自动获取缺失宏包
              </label>
              <p>编译引擎和基础／推荐／扩展宏包来自本站 GitHub Pages。选择较大资源包会增加下载和内存占用，超出这些资源包的字体或宏包仍需按需联网；完整 TeX Live 尚未离线镜像。工程只存储在本机浏览器，请定期导出 ZIP。</p>
            </div>
          </div>
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
          {textFile
            ? <OfflineCodePane key={active} path={active} value={textFile.content}
                onChange={(value) => updateFile(active, value)} onCompile={() => void compile()} />
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
            <span className="pane__title">PDF 预览</span>
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
          {pdfRenderer === 'native' && previewUrl
            ? <iframe key={previewUrl} className="browser-aldine__native-pdf"
                title="浏览器原生 PDF 预览（兼容中文嵌入字体）" data-testid="pdf-native"
                src={previewUrl} />
            : <PdfPane pdfUrl={previewUrl} branch="local" status={compileStatus} zoom={zoom}
                locale="zh" stale={compileStatus === 'error' && !!previewUrl} ready={ready}
                hasTex={workspace.files.some(f => /\.tex$/i.test(f.path))}
                onFirstOpen={() => { /* No surprise 120MB WASM download until user clicks 编译. */ }} />}
          {pdfRenderer === 'native' && previewUrl && (
            <div className="browser-aldine__pdfhint" role="note">
              中文文字由浏览器 PDF 内核渲染。如果当前浏览器仍不显示，请点击「下载 PDF」使用系统阅读器。
            </div>
          )}
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
            <span>建议资源：{preflight.recommendedTier === 'recommended' ? '推荐' : '基础'}</span>
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
      {showLog && <section className="browser-aldine__log-panel" aria-label="编译日志">
        <div className="pane__header">
          <strong>编译日志</strong>
          <span className="toolbar__spacer" />
          <button className="btn btn--ghost btn--small" onClick={() => setShowLog(false)}>收起</button>
        </div>
        <pre data-testid="browser-compile-log">{errorLog || '尚无编译日志。'}</pre>
      </section>}
      <input ref={uploadRef} type="file" multiple hidden onChange={async (e) => {
        await addFiles(e.target.files); e.target.value = '';
      }} />
      <input ref={zipRef} type="file" accept=".zip,application/zip" hidden onChange={async (e) => {
        await importZip(e.target.files?.[0]); e.target.value = '';
      }} />
    </div>
  );
}
