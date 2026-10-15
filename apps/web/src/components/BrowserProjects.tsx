import { useEffect, useRef, useState } from 'react';
import type { ProjectRecord } from '../util/browser-projects';
type Props = { records: ProjectRecord[]; current?: string; pending: boolean; onClose(): void; onUpload(): void; onNew(): void; onOpen(id: string): void; onZip(id: string): void; onDeleteZip(id: string): void; onTrash(id: string): void; onRestore(id: string): void; onDelete(id: string): void };
const size = (n: number) => n < 1024 * 1024 ? Math.ceil(n / 1024) + ' KB' : (n / 1024 / 1024).toFixed(1) + ' MB';
export default function BrowserProjects(props: Props) {
  const [tab, setTab] = useState<'active' | 'trash'>('active'), [query, setQuery] = useState('');
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => { const previous = document.activeElement as HTMLElement | null; dialog.current?.focus(); return () => previous?.focus(); }, []);
  const records = props.records.filter(r => r.status === tab && (r.name + ' ' + r.zipName).toLowerCase().includes(query.toLowerCase()));
  return <div className="browser-projects-backdrop" onClick={e => { if (e.target === e.currentTarget && !props.pending) props.onClose(); }}>
    <div className="browser-projects" role="dialog" aria-modal="true" aria-labelledby="browser-projects-title" tabIndex={-1} ref={dialog} data-testid="project-history"
      onKeyDown={e => {
        if (e.key === 'Escape' && !props.pending) props.onClose();
        if (e.key === 'Tab') {
          const nodes = [...dialog.current!.querySelectorAll<HTMLElement>('button:not(:disabled),input')];
          const first = nodes[0], last = nodes[nodes.length - 1];
          if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { e.preventDefault(); last?.focus(); }
          else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
        }
      }}>
      <header><div><h2 id="browser-projects-title">Everflow · 我的工程</h2><p>上传记录与编辑内容保存在当前浏览器</p></div><button className="btn" disabled={props.pending} onClick={props.onClose}>返回编辑器</button></header>
      <div className="browser-projects-body">
        <nav aria-label="工程分类">
          <button className="btn btn--primary" disabled={props.pending} onClick={props.onUpload}>上传 ZIP 工程</button>
          <button className="btn" disabled={props.pending} onClick={props.onNew}>新建工程</button>
          <button className={'btn' + (tab === 'active' ? ' selected' : '')} onClick={() => setTab('active')}>全部工程 <span>{props.records.filter(r=>r.status==='active').length}</span></button>
          <button className={'btn' + (tab === 'trash' ? ' selected' : '')} onClick={() => setTab('trash')}>回收站 <span>{props.records.filter(r=>r.status==='trash').length}</span></button>
          <small>原 ZIP 缓存可单独删除，工程文件仍会保留。回收站内彻底删除会释放该工程的全部缓存。</small>
        </nav>
        <section>
          <div className="browser-projects-tools"><input aria-label="搜索工程" placeholder="搜索工程或 ZIP 名称" value={query} onChange={e=>setQuery(e.target.value)} /><span>{props.records.length} 个工程 · 约 {size(props.records.reduce((n,r)=>n+r.bytes+r.zipBytes,0))}</span></div>
          <div className="browser-projects-table"><table><thead><tr><th>工程名称</th><th>最近编辑</th><th>缓存</th><th>操作</th></tr></thead><tbody>
            {records.map(r=><tr key={r.id} data-testid={'project-record-'+r.id}><td><button className="browser-projects-name" disabled={props.pending || tab==='trash'} onClick={()=>props.onOpen(r.id)}>{r.name}</button>{r.id===props.current && <b className="browser-projects-current">当前</b>}<small>{r.zipName || '本地工程'} · {r.fileCount} 个文件</small></td>
              <td>{new Date(r.updatedAt).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})}</td><td>约 {size(r.bytes+r.zipBytes)}<small>原 ZIP：{r.zipBytes ? size(r.zipBytes) : '无缓存'}</small></td>
              <td><div className="browser-projects-row-actions">{tab==='active' ? <>
                <button className="btn btn--small" disabled={props.pending} onClick={()=>props.onOpen(r.id)}>打开</button>
                {r.zipBytes>0 && <><button className="btn btn--small" disabled={props.pending} onClick={()=>props.onZip(r.id)}>下载原 ZIP</button><button className="btn btn--small" disabled={props.pending} onClick={()=>props.onDeleteZip(r.id)}>删除 ZIP 缓存</button></>}
                <button className="btn btn--ghost btn--small" disabled={props.pending} onClick={()=>props.onTrash(r.id)}>移入回收站</button>
              </> : <><button className="btn btn--small" disabled={props.pending} onClick={()=>props.onRestore(r.id)}>恢复</button><button className="btn btn--small" disabled={props.pending} onClick={()=>props.onDelete(r.id)}>彻底删除</button></>}</div></td></tr>)}
          </tbody></table>{!records.length && <div className="browser-projects-empty">{query ? '没有匹配的工程' : tab==='trash' ? '回收站为空' : '还没有上传记录，导入 ZIP 后会自动保存在这里。'}</div>}</div>
        </section>
      </div>
    </div>
  </div>;
}
