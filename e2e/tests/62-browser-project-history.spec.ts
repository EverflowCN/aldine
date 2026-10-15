import { test, expect } from '@playwright/test';
import { zipSync } from 'fflate';
import { dirname, resolve } from 'node:path';
const fflateModule = resolve(dirname(require.resolve('fflate')), '../esm/browser.js');
const encoder = new TextEncoder();
const zip = (label: string) => Buffer.from(zipSync({'main.tex':encoder.encode('\\documentclass{article}\n\\begin{document}\n'+label+'\n\\end{document}')}));
test.beforeEach(async ({ page }) => {
  await page.route(/\/browser-test\/fflate\.mjs(?:\?.*)?$/, r=>r.fulfill({path:fflateModule,contentType:'text/javascript'}));
  page.on('dialog',d=>d.accept());
});
test('ZIP history retains separate projects, original cache deletion and trash cleanup', async ({ page }) => {
  await page.goto('/?local=1');
  await expect(page.getByTestId('browser-compile')).toBeEnabled();
  const upload = page.locator('input[accept*="application/zip"]');
  await upload.setInputFiles({name:'工程甲.zip',mimeType:'application/zip',buffer:zip('Alpha')});
  await expect(page.locator('.browser-aldine__status-text')).toContainText('ZIP 已导入');
  await upload.setInputFiles({name:'工程乙.zip',mimeType:'application/zip',buffer:zip('Beta')});
  await expect(page.getByRole('textbox',{name:'项目名称',exact:true})).toHaveValue('工程乙');
  await page.getByTestId('open-projects').click();
  const dialog=page.getByTestId('project-history');
  const alpha=dialog.locator('tr').filter({has:page.getByRole('button',{name:'工程甲',exact:true})});
  const beta=dialog.locator('tr').filter({has:page.getByRole('button',{name:'工程乙',exact:true})});
  await expect(alpha).toBeVisible();await expect(beta).toBeVisible();
  await alpha.getByRole('button',{name:'删除 ZIP 缓存',exact:true}).click();
  await expect(alpha).toContainText('原 ZIP：无缓存');
  await expect(beta.getByRole('button',{name:'下载原 ZIP',exact:true})).toBeEnabled();
  await alpha.getByRole('button',{name:'打开',exact:true}).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('.cm-content')).toContainText('Alpha');
  await page.locator('.cm-content').fill('\\documentclass{article}\n% Alpha edited');
  await page.getByTestId('open-projects').click();
  await beta.getByRole('button',{name:'打开',exact:true}).click();
  await expect(page.locator('.cm-content')).toContainText('Beta');
  await page.getByTestId('open-projects').click();
  await alpha.getByRole('button',{name:'打开',exact:true}).click();
  await expect(page.locator('.cm-content')).toContainText('Alpha edited');
  await page.getByTestId('open-projects').click();
  await alpha.getByRole('button',{name:'移入回收站',exact:true}).click();
  await dialog.getByRole('button',{name:/^回收站/}).click();
  await expect(alpha).toBeVisible();
  await alpha.getByRole('button',{name:'恢复',exact:true}).click();
  await dialog.getByRole('button',{name:/^全部工程/}).click();
  await expect(alpha).toBeVisible();
  await alpha.getByRole('button',{name:'移入回收站',exact:true}).click();
  await dialog.getByRole('button',{name:/^回收站/}).click();
  await alpha.getByRole('button',{name:'彻底删除',exact:true}).click();
  await expect(alpha).toHaveCount(0);
  await page.reload();
  await page.getByTestId('open-projects').click();
  await expect(dialog.locator('tr').filter({hasText:'工程甲'})).toHaveCount(0);
  await expect(dialog.locator('tr').filter({hasText:'工程乙'})).toHaveCount(1);
  const storage=await page.evaluate(async()=>{
    const req=indexedDB.open('everflow-aldine-projects-v1');const db=await new Promise<IDBDatabase>((ok,no)=>{req.onsuccess=()=>ok(req.result);req.onerror=()=>no(req.error)});
    const tx=db.transaction(['index','snapshots','archives'],'readonly');
    const count=(store:string)=>new Promise<number>(ok=>{const r=tx.objectStore(store).count();r.onsuccess=()=>ok(r.result)});
    const result=await Promise.all([count('index'),count('snapshots'),count('archives')]);db.close();return result;
  });
  expect(storage).toEqual([1,1,1]);
});
test('local startup does not request collaboration, PDF.js or TeX runtime bundles', async ({ page }) => {
  const urls:string[]=[];page.on('request',r=>urls.push(r.url()));
  await page.goto('/?local=1');
  await expect(page.getByTestId('browser-compile')).toBeEnabled();
  await expect(page.locator('.cm-content')).toBeVisible();
  await page.waitForLoadState('networkidle');
  expect(urls.filter(url=> /\/(?:ServerApp-|Editor-|PdfPane-|mathlive|katex|busytex-lib)|\.(?:wasm|data)(?:\?|$)|\/api\//.test(url))).toEqual([]);
  const stats=await page.evaluate(()=>({navigation:performance.getEntriesByType('navigation').map(n=>({domContentLoaded:(n as PerformanceNavigationTiming).domContentLoadedEventEnd})),scripts:performance.getEntriesByType('resource').filter(r=>r.name.endsWith('.js')).map(r=>({bytes:(r as PerformanceResourceTiming).decodedBodySize}))}));
  console.log('Local startup measurement',JSON.stringify(stats));
});

test('dashboard entry and TeXPage-style output/outline keep the source usable', async ({ page }) => {
  await page.goto('/?local=1');
  await expect(page.getByTestId('browser-compile')).toBeEnabled();
  await page.getByTestId('open-projects').click();
  await expect(page.getByTestId('project-history')).toBeVisible();
  await expect(page.locator('.cm-content')).toHaveCount(0);
  await page.getByRole('button', {name:'返回编辑器'}).click();
  await page.locator('.cm-content').fill('\\documentclass{article}\n\\begin{document}\n\\section{第一章}\nText\n\\subsection{第二节}\nMore\n\\end{document}');
  const outline = page.getByTestId('file-outline');
  await expect(outline.getByRole('button', {name:'第一章'})).toBeVisible();
  await outline.getByRole('button', {name:'第二节'}).click();
  await expect(page.locator('.cm-content')).toBeFocused();
  const tabs = page.getByRole('tablist', {name:'编译输出'});
  await tabs.getByRole('tab', {name:/日志/}).click();
  await expect(page.getByTestId('browser-compile-log')).toBeVisible();
  const source = await page.locator('.browser-aldine__source').boundingBox();
  const log = await page.getByTestId('browser-compile-log').boundingBox();
  expect(log!.x).toBeGreaterThan(source!.x + source!.width - 2);
  await tabs.getByRole('tab', {name:'PDF',exact:true}).click();
  await expect(page.getByTestId('pdf-empty')).toBeVisible();
  await expect(page.getByTestId('browser-compile-log')).toBeHidden();
});

test('failed PDF lazy loading preserves the editor and provides native preview', async ({ page }) => {
  const manifests = Array.from({length:12},(_,i)=>'\\ProvidesPackage{fixture'+i+'}').join('\n');
  await page.route(/texlive-.*\.txt$/, r => r.fulfill({body:manifests}));
  await page.route(/busytex-cache\.mjs$/, r=>r.fulfill({contentType:'text/javascript',body:'export async function prepareBusyTeXCache(){return {coreCached:true}};export async function getBusyTeXCacheStatus(){return {coreCached:true}}'}));
  await page.route(/busytex-lib\.mjs$/, r=>r.fulfill({contentType:'text/javascript',body:`export class BusyTexRunner{async initialize(){}terminate(){}}; class Engine{async compile(){return {success:true,pdf:new TextEncoder().encode('%PDF-1.4\\n'),logs:[]}}}; export {Engine as XeLatex,Engine as PdfLatex,Engine as LuaLatex};`}));
  await page.route(/\/PdfPane-[^/]+\.js$/, r=>r.abort());
  await page.goto('/?local=1');
  await page.getByTestId('browser-compile').click();
  await expect(page.locator('.browser-aldine__status-text')).toContainText('编译成功');
  await page.getByRole('combobox',{name:'PDF 预览模式'}).selectOption('pdfjs');
  await expect(page.getByTestId('pdf-fallback')).toBeVisible();
  await expect(page.locator('.cm-content')).toBeVisible();
  await expect(page.getByTestId('open-projects')).toBeEnabled();
});

test('local compile shows elapsed ETA and recovers exit-code-zero with no PDF', async ({ page }) => {
  const packages = Array.from({length:12},(_,i)=>'\\ProvidesPackage{fixture'+i+'}').join('\n');
  await page.route(/texlive-.*\.txt$/, r => r.fulfill({contentType:'text/plain',body:packages}));
  await page.route(/busytex-cache\.mjs(?:\?.*)?$/, r => r.fulfill({contentType:'text/javascript',body:
    'export async function prepareBusyTeXCache(){return {coreCached:true}};export async function getBusyTeXCacheStatus(){return {coreCached:true}}'}));
  await page.route(/busytex-lib\.mjs(?:\?.*)?$/, r => r.fulfill({contentType:'text/javascript',body:`
    export class BusyTexRunner {async initialize(){}terminate(){}}
    class Engine {
      async compile(options) {
        window.__compileAttempts = [...(window.__compileAttempts || []), options.rerun];
        await new Promise(resolve=>setTimeout(resolve, options.rerun ? 3000 : 150));
        if (options.rerun) return {success:true, exitCode:0, logs:[]};
        return {success:true, exitCode:0, pdf:new TextEncoder().encode('%PDF-1.4\\nrecovered'), logs:[]};
      }
    }
    export {Engine as XeLatex, Engine as PdfLatex, Engine as LuaLatex};
  `}));
  await page.goto('/?local=1');
  await page.getByTestId('browser-compile').click();
  const eta = page.getByTestId('compile-eta');
  await expect(eta).toBeVisible();
  await expect(eta).toContainText(/已用.*预计剩余/, {timeout: 3000});
  await page.waitForFunction(() => /编译成功|编译失败/.test(document.querySelector('.browser-aldine__status-text')?.textContent || ''), null, {timeout: 15000});
  const compileResult = await page.locator('.browser-aldine__status-text').textContent();
  if (!compileResult?.includes('编译成功')) {
    console.log('Synthetic compile failure:', (await page.getByTestId('browser-compile-log').textContent()).slice(0, 1800));
    console.log('Synthetic compile attempts:', await page.evaluate(() => (window as any).__compileAttempts));
  }
  expect(compileResult).toContain('编译成功');
  expect(await page.evaluate(() => (window as any).__compileAttempts)).toEqual([true,false]);
  await expect(eta).toHaveCount(0);
  await expect(page.locator('.browser-aldine__status-text')).toContainText('单轮编译恢复 PDF');
});


test('two consecutive local compilations use latest editor content and new PDF blob', async ({page}) => {
  const manifest = Array.from({length:12}, (_,i)=>String.fromCharCode(92)+'ProvidesPackage{fixture'+i+'}').join(String.fromCharCode(10));
  await page.route(/texlive-.*\.txt$/, route=>route.fulfill({contentType:'text/plain',body:manifest}));
  await page.route(/busytex-cache\.mjs(?:\?.*)?$/, route=>route.fulfill({contentType:'text/javascript',body:
    'export async function prepareBusyTeXCache(){return {coreCached:true}};export async function getBusyTeXCacheStatus(){return {coreCached:true}};'}));
  const stub = [
    'export class BusyTexRunner { async initialize(){} terminate(){} }',
    'class Engine { async compile(options) {',
    'window.__compiledSources = [...(window.__compiledSources || []), options.input];',
    'await new Promise(done=>setTimeout(done,200));',
    'const pdf = new TextEncoder().encode("%PDF-1.4 " + options.input);',
    'return {success:true, exitCode:0, pdf, logs:[]};',
    '} }',
    'export {Engine as XeLatex,Engine as PdfLatex,Engine as LuaLatex};'
  ].join('\n');
  await page.route(/busytex-lib\.mjs(?:\?.*)?$/, route=>route.fulfill({contentType:'text/javascript',body:stub}));
  await page.goto('/?local=1');
  await page.getByTestId('browser-compile').click();
  await expect(page.locator('.browser-aldine__status-text')).toContainText('编译成功');
  const previous = await page.getByRole('link',{name:'下载 PDF'}).getAttribute('href');
  await page.locator('.cm-content').fill(String.fromCharCode(92)+'documentclass{article}\nSECOND-BUILD');
  await expect(page.locator('.cm-content')).toContainText('SECOND-BUILD');
  await page.getByTestId('browser-compile').click();
  try {
    await page.waitForFunction(oldUrl => {
      const status = document.querySelector('.browser-aldine__status-text')?.textContent || '';
      const link = document.querySelector('a[download$=".pdf"]')?.getAttribute('href');
      return status.includes('编译成功') && !!link && link !== oldUrl;
    }, previous, {timeout:5000});
  } catch (error) {
    console.log('Two-pass local state:', await page.evaluate(() => ({
      status:document.querySelector('.browser-aldine__status-text')?.textContent,
      elapsed:document.querySelector('[data-testid="compile-eta"]')?.textContent,
      disabled:document.querySelector('[data-testid="browser-compile"]')?.hasAttribute('disabled'),
      href:document.querySelector('a[download$=".pdf"]')?.getAttribute('href'),
      sources:(window as any).__compiledSources?.map((s:string)=>s.slice(0,130)),
      editor:document.querySelector('.cm-content')?.textContent?.slice(0,130),
      errors:document.querySelector('[data-testid="browser-compile-log"]')?.textContent?.slice(0,800)
    })));
    throw error;
  }
  const sources = await page.evaluate(() => (window as any).__compiledSources as string[]);
  expect(sources).toHaveLength(2);
  expect(sources[1]).toContain('SECOND-BUILD');
});
