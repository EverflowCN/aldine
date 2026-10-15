import { useEffect, useMemo, useState } from 'react';
import { buildFileTree, parentFolders } from '../util/latex-project-files';
import type { FileNode, ProjectFile } from '../util/latex-project-files';
import { fileIcon, IconStar, IconX } from './Icons';

type Props = {
  files: ProjectFile[]; folders: string[]; active: string; root: string;
  selectedFolder: string; disabled: boolean;
  onSelect(path: string): void; onFolder(path: string): void;
  onRoot(path: string): void; onRename(path: string, directory: boolean): void;
  onDelete(path: string, directory: boolean): void;
};
function FolderIcon({ open }: { open: boolean }) {
  return <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
    <path d="M2.5 6V4.5h5L9 6h8.5v10h-15Z" />
    {open && <path d="m2.5 9 2 7h13l1-7Z" fill="var(--bg-panel)" />}
  </svg>;
}
export default function BrowserFileTree(props: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const tree = useMemo(() => buildFileTree(props.files, props.folders), [props.files, props.folders]);
  useEffect(() => {
    setCollapsed(old => { const next = new Set(old); parentFolders(props.selectedFolder).forEach(p => next.delete(p)); return next; });
  }, [props.selectedFolder]);
  const search = query.trim().toLocaleLowerCase();
  function matches(node: FileNode): boolean {
    return !search || node.path.toLocaleLowerCase().includes(search) || node.children.some(matches);
  }
  function toggle(path: string): void {
    props.onFolder(path);
    setCollapsed(old => { const next = new Set(old); if (!next.delete(path)) next.add(path); return next; });
  }
  function render(nodes: FileNode[], depth = 0) {
    return nodes.filter(matches).map(node => {
      const expanded = Boolean(search) || !collapsed.has(node.path);
      const selected = node.directory ? props.selectedFolder === node.path : props.active === node.path;
      return <li key={node.path} role="treeitem" aria-expanded={node.directory ? expanded : undefined} aria-selected={selected}>
        <div className={'browser-aldine__tree-row' + (selected ? ' browser-aldine__tree-row--active' : '')}
          style={{ paddingLeft: depth * 14 }}>
          <button type="button" className="tree__item" title={node.path}
            data-testid={(node.directory ? 'folder-' : 'file-') + node.path}
            aria-label={(node.directory ? '文件夹 ' : '文件 ') + node.path}
            onKeyDown={e => {
              if (node.directory && ['ArrowRight', 'ArrowLeft'].includes(e.key)) {
                e.preventDefault(); props.onFolder(node.path);
                setCollapsed(old => { const next = new Set(old); if (e.key === 'ArrowLeft') next.add(node.path); else next.delete(node.path); return next; });
              }
            }}
            onClick={() => node.directory ? toggle(node.path) : props.onSelect(node.path)}>
            <span className="browser-aldine__disclosure" aria-hidden="true">{node.directory ? expanded ? '⌄' : '›' : ''}</span>
            <span className="tree__icon">{node.directory ? <FolderIcon open={expanded} /> : fileIcon(node.path, node.path === props.root)}</span>
            <span className="browser-aldine__filename">{node.name}</span>
            {node.path === props.root && <span className="tree__root-tag">主</span>}
          </button>
          {!node.directory && /\.tex$/i.test(node.path) && <button type="button" className="browser-aldine__tree-more"
            title={'设为主文件 ' + node.path} aria-label={'设为主文件 ' + node.path} disabled={props.disabled}
            onClick={() => props.onRoot(node.path)}><IconStar width={12} /></button>}
          <button type="button" className="browser-aldine__tree-more" title={'重命名或移动 ' + node.path}
            aria-label={'重命名或移动 ' + node.path} disabled={props.disabled}
            onClick={() => props.onRename(node.path, node.directory)}>
            <svg width="12" height="12" viewBox="0 0 16 16" stroke="currentColor" fill="none" aria-hidden="true"><path d="m3 10 7-7 3 3-7 7-4 1Z" /></svg>
          </button>
          <button type="button" className="browser-aldine__tree-more" title={'删除 ' + node.path} aria-label={'删除 ' + node.path}
            disabled={props.disabled || node.path === props.root || (node.directory && props.root.startsWith(node.path + '/'))}
            onClick={() => props.onDelete(node.path, node.directory)}><IconX /></button>
        </div>
        {node.directory && expanded && <ul role="group">{render(node.children, depth + 1)}</ul>}
      </li>;
    });
  }
  return <div className="browser-aldine__file-explorer">
    <label className="browser-aldine__file-search"><span className="sr-only">搜索文件</span>
      <input value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索文件或文件夹" aria-label="搜索文件" />
    </label>
    <div className="browser-aldine__explorer-tools">
      <button type="button" className="btn btn--ghost btn--small" onClick={() => props.onFolder('')}>项目根目录</button>
      <button type="button" className="btn btn--ghost btn--small" onClick={() => setCollapsed(new Set())}>展开</button>
      <button type="button" className="btn btn--ghost btn--small" onClick={() => setCollapsed(new Set(tree.flatMap(function all(n): string[] { return n.directory ? [n.path, ...n.children.flatMap(all)] : []; })))}>折叠</button>
    </div>
    <ul role="tree" aria-label="项目文件" className="browser-aldine__file-nodes">{render(tree)}</ul>
    {search && !tree.some(matches) && <p className="browser-aldine__no-files">没有匹配的文件</p>}
  </div>;
}
