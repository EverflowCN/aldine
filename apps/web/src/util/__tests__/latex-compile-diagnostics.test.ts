import { describe, expect, it } from 'vitest';
import { diagnoseCompileLog } from '../latex-compile-diagnostics';

describe('BusyTeX Chinese compilation diagnosis', () => {
  it('identifies a TeX Live package missing from Basic', () => {
    const x = diagnoseCompileLog("! LaTeX Error: File 'multirow.sty' not found.\nEmergency stop.");
    expect(x.some(i => i.code === 'missing-file' && i.title.includes('multirow.sty'))).toBe(true);
    expect(x.find(i => i.code === 'missing-file')?.advice).toContain('扩展');
  });
  it('distinguishes missing project PNG from a missing package', () => {
    const x = diagnoseCompileLog("File 'figures/diagram.png' not found");
    expect(x).toHaveLength(1);
    expect(x[0].advice).toContain('ZIP');
  });
  it('reports fontspec and missing Chinese glyphs', () => {
    const x = diagnoseCompileLog('Package fontspec Error: The font "Times New Roman" cannot be found.\nMissing character: There is no 中 in font');
    expect(x.some(i => i.code === 'missing-font')).toBe(true);
    expect(x.some(i => i.code === 'font-glyph')).toBe(true);
  });
  it('classifies timeout, memory and undefined command separately', () => {
    const x = diagnoseCompileLog('Compilation timeout 900000ms\nmemory access out of bounds\n! Undefined control sequence.');
    expect(x.map(i => i.code)).toEqual(expect.arrayContaining(['timeout','memory','undefined-command']));
  });
  it('returns empty for a valid build', () => {
    expect(diagnoseCompileLog('Output written on main.pdf (58 pages).')).toEqual([]);
  });
});
