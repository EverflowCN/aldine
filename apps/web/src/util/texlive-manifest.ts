/**
 * Resolve LaTeX \ProvidesPackage declarations against the exact three
 * BusyTeX 2026 bundles shipped on GitHub Pages.
 *
 * This is package metadata only. Font availability, TeX Live file existence
 * and real XeLaTeX build success require runtime verification.
 */
export type TeXLiveTier = 'basic' | 'recommended' | 'extra' | 'unlisted' | 'local';
export type TeXLiveCoverage = {
  matches: Array<{ name: string; tier: TeXLiveTier }>;
  byTier: Record<TeXLiveTier, number>;
  suggested: 'basic' | 'recommended' | 'extra';
  note: string;
};
const COLLECTIONS: Array<{tier: Exclude<TeXLiveTier, 'unlisted' | 'local'>; file: string}> = [
  { tier: 'basic', file: 'texlive-basic.js.providespackage.txt' },
  { tier: 'recommended', file: 'texlive-recommended.js.providespackage.txt' },
  { tier: 'extra', file: 'texlive-extra.js.providespackage.txt' },
];
const PROVIDES = /\\Provides(?:Expl)?(?:Package|Class|File)\{([^}]+)\}/g;
let manifestPromise: Promise<Array<Map<string, boolean>>> | null = null;
async function manifests(basePath: string): Promise<Array<Map<string, boolean>>> {
  const key = basePath.replace(/\/+$/, '');
  if (!manifestPromise) {
    manifestPromise = Promise.all(COLLECTIONS.map(async (coll) => {
      const response = await fetch(key + '/' + coll.file, { cache: 'force-cache' });
      if (!response.ok) throw Error(coll.file + ': HTTP ' + response.status);
      const text = await response.text();
      const catalog = new Map<string, boolean>();
      for (const match of text.matchAll(PROVIDES)) {
        catalog.set(match[1].trim().toLowerCase(), true);
      }
      if (catalog.size < 10) throw Error(coll.file + ': unexpected empty package inventory');
      return catalog;
    })).catch(err => {
      manifestPromise = null; // permit retry after transient network failure
      throw err;
    });
  }
  return manifestPromise;
}
export async function assessTeXLiveCoverage(
  packages: string[], basePath: string, localPaths: string[]
): Promise<TeXLiveCoverage> {
  const catalogs = await manifests(basePath);
  const localPackages = new Set(
    localPaths.filter(p => /\.sty$/i.test(p)).map(p => p.split('/').pop()!.slice(0, -4).toLowerCase())
  );
  // For Everflow, the Pages build also indexes literal paths installed
  // inside all three pinned TeX Live collections. This catches real packages
  // whose declarations are absent from the upstream Provides-only manifest.
  let everflowFiles = new Map<string, TeXLiveTier>();
  if (localPaths.some(p => /(^|\\/)Everflow-(Exam|Book|Public)\.tex$/i.test(p))) {
    try {
      const response = await fetch('/latex/deploy/everflow-package-coverage.json', { cache: 'no-store' });
      if (response.ok) {
        const index = await response.json() as { source_lists?: string[]; packages?: Array<{name: string; tier: TeXLiveTier}> };
        if (index.source_lists?.includes('TeX Live installed filenames') && Array.isArray(index.packages)) {
          everflowFiles = new Map(index.packages.map(item => [item.name.toLowerCase(), item.tier]));
        }
      }
    } catch { /* Online manifests remain a best-effort hint, not a compile prerequisite. */ }
  }
  const matches = packages.map(name => {
    const normalized = name.toLowerCase();
    const isLocal = localPackages.has(normalized) || localPaths.some(p => p.toLowerCase() === normalized + '.sty' || p.toLowerCase().endsWith('/' + normalized + '.sty'));
    const i = catalogs.findIndex(c => c.has(normalized));
    const tier = isLocal ? 'local' as const
      : everflowFiles.get(normalized) || (i >= 0 ? COLLECTIONS[i].tier : 'unlisted' as const);
    return { name, tier };
  });
  const byTier: Record<TeXLiveTier, number> = { basic: 0, recommended: 0, extra: 0, unlisted: 0, local: 0 };
  matches.forEach(item => { byTier[item.tier]++; });
  const suggested = byTier.extra ? 'extra' : byTier.recommended ? 'recommended' : 'basic';
  return {
    matches, byTier, suggested,
    note: '根据官方 TeX Live 已安装文件索引（Everflow）与 \\ProvidesPackage 声明对照。仍未列出不代表必然缺失；字体族解析、运行内存和 XeLaTeX 实际兼容性仍须测试。',
  };
}
