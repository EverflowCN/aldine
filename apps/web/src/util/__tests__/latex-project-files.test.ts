import { describe, expect, it } from 'vitest';
import { repairLegacyPath, readZipNames, decodeProjectText, safeProjectPath, chooseRoot, unwrapProject, buildFileTree } from '../latex-project-files';

const utf8 = (s: string) => new TextEncoder().encode(s);
function crc32(bytes: Uint8Array): number {
  let crc = -1;
  for (const b of bytes) { crc ^= b; for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
  return (crc ^ -1) >>> 0;
}
function metadata(entries: { name: Uint8Array; flags?: number; unicode?: string; crc?: number }[]) {
  const parts = entries.map(e => {
    const unicode = e.unicode ? utf8(e.unicode) : null;
    const extra = unicode ? new Uint8Array(9 + unicode.length) : new Uint8Array();
    if (unicode) { const v = new DataView(extra.buffer); v.setUint16(0, 0x7075, true); v.setUint16(2, 5 + unicode.length, true); extra[4] = 1; v.setUint32(5, e.crc ?? crc32(e.name), true); extra.set(unicode, 9); }
    const out = new Uint8Array(46 + e.name.length + extra.length), v = new DataView(out.buffer);
    v.setUint32(0, 0x02014b50, true); v.setUint16(8, e.flags || 0, true); v.setUint16(28, e.name.length, true); v.setUint16(30, extra.length, true); out.set(e.name, 46); out.set(extra, 46 + e.name.length); return out;
  });
  const size = parts.reduce((n,p) => n + p.length, 0), out = new Uint8Array(size + 22); let pos = 0;
  for (const p of parts) { out.set(p, pos); pos += p.length; }
  const v = new DataView(out.buffer); v.setUint32(size, 0x06054b50, true); v.setUint16(size + 8, entries.length, true); v.setUint16(size + 10, entries.length, true); v.setUint32(size + 12, size, true); return out;
}
describe('LaTeX project ZIP names and tree', () => {
  it('reads Windows GBK names and matches the exact legacy fflate key', () => {
    const name = new Uint8Array([0xd6, 0xd0, 0xce, 0xc4, ...utf8('/main.tex')]);
    const [entry] = readZipNames(metadata([{ name }]));
    expect(entry.path).toBe('中文/main.tex');
    expect(entry.key).toBe(Array.from(name, b => String.fromCharCode(b)).join(''));
  });
  it('supports UTF-8 with or without the language flag', () => {
    for (const flags of [0, 0x800]) expect(readZipNames(metadata([{ name: utf8('题目/第一题.tex'), flags }]))[0].path).toBe('题目/第一题.tex');
  });
  it('uses Unicode Path extra data only when its raw-name CRC matches', () => {
    expect(readZipNames(metadata([{ name: utf8('legacy.tex'), unicode: '中文.tex' }]))[0].path).toBe('中文.tex');
    expect(readZipNames(metadata([{ name: utf8('legacy.tex'), unicode: '中文.tex', crc: 3 }]))[0].path).toBe('legacy.tex');
  });
  it('rejects traversal, duplicate decoded paths, truncated archives, and file/directory collisions', () => {
    for (const name of ['../outside.tex', '/root.tex', 'C:/secret.tex', 'a/../b.tex']) expect(() => readZipNames(metadata([{ name: utf8(name) }]))).toThrow();
    expect(() => readZipNames(metadata([{ name: utf8('a.tex') }, { name: utf8('a.tex') }]))).toThrow();
    expect(() => readZipNames(metadata([{ name: utf8('a') }, { name: utf8('a/main.tex') }]))).toThrow();
    expect(() => readZipNames(new Uint8Array(8))).toThrow();
    expect(safeProjectPath('题目/第一题.tex')).toBe('题目/第一题.tex');
  });
  it('decodes Chinese source files without replacement glyphs', () => {
    expect(decodeProjectText(new Uint8Array([0xd6,0xd0,0xce,0xc4]))).toBe('中文');
    expect(decodeProjectText(utf8('中文与公式 $x$'))).toBe('中文与公式 $x$');
    expect(decodeProjectText(new Uint8Array([0xff,0xfe,0x2d,0x4e]))).toBe('中');
  });
  it('unwraps archive wrapper while preserving internal folders and choosing an actual document', () => {
    const project = unwrapProject([
      { path:'模板/00-config.tex', content:'% helper' },
      { path:'模板/main.tex', content:'\\documentclass{article}' },
      { path:'模板/题目/第一题.tex', content:'题目' },
    ], ['模板/空文件夹']);
    expect(chooseRoot(project.files).path).toBe('main.tex');
    expect(project.files[2].path).toBe('题目/第一题.tex');
    expect(project.folders).toEqual(['空文件夹']);
    const tree = buildFileTree(project.files, project.folders);
    expect(tree.find(n => n.path==='题目')?.children[0].name).toBe('第一题.tex');
    expect(tree.find(n => n.path==='空文件夹')?.directory).toBe(true);
  });
});

it('repairs legacy Latin-1 decoded Chinese paths without changing normal names', () => {
  const raw = String.fromCharCode(0xd6,0xd0,0xce,0xc4) + '.tex';
  expect(repairLegacyPath(raw)).toBe('中文.tex');
  expect(repairLegacyPath('正确中文.tex')).toBe('正确中文.tex');
  expect(repairLegacyPath('main.tex')).toBe('main.tex');
});
