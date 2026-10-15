import { describe, expect, it } from 'vitest';
import { scanLatexDependencies } from '../latex-preflight';

describe('Everflow offline LaTeX preflight', () => {
  it('finds packages and fonts and resolves local multi-file references without network', () => {
    const data = scanLatexDependencies([
      { path: 'Everflow-Exam.tex', content: [
        '\\documentclass{core/examzh/exam-zh}',
        '\\usepackage{ctex,amsmath,multirow}',
        '\\setmainfont{Times New Roman}',
        '\\input{questions/first}',
        '\\includegraphics{figures/picture.png}',
      ].join('\n') },
      { path: 'core/examzh/exam-zh.cls', content: '\\ProvidesClass{exam-zh}' },
      { path: 'questions/first.tex', content: '\\usepackage{tikz}' },
      { path: 'figures/picture.png', content: new Uint8Array([137, 80, 78, 71]) },
    ], 'Everflow-Exam.tex');
    expect(data.isEverflow).toBe(true);
    expect(data.entrypoints).toContain('Everflow-Exam.tex');
    expect(data.packages).toEqual(expect.arrayContaining(['amsmath', 'ctex', 'multirow', 'tikz']));
    expect(data.fontNames).toContain('Times New Roman');
    expect(data.imageCount).toBe(1);
    expect(data.missingLocalFiles).toEqual([]);
    expect(data.recommendedTier).toBe('recommended');
    expect(data.warnings.some(w => w.message.includes('Times New Roman'))).toBe(true);
  });
  it('ignores commented files, and reports genuinely unresolved local paths', () => {
    const data = scanLatexDependencies([
      { path: 'main.tex', content: [
        '% \\input{missing-commented}',
        '\\input{chapters/first}',
        '\\includegraphics{figures/chart.pdf}',
        '\\input{\\ComputedReference}',
        '\\usepackage{geometry}'
      ].join('\n') },
      { path: 'chapters/first.tex', content: 'Hello' }
    ], 'main.tex');
    expect(data.isEverflow).toBe(false);
    expect(data.packages).toContain('geometry');
    expect(data.missingLocalFiles).toHaveLength(1);
    expect(data.missingLocalFiles[0]).toContain('figures/chart.pdf');
  });
  it('does not confuse local custom classes with missing TeX Live classes', () => {
    const data = scanLatexDependencies([
      { path: 'main.tex', content: '\\documentclass{core/exbook/ExBook}\\n\\input{local}' },
      { path: 'core/exbook/ExBook.cls', content: '' },
      { path: 'local.tex', content: '' },
    ], 'main.tex');
    expect(data.warnings.some(w => w.message.includes('自定义文档类'))).toBe(false);
  });
});

it('resolves Chinese names, input search paths and graphicspath', () => {
  const report = scanLatexDependencies([
    { path:'main.tex', content:'\\def\\input@path{{配置/}{章节/}}\n\\graphicspath{{图片/}}\n\\input{快速设置}\n\\includegraphics{示意图}' },
    { path:'配置/快速设置.tex', content:'' },
    { path:'图片/示意图.png', content:new Uint8Array() },
  ], 'main.tex');
  expect(report.missingLocalFiles).toEqual([]);
});

it('does not mislabel PGF math internals as missing files in the uploaded ZIP', () => {
  const project = scanLatexDependencies([
    { path: 'main.tex', content: '\\documentclass{article}\\n\\usepackage{project-style}\\n\\begin{document}Hi\\end{document}' },
    { path: 'project-style.sty', content: '\\ProvidesPackage{project-style}\\n\\RequirePackage{tikz}\\n\\input{pgfmathfloat.code.tex}' },
  ], 'main.tex');
  expect(project.packages).toContain('tikz');
  expect(project.missingLocalFiles).toEqual([]);
});

it('requires recommended resources for a CTeX document class even without a separate usepackage{ctex}', () => {
  const result = scanLatexDependencies([
    {path:'main.tex',content:String.raw`\documentclass[12pt]{ctexart}
\usepackage{amsmath}
\begin{document}中文\end{document}`},
  ], 'main.tex');
  expect(result.documentClasses).toContain('ctexart');
  expect(result.recommendedTier).toBe('recommended');
});
