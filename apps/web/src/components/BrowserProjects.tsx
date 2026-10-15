import { useEffect, useMemo, useRef, useState } from 'react';
import type { ProjectRecord } from '../util/browser-projects';
import { TexPageIcon } from './TexPageIcon';

type Props = {
  records: ProjectRecord[]; current?: string; pending: boolean;
  onClose(): void; onUpload(): void; onNew(): void; onOpen(id: string): void;
  onZip(id: string): void; onDeleteZip(id: string): void; onTrash(id: string): void;
  onRestore(id: string): void; onDelete(id: string): void;
};
type Category = 'active' | 'starred' | 'trash';
const STAR_KEY = 'everflow.browser-projects.starred.v1';
const size = (n: number) => n < 1024 * 1024 ? Math.max(1, Math.ceil(n / 1024)) + ' KB' : (n / 1024 / 1024).toFixed(1) + ' MB';
const updated = (ms: number) => new Date(ms).toLocaleString('zh-CN', {year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
const getStars = (): string[] => {
  try { const result = JSON.parse(localStorage.getItem(STAR_KEY) || '[]'); return Array.isArray(result) ? result.filter(x => typeof x === 'string') : []; }
  catch { return []; }
};

export default function BrowserProjects(props: Props) {
  const [tab, setTab] = useState<Category>('active');
  const [query, setQuery] = useState('');
  const [stars, setStars] = useState<string[]>(getStars);
  const [sort, setSort] = useState<'recent' | 'name'>('recent');
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    return () => previous?.focus();
  }, []);

  const activeCount = props.records.filter(r => r.status === 'active').length;
  const trashCount = props.records.filter(r => r.status === 'trash').length;
  const rows = useMemo(() => props.records
    .filter(r => tab === 'trash' ? r.status === 'trash' : r.status === 'active' && (tab !== 'starred' || stars.includes(r.id)))
    .filter(r => (r.name + ' ' + (r.zipName || '')).toLocaleLowerCase().includes(query.toLocaleLowerCase()))
    .sort((a,b) => sort === 'recent' ? Number(b.updatedAt) - Number(a.updatedAt) : a.name.localeCompare(b.name,'zh-CN')),
    [props.records,tab,stars,query,sort]);

  function toggleStar(id: string) {
    const next = stars.includes(id) ? stars.filter(x=>x!==id) : [...stars,id];
    setStars(next);
    try { localStorage.setItem(STAR_KEY, JSON.stringify(next)); } catch { /* storage may be disabled */ }
  }

  function menu(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape' && !props.pending) { e.stopPropagation(); props.onClose(); }
    if (e.key === 'Tab') {
      const nodes = [...dialog.current!.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),summary')].filter(x => x.getClientRects().length > 0);
      const first=nodes[0],last=nodes[nodes.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
    }
  }

  return <div className="browser-projects-backdrop" onClick={e => { if (e.target === e.currentTarget && !props.pending) props.onClose(); }}>
    <div className="browser-projects texpage-console" role="dialog" aria-modal="true" aria-labelledby="browser-projects-title"
      tabIndex={-1} ref={dialog} onKeyDown={menu} data-testid="project-history">
      <header className="texpage-console__header">
        <div className="texpage-console__brand" aria-label="Everflow LaTeX">
          <span className="texpage-console__wordmark">Everflow<span className="texpage-console__tex">TeX</span></span>
          <span className="texpage-console__badge">永久免费 · 本地版</span>
        </div>
        <div className="texpage-console__header-links">
          <span className="texpage-console__local"><TexPageIcon name="check" /> 本机保存</span>
          <button className="texpage-console__header-btn" type="button" disabled={props.pending} onClick={props.onClose}>
            <TexPageIcon name="code" /> 返回编辑器
          </button>
        </div>
      </header>

      <div className="browser-projects-body texpage-console__body">
        <nav aria-label="工程分类" className="texpage-console__sidebar">
          <button className="texpage-console__new" type="button" disabled={props.pending} onClick={props.onNew}>
            <TexPageIcon name="plus" /> 新建
          </button>
          <button className="texpage-console__import" type="button" disabled={props.pending} onClick={props.onUpload}>
            <TexPageIcon name="upload" /> 上传 ZIP 工程
          </button>
          <div className="texpage-console__nav-group">
            <button className={'texpage-console__nav-item'+(tab==='active'?' selected':'')} onClick={()=>setTab('active')}>
              <TexPageIcon name="list" /> 全部工程 <span>({activeCount})</span>
            </button>
            <button className={'texpage-console__nav-item'+(tab==='starred'?' selected':'')} onClick={()=>setTab('starred')}>
              <TexPageIcon name="star" /> 星标工程 <span>({props.records.filter(r=>r.status==='active'&&stars.includes(r.id)).length})</span>
            </button>
            <button className={'texpage-console__nav-item'+(tab==='trash'?' selected':'')} onClick={()=>setTab('trash')}>
              <TexPageIcon name="trash" /> 回收站 <span>({trashCount})</span>
            </button>
          </div>
          <div className="texpage-console__nav-heading"><span>项目标签</span><TexPageIcon name="plus" /></div>
          <div className="texpage-console__nav-tag" aria-label="当前只有本地工程"><span className="texpage-console__tag-dot" /> 未分类 <span>({activeCount})</span></div>
          <p className="texpage-console__nav-note"><TexPageIcon name="info" /> 目前仅保存在当前浏览器。工程和 ZIP 缓存可独立管理，不会上传到其他服务器。</p>
        </nav>

        <section className="texpage-console__main">
          <div className="texpage-console__notice" role="note">
            <TexPageIcon name="info" />
            <span>所有工程数据仅保存在当前浏览器。建议定期导出 ZIP，防止清理缓存后丢失。</span>
          </div>
          <div className="browser-projects-tools texpage-console__tools">
            <h2 id="browser-projects-title">{tab==='active'?'全部工程':tab==='starred'?'星标工程':'回收站'}</h2>
            <div className="texpage-console__tools-right">
              <label className="texpage-console__search"><TexPageIcon name="search" />
                <input aria-label="搜索工程" placeholder="输入关键字，回车查询" value={query} onChange={e=>setQuery(e.target.value)} />
              </label>
              <select aria-label="工程排序" value={sort} onChange={e=>setSort(e.target.value as 'recent'|'name')}>
                <option value="recent">最近更新</option><option value="name">按名称</option>
              </select>
            </div>
          </div>
          <div className="texpage-console__list" aria-label="工程列表">
            {rows.length ? rows.map(r => <article className="texpage-console__record" key={r.id} data-testid={'project-record-'+r.id}>
              <button className={'texpage-console__star'+(stars.includes(r.id)?' is-starred':'')}
                type="button" aria-label={(stars.includes(r.id)?'取消星标 ':'星标 ')+r.name}
                aria-pressed={stars.includes(r.id)} onClick={()=>toggleStar(r.id)} title="星标工程">
                <TexPageIcon name="star" />
              </button>
              <div className="texpage-console__record-content">
                <button className="browser-projects-name" type="button" disabled={props.pending || tab==='trash'} onClick={()=>props.onOpen(r.id)}>
                  {r.name}
                </button>
                {r.id===props.current && <span className="browser-projects-current">当前工程</span>}
                <div className="texpage-console__record-meta">
                  <span>来自：本地浏览器</span><span>当前版本：local</span>
                  <span>最近更新：{updated(r.updatedAt)}</span>
                </div>
                <div className="texpage-console__record-extra">{r.fileCount} 个文件 · {size(r.bytes+r.zipBytes)}
                  {r.zipName && <> · 上传源：{r.zipName}</>}
                </div>
              </div>
              <details className="texpage-console__record-menu">
                <summary aria-label={'工程操作 '+r.name} title="工程操作"><TexPageIcon name="more" /></summary>
                <div className="texpage-console__record-popover">
                  {tab!=='trash' ? <>
                    <button disabled={props.pending} onClick={()=>props.onOpen(r.id)}><TexPageIcon name="code"/>打开工程</button>
                    {r.zipBytes>0 && <>
                      <button disabled={props.pending} onClick={()=>props.onZip(r.id)}><TexPageIcon name="download"/>下载原 ZIP</button>
                      <button disabled={props.pending} onClick={()=>props.onDeleteZip(r.id)}><TexPageIcon name="trash"/>删除 ZIP 缓存</button>
                    </>}
                    <button disabled={props.pending} onClick={()=>props.onTrash(r.id)}><TexPageIcon name="archive"/>移入回收站</button>
                  </> : <>
                    <button disabled={props.pending} onClick={()=>props.onRestore(r.id)}><TexPageIcon name="restore"/>恢复工程</button>
                    <button disabled={props.pending} onClick={()=>props.onDelete(r.id)}><TexPageIcon name="trash"/>彻底删除</button>
                  </>}
                </div>
              </details>
            </article>) : <div className="browser-projects-empty texpage-console__empty">
              <TexPageIcon name={tab==='trash'?'trash':'folder'} width={28} height={28}/>
              <strong>{query ? '没有匹配的工程' : tab==='trash' ? '回收站为空' : tab==='starred' ? '暂无星标工程' : '还没有工程'}</strong>
              <p>{query ? '试试其他关键字' : tab==='trash' ? '移入回收站的工程会显示在这里' :
                tab==='starred' ? '点击工程左侧的星形图标进行收藏' : '新建空白工程或导入已有的 ZIP 工程'}</p>
              {tab==='active' && !query && <button type="button" className="texpage-console__new" onClick={props.onNew} disabled={props.pending}><TexPageIcon name="plus"/>新建工程</button>}
            </div>}
          </div>
          <div className="texpage-console__footer"><span>共 {rows.length} 个工程</span><span>浏览器存储占用约 {size(props.records.reduce((sum,r)=>sum+r.bytes+r.zipBytes,0))}</span></div>
        </section>
      </div>
    </div>
  </div>;
}
