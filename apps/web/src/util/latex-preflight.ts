/**
 * Static, offline LaTeX dependency preflight for imported ZIP projects.
 * This is NOT a TeX Live resolver; classify local project files separately
 * from packages/fonts that must be checked by a real XeLaTeX compilation.
 */
export type PreflightFile = { path: string; content: string | Uint8Array };
export type DependencyWarning = { severity: 'error' | 'warning' | 'info'; message: string; file?: string };
export type PreflightResult = {
  isEverflow: boolean;
  entrypoints: string[];
  packages: string[];
  documentClasses: string[];
  fontNames: string[];
  missingLocalFiles: string[];
  externalCommands: string[];
  imageCount: number;
  recommendedTier: 'basic' | 'recommended';
  warnings: DependencyWarning[];
};
const TEX_RE = /\.(tex|sty|cls|def|cfg|bib)$/i;
const IMAGE_EXT = /\.(png|jpe?g|pdf|eps|svg)$/i;
const SYSTEM_TEX = new Set(['article', 'book', 'report', 'memoir', 'beamer', 'standalone', 'ctexart', 'ctexbook', 'ctexrep']);
const fontCommands = /\\(?:setmainfont|setsansfont|setmonofont|setmathfont|setCJKmainfont|setCJKsansfont|setCJKmonofont|newCJKfontfamily|newfontfamily)\s*(?:\[[^\]]*\]\s*)?\{([^{}]+)\}/g;
const packageCommands = /\\(?:usepackage|RequirePackage)\s*(?:\[[^\]]*\])?\s*\{([^{}]+)\}/g;
const classCommands = /\\(?:documentclass|LoadClass)\s*(?:\[[^\]]*\])?\s*\{([^{}]+)\}/g;
const inputCommands = /\\(?:input|include|subfile)\s*\{([^{}]+)\}/g;
const graphicCommands = /\\includegraphics\s*(?:\[[^\]]*\])?\s*\{([^{}]+)\}/g;
const commandCommands = /\\(?:write18|immediate\s*\\write18|ShellEscape|minted|makeindex|printindex|glossaries)\b/g;

