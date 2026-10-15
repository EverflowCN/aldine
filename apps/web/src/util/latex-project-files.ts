export type ProjectFile = { path: string; content: string | Uint8Array };
export type ZipName = { key: string; path: string; directory: boolean };
export function safeProjectPath(input: string): string | null {
  const path = input.replace(/\\/g, '/').normalize('NFC');
  if (!path || path !== path.trim() || path.length > 240 || /^[A-Za-z]:|^\//.test(path)
    || /[\x00-\x1f\x7f]/.test(path) || path.split('/').some(p => !p || p === '.' || p === '..')) return null;
  return path;
}
export function decodeProjectText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le', { fatal: true }).decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be', { fatal: true }).decode(bytes);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { return new TextDecoder('gb18030', { fatal: true }).decode(bytes); }
}
export function repairLegacyPath(path: string): string {
  if (!/[\u0080-\u00ff]/.test(path) || [...path].some(c => c.charCodeAt(0) > 255)) return path;
  try {
    const decoded = decodeProjectText(Uint8Array.from(path, c => c.charCodeAt(0)));
    return /[\u3400-\u9fff]/.test(decoded) && safeProjectPath(decoded) ? decoded : path;
  } catch { return path; }
}
function crc32(bytes: Uint8Array): number {
  let crc = -1;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ -1) >>> 0;
}
// fflate indexes legacy ZIP names as Latin-1. Decode the original name bytes,
// not that already-decoded string; Chinese Windows ZIPs commonly use GBK.
export function readZipNames(buffer: Uint8Array): ZipName[] {
  if (buffer.length > 32 * 1024 * 1024) throw Error('ZIP 压缩包不能超过 32 MB');
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  let end = -1;
  for (let p = buffer.length - 22; p >= Math.max(0, buffer.length - 65557); p--) {
    if (view.getUint32(p, true) === 0x06054b50 && p + 22 + view.getUint16(p + 20, true) === buffer.length) { end = p; break; }
  }
  if (end < 0) throw Error('ZIP 目录损坏');
  const count = view.getUint16(end + 10, true), size = view.getUint32(end + 12, true);
  let p = view.getUint32(end + 16, true), total = 0;
  if (view.getUint16(end + 4, true) || view.getUint16(end + 6, true)
    || count !== view.getUint16(end + 8, true) || count > 600 || p + size !== end) throw Error('不支持分卷、ZIP64 或过多文件');
  const result: ZipName[] = [], seen = new Set<string>(), keys = new Set<string>();
  for (let i = 0; i < count; i++) {
    if (p + 46 > end || view.getUint32(p, true) !== 0x02014b50) throw Error('ZIP 中央目录格式错误');
    const flags = view.getUint16(p + 8, true), method = view.getUint16(p + 10, true);
    const length = view.getUint32(p + 24, true), nameLength = view.getUint16(p + 28, true);
    const extraLength = view.getUint16(p + 30, true), commentLength = view.getUint16(p + 32, true);
    const next = p + 46 + nameLength + extraLength + commentLength;
    if (next > end || !nameLength) throw Error('ZIP 文件名越界');
    total += length;
    if (flags & 1 || ![0, 8].includes(method)) throw Error('不支持加密或此压缩算法');
    if (total > 80 * 1024 * 1024 || length > 25 * 1024 * 1024) throw Error('ZIP 解压资源过大');
    const raw = buffer.subarray(p + 46, p + 46 + nameLength);
    const key = flags & 0x800 ? new TextDecoder('utf-8', { fatal: true }).decode(raw)
      : Array.from(raw, b => String.fromCharCode(b)).join('');
    let name: string | undefined = flags & 0x800 ? key : undefined;
    // Info-ZIP Unicode Path extra field is authoritative only with a valid CRC.
    for (let x = p + 46 + nameLength; x < p + 46 + nameLength + extraLength;) {
      if (x + 4 > p + 46 + nameLength + extraLength) throw Error('ZIP 扩展字段损坏');
      const tag = view.getUint16(x, true), n = view.getUint16(x + 2, true);
      if (x + 4 + n > p + 46 + nameLength + extraLength) throw Error('ZIP 扩展字段越界');
      if (tag === 0x7075 && n >= 5 && buffer[x + 4] === 1 && view.getUint32(x + 5, true) === crc32(raw)) {
        name = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(x + 9, x + 4 + n));
      }
      x += 4 + n;
    }
    name ??= decodeProjectText(raw);
    const directory = /[\\/]$/.test(name);
    const path = safeProjectPath(directory ? name.slice(0, -1) : name);
    if (!path) throw Error('ZIP 包含无效或不安全的路径');
    if (seen.has(path) || keys.has(key)) throw Error('ZIP 中存在重复文件路径');
    seen.add(path); keys.add(key); result.push({ key, path, directory }); p = next;
  }
  if (p !== end) throw Error('ZIP 目录长度不符');
  const files = new Set(result.filter(e => !e.directory).map(e => e.path));
  for (const e of result) {
    if (e.directory && files.has(e.path)) throw Error('ZIP 文件与目录重名');
    for (const parent of parentFolders(e.path)) if (files.has(parent)) throw Error('ZIP 文件阻挡了目录路径');
  }
  return result;
}
export function parentFolders(path: string): string[] {
  const parts = path.split('/'); parts.pop();
  return parts.map((_, i) => parts.slice(0, i + 1).join('/'));
}
export function projectFolders(files: ProjectFile[], explicit: string[] = []): string[] {
  return [...new Set([...explicit, ...files.flatMap(f => parentFolders(f.path)), ...explicit.flatMap(parentFolders)])].sort();
}
export function chooseRoot(files: ProjectFile[]): ProjectFile {
  const candidates = files.filter(f => /\.tex$/i.test(f.path) && typeof f.content === 'string');
  if (!candidates.length) throw Error('ZIP 中没有 .tex 文件');
  const documents = candidates.filter(f => /^\s*\\documentclass\b/m.test(String(f.content)));
  const pool = documents.length ? documents : candidates;
  return pool.find(f => /(^|\/)Everflow-Exam\.tex$/i.test(f.path))
    || pool.find(f => /(^|\/)main\.tex$/i.test(f.path))
    || pool.find(f => /(^|\/)root\.tex$/i.test(f.path))
    || pool.slice().sort((a,b) => a.path.split('/').length - b.path.split('/').length)[0];
}
export function unwrapProject(files: ProjectFile[], folders: string[]): { files: ProjectFile[]; folders: string[] } {
  const root = chooseRoot(files), slash = root.path.indexOf('/');
  if (slash < 0) return { files, folders };
  const prefix = root.path.slice(0, slash + 1);
  // Remove an archive's enclosing directory only when a document lives directly
  // inside it and every file shares it. Internal project directories stay intact.
  if (root.path.slice(slash + 1).includes('/') || !files.every(f => f.path.startsWith(prefix))) return { files, folders };
  return { files: files.map(f => ({ ...f, path: f.path.slice(prefix.length) })),
    folders: folders.filter(p => p.startsWith(prefix)).map(p => p.slice(prefix.length)).filter(Boolean) };
}
export type FileNode = { path: string; name: string; directory: boolean; children: FileNode[] };
export function buildFileTree(files: ProjectFile[], folders: string[] = []): FileNode[] {
  const nodes = new Map<string, FileNode>();
  for (const path of projectFolders(files, folders)) nodes.set(path, { path, name: path.split('/').pop()!, directory: true, children: [] });
  for (const f of files) nodes.set(f.path, { path: f.path, name: f.path.split('/').pop()!, directory: false, children: [] });
  const roots: FileNode[] = [];
  for (const node of nodes.values()) {
    const parent = nodes.get(node.path.slice(0, node.path.lastIndexOf('/')));
    if (node.path.includes('/') && parent) parent.children.push(node); else roots.push(node);
  }
  function sort(items: FileNode[]): FileNode[] {
    return items.sort((a,b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name, 'zh-CN', { numeric: true }))
      .map(n => ({ ...n, children: sort(n.children) }));
  }
  return sort(roots);
}
