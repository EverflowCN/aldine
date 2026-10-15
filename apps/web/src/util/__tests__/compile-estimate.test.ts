import { describe, expect, it, vi } from 'vitest';
import { describeCompileEstimate, estimateCompileTime, formatCompileTime, historyKey, readCompileHistory, saveCompileHistory } from '../compile-estimate';

const small = [{ path: 'main.tex', content: '\\documentclass{article}\\begin{document}Test\\end{document}' }];
const large = Array.from({ length: 52 }, (_, i) => ({ path: 'questions/' + i + '.tex', content: '中文题目'.repeat(1000) }));
describe('Honest local compile time ranges', () => {
  it('shows realistic ranges without pretending to know exact execution', () => {
    const a = estimateCompileTime(small, 'basic', true);
    expect(a.highSeconds).toBeGreaterThan(a.lowSeconds);
    expect(estimateCompileTime(small, 'basic', false).lowSeconds).toBeGreaterThan(a.lowSeconds);
    expect(estimateCompileTime(large, 'recommended', true).highSeconds).toBeGreaterThan(a.highSeconds);
    expect(describeCompileEstimate(a, a.highSeconds + 15)).toContain('超过估计');
  });
  it('formats time consistently and never negative', () => {
    expect(formatCompileTime(-5)).toBe('0 秒');
    expect(formatCompileTime(80)).toContain('1 分');
    expect(describeCompileEstimate(estimateCompileTime(small, 'basic', true), 10)).toContain('估算');
  });
  it('uses aggregated local duration history, not source content', () => {
    const saved = new Map<string,string>();
    vi.stubGlobal('localStorage', {getItem:(k:string)=>saved.get(k)??null,setItem:(k:string,v:string)=>saved.set(k,v)});
    const key = historyKey(small, 'basic');
    expect(key).not.toContain('Test');
    saveCompileHistory(key,42);
    expect(readCompileHistory(key)).toBe(42);
    saveCompileHistory(key,52);
    expect(readCompileHistory(key)).toBe(46);
    vi.unstubAllGlobals();
  });
});
