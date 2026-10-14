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
  const matches = packages.map(name => {
    const normalized = name.toLowerCase();
    const isLocal = localPackages.has(normalized) || localPaths.some(p => p.toLowerCase() === normalized + '.sty');
    const i = catalogs.findIndex(c => c.has(normalized));
    return {
      name,
      tier: isLocal ? 'local' as const : i >= 0 ? COLLECTIONS[i].tier : 'unlisted' as const
    };
  });
  const byTier: Record<TeXLiveTier, number> = { basic: 0, recommended: 0, extra: 0, unlisted: 0, local: 0 };
  matches.forEach(item => { byTier[item.tier]++; });
  const suggested = byTier.extra ? 'extra' : byTier.recommended ? 'recommended' : 'basic';
  return {
    matches, byTier, suggested,
    note: '根据官方 \\ProvidesPackage 声明估计归属。未列出不代表必然缺失：某些包由依赖隐式提供、文件名和声明名不同、或需按需远程补充。字体未纳入此清单。',
  };
}
