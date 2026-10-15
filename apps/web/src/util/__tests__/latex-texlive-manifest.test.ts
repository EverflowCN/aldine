import { afterEach, expect, it, vi } from 'vitest';
afterEach(() => vi.unstubAllGlobals());
it('uses installed filenames for nested TikZ dependencies missing from Provides metadata', async () => {
  vi.resetModules();
  const filler = Array.from({length:12}, (_,i) => '\\ProvidesPackage{fixture'+i+'}').join('\n');
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(
    url.endsWith('.txt') && !url.includes('providespackage')
      ? url.includes('recommended') ? 'build/texlive-recommended/texmf-dist/tex/latex/pgf/frontendlayer/tikz.sty\n' : ''
      : filler
  )));
  const { assessTeXLiveCoverage } = await import('../texlive-manifest');
  const result = await assessTeXLiveCoverage(['tikz','project-style'], '/test', ['project-style.sty','main.tex']);
  expect(result.matches).toEqual([{name:'tikz',tier:'recommended'},{name:'project-style',tier:'local'}]);
  expect(result.suggested).toBe('recommended');
});
