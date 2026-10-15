import type { PreflightResult } from './latex-preflight';
import type { CompileFile, ResourceTier } from './compile-estimate';

/** Manual choice is an intentional floor, never a global project-to-project default. */
export type ResourceChoice = 'auto' | ResourceTier;
const RANK: Record<ResourceTier, number> = { basic: 0, recommended: 1, extra: 2 };
const BASIC_PACKAGES = new Set([
  'amsmath', 'amssymb', 'amsfonts', 'graphicx', 'graphics',
  'array', 'calc', 'ifthen', 'fontenc', 'inputenc', 'textcomp',
]);
export function resourceTierForProject(choice: ResourceChoice, report: PreflightResult): ResourceTier {
  const minimum: ResourceTier = report.recommendedTier;
  if (choice === 'auto') return minimum;
  return RANK[choice] >= RANK[minimum] ? choice : minimum;
}

/** Avoid six metadata requests before every trivial article/amsmath build. */
export function needsPackageCatalog(report: PreflightResult, localPaths: string[]): boolean {
  const local = new Set(localPaths.filter(p => /\.sty$/i.test(p)).map(p => p.split('/').pop()!.slice(0, -4).toLowerCase()));
  return report.packages.some(p => {
    const name = p.toLowerCase();
    // Complex packages must be resolved against the REAL TeX Live inventories:
    // several common-sounding TikZ/PGF assets live in Extra, not Recommended.
    return !BASIC_PACKAGES.has(name) && !local.has(name);
  });
}

/** Single TeX pass suffices when there are no cross-references or generated lists. */
export function needsSecondPass(files: CompileFile[]): boolean {
  if (files.length >= 30 || files.some(f => typeof f.content === 'string' && f.content.length > 120000)) return true;
  const reference = /\\(?:tableofcontents|listoffigures|listoftables|printbibliography|bibliography\s*\{|(?:auto|page|eq|name|cref|Cref)?ref\s*\{|cite(?:p|t|author|year)?\s*\{)/;
  return files.some(f => /\.(?:tex|sty|cls)$/i.test(f.path) && typeof f.content === 'string' && reference.test(f.content));
}
