export type LocalFile = { path: string; content: string | Uint8Array };
export type LocalProject = { name: string; rootFile: string; engine: 'xelatex' | 'pdflatex' | 'lualatex'; files: LocalFile[]; folders?: string[]; projectId?: string };
export type ProjectRecord = { id: string; name: string; zipName: string; createdAt: number; updatedAt: number; fileCount: number; bytes: number; zipBytes: number; status: 'active' | 'trash' };
type StoredProject = { workspace: LocalProject };
const DB = 'everflow-aldine-projects-v1';
async function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('index')) db.createObjectStore('index', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('snapshots')) db.createObjectStore('snapshots');
      if (!db.objectStoreNames.contains('archives')) db.createObjectStore('archives');
      const tx = req.transaction!, cursor = tx.objectStore('snapshots').openCursor();
      cursor.onsuccess = () => {
        const row = cursor.result;
        if (!row) return;
        if (row.value.zip) { tx.objectStore('archives').put(row.value.zip, row.key); row.update({ workspace: row.value.workspace }); }
        row.continue();
      };
    };
    req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
  });
}
async function transact<T>(mode: IDBTransactionMode, work: (tx: IDBTransaction, result: (value: T) => void) => void): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(['index', 'snapshots', 'archives'], mode); let value: T;
      tx.oncomplete = () => resolve(value); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error || Error('工程缓存操作取消'));
      work(tx, v => { value = v; });
    });
  } finally { db.close(); }
}
function bytes(workspace: LocalProject): number {
  const encoder = new TextEncoder();
  return workspace.files.reduce((n, f) => n + (typeof f.content === 'string' ? encoder.encode(f.content).length : f.content.byteLength), 0);
}
export async function listProjects(): Promise<ProjectRecord[]> {
  // Read metadata only: dozens of uploaded ZIPs must not inflate startup memory.
  return transact('readonly', (tx, done) => { const req = tx.objectStore('index').getAll(); req.onsuccess = () => done((req.result as ProjectRecord[]).sort((a,b) => b.updatedAt - a.updatedAt)); });
}
export async function createProject(workspace: LocalProject, zip?: File): Promise<LocalProject> {
  const project = { ...workspace, projectId: crypto.randomUUID() };
  const now = Date.now();
  await transact<void>('readwrite', (tx, done) => {
    tx.objectStore('index').add({ id: project.projectId, name: project.name, zipName: zip?.name || '', createdAt: now, updatedAt: now,
      fileCount: project.files.length, bytes: bytes(project), zipBytes: zip?.size || 0, status: 'active' } satisfies ProjectRecord);
    tx.objectStore('snapshots').add({ workspace: project } satisfies StoredProject, project.projectId);
    if (zip) tx.objectStore('archives').add(zip, project.projectId); done();
  });
  return project;
}
export async function loadProject(id: string): Promise<LocalProject | null> {
  return transact('readonly', (tx, done) => {
    const meta = tx.objectStore('index').get(id);
    meta.onsuccess = () => {
      if (!meta.result || meta.result.status !== 'active') { done(null); return; }
      const req = tx.objectStore('snapshots').get(id); req.onsuccess = () => done(req.result?.workspace || null);
    };
  });
}
export async function saveProject(workspace: LocalProject): Promise<boolean> {
  if (!workspace.projectId) return false;
  return transact('readwrite', (tx, done) => {
    const index = tx.objectStore('index'), data = tx.objectStore('snapshots');
    const req = index.get(workspace.projectId!);
    req.onsuccess = () => {
      // A late autosave must never resurrect a deleted or trashed project.
      const meta = req.result as ProjectRecord | undefined;
      if (!meta || meta.status !== 'active') { done(false); return; }
      data.put({ workspace } satisfies StoredProject, meta.id);
      index.put({ ...meta, name: workspace.name, updatedAt: Date.now(), fileCount: workspace.files.length, bytes: bytes(workspace) }); done(true);
    };
  });
}
export async function projectZip(id: string): Promise<Blob | null> {
  return transact('readonly', (tx, done) => { const req = tx.objectStore('archives').get(id); req.onsuccess = () => done(req.result || null); });
}
export async function deleteZipCache(id: string): Promise<void> {
  await transact<void>('readwrite', (tx, done) => {
    const index = tx.objectStore('index'); const meta = index.get(id);
    meta.onsuccess = () => { if (!meta.result) { done(); return; }
      tx.objectStore('archives').delete(id); index.put({ ...meta.result, zipBytes: 0 }); done();
    };
  });
}
export async function setProjectStatus(id: string, status: 'active' | 'trash'): Promise<void> {
  await transact<void>('readwrite', (tx, done) => { const store = tx.objectStore('index'), req = store.get(id); req.onsuccess = () => {
    if (req.result) store.put({ ...req.result, status }); done();
  }; });
}
export async function deleteProject(id: string): Promise<void> {
  await transact<void>('readwrite', (tx, done) => { tx.objectStore('index').delete(id); tx.objectStore('snapshots').delete(id); tx.objectStore('archives').delete(id); done(); });
}
