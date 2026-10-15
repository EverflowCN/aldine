import { test, expect } from '@playwright/test';
import { zipSync, unzipSync } from 'fflate';
import { dirname, resolve } from 'node:path';
import { readFileSync } from 'node:fs';
const fflateModule = resolve(dirname(require.resolve('fflate')), '../esm/browser.js');
const source = '\\documentclass{article}\n\\begin{document}\n\\input{题目/第一题}\n\\end{document}';
function crc32(bytes: Buffer): number { let crc = -1; for (const b of bytes) { crc ^= b; for (let i=0;i<8;i++) crc=(crc>>>1)^(crc&1?0xedb88320:0); } return (crc^-1)>>>0; }
function legacyZip() {
  const prefix=Buffer.from([0xc4,0xa3,0xb0,0xe5,0x2f]); // 模板/
  const entries=[{ name:Buffer.concat([prefix,Buffer.from('main.tex')]), data:Buffer.from(source) },
    { name:Buffer.concat([prefix,Buffer.from([0xcc,0xe2,0xc4,0xbf,0x2f,0xb5,0xda,0xd2,0xbb,0xcc,0xe2]),Buffer.from('.tex')]), data:Buffer.from([0xd6,0xd0,0xce,0xc4]) }];
  const locals:Buffer[]=[], central:Buffer[]=[]; let offset=0;
  for (const e of entries) {
    const crc=crc32(e.data), h=Buffer.alloc(30); h.writeUInt32LE(0x04034b50); h.writeUInt16LE(20,4); h.writeUInt32LE(crc,14); h.writeUInt32LE(e.data.length,18);h.writeUInt32LE(e.data.length,22);h.writeUInt16LE(e.name.length,26);
    locals.push(h,e.name,e.data);
    const c=Buffer.alloc(46);c.writeUInt32LE(0x02014b50);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt32LE(crc,16);c.writeUInt32LE(e.data.length,20);c.writeUInt32LE(e.data.length,24);c.writeUInt16LE(e.name.length,28);c.writeUInt32LE(offset,42);central.push(c,e.name);offset+=h.length+e.name.length+e.data.length;
  }
  const directory=Buffer.concat(central), end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...locals,directory,end]);
}
test.beforeEach(async ({ page }) => {
  await page.route(/\/browser-test\/fflate\.mjs(?:\?.*)?$/, r=>r.fulfill({path:fflateModule,contentType:'text/javascript'}));
  await page.route(/\/busytex-cache\.mjs(?:\?.*)?$/, r=>r.fulfill({contentType:'text/javascript',body:'export async function prepareBusyTeXCache(){return {coreCached:true}}; export async function getBusyTeXCacheStatus(){return {coreCached:true}}'}));
  await page.goto('/?local=1');
  await expect(page.getByTestId('browser-compile')).toBeEnabled();
  page.on('dialog', d=>d.accept());
});
test('GBK ZIP names, source text and enclosing directory import correctly', async ({ page }) => {
  await page.locator('input[accept*="application/zip"]').setInputFiles({name:'中文模板.zip',mimeType:'application/zip',buffer:legacyZip()});
  await expect(page.locator('.browser-aldine__status-text')).toContainText('ZIP 已导入');
  await expect(page.getByTestId('folder-题目')).toBeVisible();
  await page.getByTestId('file-题目/第一题.tex').click();
  await expect(page.getByTestId('active-file')).toHaveText('题目/第一题.tex');
  await expect(page.locator('.cm-content')).toContainText('中文');
  await expect(page.getByTestId('preflight-panel')).not.toContainText('未在 ZIP 工程中找到引用文件');
  await page.getByRole('button',{name:'关闭',exact:true}).click();
  await page.getByTestId('folder-题目').click();
  await expect(page.getByTestId('file-题目/第一题.tex')).toBeHidden();
  await page.getByRole('textbox',{name:'搜索文件',exact:true}).fill('第一题');
  await expect(page.getByTestId('file-题目/第一题.tex')).toBeVisible();
});
test('empty folders, moves, root changes and ZIP roundtrip survive reload', async ({ page }) => {
  page.removeAllListeners('dialog');
  page.once('dialog', d=>d.accept('资料'));
  await page.getByTestId('create-folder').click();
  await expect(page.getByTestId('folder-资料')).toBeVisible();
  page.once('dialog',d=>d.accept('资料/笔记.tex'));
  await page.getByRole('button',{name:'新建源文件（快捷）'}).click();
  await expect(page.getByTestId('file-资料/笔记.tex')).toBeVisible();
  page.once('dialog',d=>d.accept('资料/正文.tex'));
  await page.getByRole('button',{name:'重命名或移动 资料/笔记.tex',exact:true}).click();
  await expect(page.getByTestId('active-file')).toHaveText('资料/正文.tex');
  page.once('dialog',d=>d.accept('主文档.tex'));
  await page.getByRole('button',{name:'重命名或移动 main.tex',exact:true}).click();
  await expect(page.getByRole('combobox',{name:'主文档'})).toHaveValue('主文档.tex');
  await expect(page.getByRole('button',{name:'删除 主文档.tex',exact:true})).toBeDisabled();
  page.once('dialog',d=>d.accept('空文件夹'));
  await page.getByTestId('create-folder').click();
  await page.waitForTimeout(700);
  await page.reload();
  await expect(page.getByTestId('folder-空文件夹')).toBeVisible();
  await expect(page.getByTestId('file-资料/正文.tex')).toBeVisible();
  const pending=page.waitForEvent('download');
  await page.getByRole('button',{name:'导出 ZIP',exact:true}).first().click();
  const download=await pending;const data=unzipSync(new Uint8Array(readFileSync((await download.path())!)));
  expect(Object.keys(data)).toEqual(expect.arrayContaining(['空文件夹/','资料/正文.tex','主文档.tex']));
  page.once('dialog',d=>d.accept());
  await page.locator('input[accept*="application/zip"]').setInputFiles({name:'往返.zip',mimeType:'application/zip',buffer:Buffer.from(zipSync(data))});
  await expect(page.locator('.browser-aldine__status-text')).toContainText('ZIP 已导入');
  await expect(page.getByTestId('folder-空文件夹')).toBeVisible();
});

test('repairs an already-saved legacy Chinese root filename', async ({ page }) => {
  await page.evaluate(async () => {
    const legacy = String.fromCharCode(0xd6,0xd0,0xce,0xc4) + '.tex';
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('everflow-aldine-browser-v1', 1);
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result, tx = db.transaction('data','readwrite');
        tx.objectStore('data').put({name:'旧工程',rootFile:legacy,engine:'xelatex',files:[{path:legacy,content:'\\documentclass{article}'}]},'workspace');
        tx.oncomplete=()=>{db.close();resolve();}; tx.onerror=()=>reject(tx.error);
      };
    });
  });
  await page.reload();
  await page.locator('.texpage-editor__more-files summary').click();
  await expect(page.getByRole('button',{name:'修复旧中文名称',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'修复旧中文名称',exact:true}).click();
  await expect(page.getByTestId('file-中文.tex')).toBeVisible();
  await expect(page.getByRole('combobox',{name:'主文档'})).toHaveValue('中文.tex');
  await expect(page.getByTestId('active-file')).toHaveText('中文.tex');
});