function stripTeXComments(source: string): string {
  return source.split(/\r?\n/).map((line) => {
    for (let i = 0; i < line.length; i++) {
      if (line[i] !== '%') continue;
      let escapes = 0;
      for (let j = i - 1; j >= 0 && line[j] === '\\'; j--) escapes++;
      if (escapes % 2 === 0) return line.slice(0, i);
    }
    return line;
  }).join('\n');
}
function dirname(path: string): string {
  const i = path.lastIndexOf('/');
  return i === -1 ? '' : path.slice(0, i + 1);
}
function normalized(path: string): string | null {
  const raw = path.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!raw || raw.startsWith('..') || raw.includes('\0')) return null;
  const parts: string[] = [];
  for (const x of raw.split('/')) {
    if (x === '.' || !x) continue;
    if (x === '..') { if (!parts.length) return null; parts.pop(); }
    else parts.push(x);
  }
  return parts.join('/');
}
function matchesFile(files: Set<string>, owner: string, value: string, extensions: string[], searchPaths: string[] = []): boolean {
  const name = value.trim();
  if (!name || /[\\#{}]/.test(name)) return true; // macro/computed reference: cannot statically resolve
  const forms = [name, ...(!/\.[^/]+$/.test(name) ? extensions.map(ext => name + ext) : [])];
  for (const form of forms) {
    if (files.has(form)) return true;
    for (const prefix of [dirname(owner), ...searchPaths]) {
      const resolved = normalized(prefix + form);
      if (resolved && files.has(resolved)) return true;
    }
  }
  return false;
}
export function scanLatexDependencies(files: PreflightFile[], rootFile: string): PreflightResult {
  const names = new Set(files.map(f => f.path.normalize('NFC')));
  const inputPaths: string[] = [dirname(rootFile)], graphicsPaths: string[] = [dirname(rootFile)];
  for (const file of files) {
    if (typeof file.content !== 'string' || !TEX_RE.test(file.path)) continue;
    const source = stripTeXComments(file.content);
    for (const match of source.matchAll(/\\(?:(?:gdef|def)\s*\\input@path|graphicspath)\s*\{((?:\s*\{[^{}]*\}\s*)+)\}/g)) {
      const targets = match[0].includes('graphicspath') ? graphicsPaths : inputPaths;
      for (const item of match[1].matchAll(/\{([^{}]+)\}/g)) {
        if (/[\\#]/.test(item[1])) continue;
        for (const base of ['', dirname(rootFile), dirname(file.path)]) {
          const path = normalized(base + item[1]);
          if (path) targets.push(path.replace(/\/?$/, '/'));
        }
      }
    }
  }
  const packages = new Set<string>(), fonts = new Set<string>(), classes = new Set<string>();
  const external = new Set<string>(), missing = new Set<string>();
  let imageCount = 0;
  let lineCount = 0;
  for (const file of files) {
    if (IMAGE_EXT.test(file.path)) imageCount++;
    if (!TEX_RE.test(file.path) || typeof file.content !== 'string') continue;
    const source = stripTeXComments(file.content);
    lineCount += source.split('\n').length;
    for (const match of source.matchAll(packageCommands)) {
      match[1].split(',').map(v => v.trim()).filter(Boolean).forEach(p => packages.add(p));
    }
    for (const match of source.matchAll(classCommands)) classes.add(match[1].trim());
    for (const match of source.matchAll(fontCommands)) {
      const value = match[1].trim();
      if (!value.includes('\\') && value.length < 100) fonts.add(value);
    }
    for (const match of source.matchAll(inputCommands)) {
      const path = match[1].trim();
      // PGF/TikZ internal .code.tex files are installed by TeX Live, not ZIP chapters.
      // Suppressing this false local-file warning does NOT claim the runtime bundle is present.
      const isKnownRuntimeCode = /^(?:pgf|tikz)[\w.-]*\.code\.tex$/i.test(path.split('/').pop() || '');
      if (!isKnownRuntimeCode && !matchesFile(names, file.path, path, ['.tex', '.sty'], inputPaths)) missing.add(path + ' ← ' + file.path);
    }
    for (const match of source.matchAll(graphicCommands)) {
      const path = match[1].trim();
      if (!matchesFile(names, file.path, path, ['.png', '.jpg', '.jpeg', '.pdf', '.eps'], [...inputPaths, ...graphicsPaths])) {
        // graphics may be located in \graphicspath or generated by macros;
        // warn but do not block compilation on this static approximation.
        missing.add(path + ' ← ' + file.path);
      }
    }
    for (const match of source.matchAll(commandCommands)) external.add(match[0]);
  }
  const candidates = files.map(f => f.path).filter(p => /(^|\/)Everflow-(Exam|Book|Public)\.tex$/i.test(p));
  const isEverflow = candidates.length > 0 || files.some(f => /(^|\/)90-core\/everflow-/.test(f.path));
  const warnings: DependencyWarning[] = [];
  if (!names.has(rootFile)) warnings.push({ severity: 'error', message: '指定的主文件不存在', file: rootFile });
  const absent = [...missing].sort((a, b) => a.localeCompare(b, 'zh-CN'));
  for (const path of absent.slice(0, 18)) warnings.push({
    severity: 'warning', message: '未在 ZIP 工程中找到引用文件（也可能是 TeX Live 文件或 \\graphicspath 路径）', file: path
  });
  if (absent.length > 18) warnings.push({ severity: 'warning', message: '还有 ' + (absent.length - 18) + ' 项文件路径需要检查' });
  const bundled = new Set(files.map(f => f.path.split('/').pop()?.toLowerCase()));
  for (const x of [...classes]) {
    if (SYSTEM_TEX.has(x)) continue;
    if (!bundled.has(x.split('/').pop()?.toLowerCase() + '.cls')) {
      warnings.push({ severity: 'info', message: '自定义文档类可能需要 TeX Live 提供', file: x });
    }
  }
  if (external.size) warnings.push({ severity: 'warning', message: '检测到可能依赖系统外部程序的 LaTeX 指令；浏览器 WebAssembly 并不支持任意 shell 命令', file: [...external].join('、') });
  if (/\bTimes New Roman\b/i.test([...fonts].join(' '))) warnings.push({
    severity: 'warning', message: '检测到 Times New Roman：浏览器无法直接读取电脑系统字体，必须使用可用回退字体或经授权打包字体'
  });
  if (packages.has('fontspec') || packages.has('ctex') || [...fonts].some(f => /CJK|Fandol|SimSun|XITS|Asana|TeXGyre/i.test(f))) {
    warnings.push({ severity: 'info', message: '发现中文/系统字体依赖，请使用 XeLaTeX；按需检查字体缺失日志和 PDF 中的中文字形' });
  }
  if (isEverflow) warnings.push({ severity: 'info', message: '识别为 Everflow 工程；三个原始入口应分别验证：Exam / Book / Public，且需多轮编译目录和页码' });
  if (packages.has('tikz') || packages.has('ctex') || packages.has('fontawesome5') || packages.has('newtxmath')) {
    warnings.push({ severity: 'info', message: '存在复杂宏包：建议先试推荐资源包，不需要强制首次下载完整扩展包；若失败再查看日志并启用扩展' });
  }
  const packageList = [...packages].sort((a, b) => a.localeCompare(b));
  const fontList = [...fonts].sort((a, b) => a.localeCompare(b));
  return {
    isEverflow, entrypoints: candidates.sort(), packages: packageList, documentClasses: [...classes].sort(),
    fontNames: fontList, missingLocalFiles: absent, externalCommands: [...external].sort(),
    imageCount, recommendedTier: (isEverflow || [...classes].some(x => /^ctex(?:art|book|rep)$|^\s*beamer$/i.test(x)) ||
      packageList.some(x => /^(ctex|xeCJK|fontspec|tikz|fontawesome5|newtxmath|qrcode)$/i.test(x))) ? 'recommended' : 'basic',
    warnings
  };
}
