import { useEffect, useRef, useState } from 'react';
import { BASE_PATH } from '../basePath';
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
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [unsaved, setUnsaved] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const uploadRef = useRef<HTMLInputElement>(null);
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
  async function compile(): Promise<void> {
    if (busy) return;
    const main = workspace.files.find((f) => f.path === workspace.rootFile);
    if (!main || !isText(main)) { setState('请选择有效的 .tex 主文件。'); return; }
    setBusy(true);
    setShowLog(true);
    setState('正在准备浏览器编译器，首次加载需要下载约 120 MB 资源…');
    setErrorLog('');
    const started = performance.now();
    try {
      if (!runnerRef.current || !engineRef.current) {
        // Dynamic import intentionally points to the static library built from our fork.
        const libPath = BUSYTEX_MODULE;
        const lib = await import(/* @vite-ignore */ libPath);
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
      setState('编译中：' + workspace.engine + '（计算在你的浏览器内进行）…');
      const others = workspace.files.filter((f) => f.path !== workspace.rootFile);
      const result = await engineRef.current[workspace.engine].compile({
        mainTexPath: workspace.rootFile,
        input: main.content,
        additionalFiles: others,
        rerun: true,
        verbose: 'info',
        remoteEndpoint: allowPackages ? PACKAGE_SERVICE : undefined
      });
      setErrorLog(result.log || '(无编译日志)');
      if (!result.success || !result.pdf?.length) {
        setState('编译失败：请查看日志，检查缺失字体或宏包。Exit code: ' + result.exitCode);
        return;
      }
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
      const data = new Uint8Array(result.pdf);
      const url = URL.createObjectURL(new Blob([data], { type: 'application/pdf' }));
      previewRef.current = url;
      setPreviewUrl(url);
      setState('编译成功，耗时 ' + ((performance.now() - started) / 1000).toFixed(1) + ' 秒（含资源加载）。');
    } catch (err: unknown) {
      setErrorLog(err instanceof Error ? err.stack || err.message : String(err));
      setState('浏览器编译失败。请查看日志；手机内存不足或资源未就绪都可能导致失败。');
      runnerRef.current?.terminate();
      runnerRef.current = null;
      engineRef.current = null;
    } finally { setBusy(false); }
  }

  const current = workspace.files.find((f) => f.path === active);
  const textFile = current && isText(current) ? current : null;
  return (
    <div className="browser-ws">
      <header className="browser-ws__top">
        <a className="browser-ws__brand" href={BASE_PATH + '/'}>aldine<em>.</em><span> / 本地工作区</span></a>
        <span className="browser-ws__chip">浏览器编译 · 无后端</span>
        <span className="browser-ws__grow" />
        <a className="btn btn--small" href={BASE_PATH + '/'}>返回项目首页</a>
        <a className="btn btn--small" href="/paper/">做题本</a>
        <a className="btn btn--small" href="https://github.com/EverflowCN/aldine" target="_blank" rel="noopener noreferrer">项目源码</a>
      </header>
      <div className="browser-ws__note">
        <strong>本地模式</strong>：文件保存在当前浏览器 IndexedDB，不会同步云端；不要清除网站数据。首次编译需下载引擎和宏包，字体兼容性需实测。暂不提供多人协作、Git 和 ZIP 项目导入。
      </div>
      <div className="browser-ws__toolbar">
        <input aria-label="工程名称" className="browser-ws__name" value={workspace.name} onChange={(e) => update({ name: e.target.value.slice(0, 100) })} />
        <label className="browser-ws__label">编译器
          <select className="browser-ws__select" value={workspace.engine} onChange={(e) => update({ engine: e.target.value as Engine })}>
            <option value="xelatex">XeLaTeX</option><option value="pdflatex">pdfLaTeX</option><option value="lualatex">LuaLaTeX</option>
          </select>
        </label>
        <label className="browser-ws__label"><input type="checkbox" checked={allowPackages} onChange={(e) => setAllowPackages(e.target.checked)} />按需下载宏包</label>
        <span className="browser-ws__grow" />
        <button className="btn" onClick={insertChineseDemo} disabled={busy} title="覆盖主文件，仅用于中文兼容测试">中文测试</button>
        <button className="btn btn--primary" onClick={compile} disabled={!ready || busy} aria-busy={busy} data-testid="browser-compile">{busy ? '编译中…' : '编译 PDF'}</button>
        {previewUrl && <a className="btn" href={previewUrl} download={(workspace.name || 'everflow').replace(/[\\/:*?"<>|]/g, '-') + '.pdf'}>下载 PDF</a>}
      </div>
      <div className="browser-ws__status" role="status">{state} {unsaved ? '· 保存中' : '· 已保存'}</div>
      <div className="browser-ws__body">
        <aside className="browser-ws__sidebar">
          <div className="browser-ws__section">工程文件 <span>{workspace.files.length}</span></div>
          <div className="browser-ws__files">
            {workspace.files.map((f) => <div className={'browser-ws__file' + (active === f.path ? ' browser-ws__file--active' : '')} key={f.path}>
              <button title={f.path} onClick={() => setActive(f.path)}>{f.path === workspace.rootFile ? '◆ ' : '· '}{f.path}</button>
              <button aria-label={'删除 ' + f.path} className="browser-ws__remove" onClick={() => removeFile(f.path)}>×</button>
            </div>)}
          </div>
          <div className="browser-ws__filebuttons">
            <button className="btn btn--small" onClick={createFile}>新建</button>
            <button className="btn btn--small" onClick={() => uploadRef.current?.click()}>导入文件</button>
            <input ref={uploadRef} type="file" multiple hidden onChange={async (e) => { await addFiles(e.target.files); e.target.value = ''; }} />
          </div>
          <label className="browser-ws__rootlabel">主文件
            <select className="browser-ws__select" value={workspace.rootFile} onChange={(e) => { update({ rootFile: e.target.value }); setActive(e.target.value); }}>
              {workspace.files.filter((f) => /\.tex$/i.test(f.path) && isText(f)).map((f) => <option key={f.path} value={f.path}>{f.path}</option>)}
            </select>
          </label>
          <p className="browser-ws__small">支持导入 .tex、.sty、.cls、.bib 和图片。复杂项目请逐个添加文件。用户自行确保所用字体/宏包可在 BusyTeX 中使用。</p>
        </aside>
        <section className="browser-ws__editor">
          <div className="browser-ws__panehead"><span>{active}</span><span className="browser-ws__grow" />
            {current && <button className="btn btn--small" onClick={() => saveAs(new Blob([current.content instanceof Uint8Array ? new Uint8Array(current.content) : current.content]), current.path.split('/').pop() || 'file.tex')}>下载文件</button>}
          </div>
          {textFile ? <textarea aria-label={active} spellCheck={false} value={textFile.content} onChange={(e) => updateFile(active, e.target.value)} /> :
            <div className="browser-ws__binary">此文件为二进制资源，仅参与编译，不支持直接编辑。</div>}
        </section>
        <section className="browser-ws__pdf">
          <div className="browser-ws__panehead">PDF 预览 <span className="browser-ws__grow" /><span>WebAssembly</span></div>
          {previewUrl ? <iframe title="浏览器编译 PDF" src={previewUrl} /> :
            <div className="browser-ws__empty">选择主文件，点击「编译 PDF」<small>首次下载可能较慢；浏览器内存不足可能导致失败</small></div>}
        </section>
      </div>
      <section className="browser-ws__logs">
        <button className="browser-ws__logtoggle" onClick={() => setShowLog((v) => !v)}>编译日志 <span>{showLog ? '收起 ▲' : '展开 ▼'}</span></button>
        {showLog && <pre data-testid="browser-compile-log">{errorLog || '暂无日志。'}</pre>}
      </section>
      <footer className="browser-ws__footer">Aldine / BusyTeX 均采用 AGPL 开源许可。浏览器模式为独立实验，不承诺与完整 TeX Live 输出完全一致。</footer>
    </div>
  );
}
