import { expect, test } from 'vitest';
import { scanLatexDependencies } from '../latex-preflight';
import { needsPackageCatalog, needsSecondPass, resourceTierForProject } from '../compile-plan';

test('9-line article with amsmath uses Basic and avoids all TeX Live catalog requests', () => {
  const files = [{
    path: 'main.tex',
    content: [
      '\\documentclass[12pt,a4paper]{article}',
      '\\usepackage{amsmath,amssymb}',
      '\\begin{document}',
      '\\section*{Quick example}',
      'One simple paragraph.',
      '\\end{document}',
    ].join('\n'),
  }];
  const report = scanLatexDependencies(files, 'main.tex');
  expect(report.recommendedTier).toBe('basic');
  expect(resourceTierForProject('auto', report)).toBe('basic');
  expect(needsPackageCatalog(report, ['main.tex'])).toBe(false);
  expect(needsSecondPass(files)).toBe(false);
  expect(resourceTierForProject('recommended', report)).toBe('recommended');
});

test('CTeX, TikZ and custom style still require Recommended and complex packages', () => {
  const files = [
    { path: 'main.tex', content: '\\documentclass{ctexart}\\n\\usepackage{project-style}\\n\\begin{document}中文\\end{document}' },
    { path: 'project-style.sty', content: '\\ProvidesPackage{project-style}\\n\\RequirePackage{tikz}\\n\\input{pgfmathfloat.code.tex}' },
  ];
  const report = scanLatexDependencies(files, 'main.tex');
  expect(report.recommendedTier).toBe('recommended');
  expect(resourceTierForProject('auto', report)).toBe('recommended');
  expect(needsPackageCatalog(report, files.map(f => f.path))).toBe(true);
  expect(needsSecondPass(files)).toBe(false);
});

test('unknown optional package still uses catalog and cross references trigger rerun', () => {
  const files = [
    { path:'main.tex', content: '\\documentclass{article}\\n\\usepackage{unknown-tikz-helper}\\n\\begin{document}\\tableofcontents\\label{a}\\ref{a}\\end{document}' },
  ];
  const report = scanLatexDependencies(files, 'main.tex');
  expect(needsPackageCatalog(report, files.map(f => f.path))).toBe(true);
  expect(needsSecondPass(files)).toBe(true);
  expect(resourceTierForProject('extra', report)).toBe('extra');
});
