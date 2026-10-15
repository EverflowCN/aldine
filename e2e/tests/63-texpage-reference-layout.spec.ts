import { test, expect } from '@playwright/test';

test('uploaded TeXPage console geometry: 50px header, 280px navigation and project cards', async ({page}) => {
  await page.goto('/');
  const home=page.getByTestId('project-history');
  await expect(home).toBeVisible();
  await expect(home.getByText('Everflow',{exact:false}).first()).toBeVisible();
  const header=home.locator('.texpage-console__header');
  const sidebar=home.locator('.texpage-console__sidebar');
  const hb=await header.boundingBox(), sb=await sidebar.boundingBox();
  expect(hb).not.toBeNull(); expect(sb).not.toBeNull();
  expect(hb!.height).toBeGreaterThanOrEqual(48);
  expect(hb!.height).toBeLessThanOrEqual(53);
  expect(sb!.width).toBeGreaterThanOrEqual(276);
  expect(sb!.width).toBeLessThanOrEqual(284);
  await expect(home.getByRole('button',{name:/^全部工程/})).toBeVisible();
  await expect(home.getByRole('button',{name:/^星标工程/})).toBeVisible();
  await expect(home.getByRole('button',{name:/^回收站/})).toBeVisible();
  await expect(home.getByRole('button',{name:'上传 ZIP 工程'})).toBeEnabled();
  expect(await home.locator('svg').count()).toBeGreaterThan(8);
  await home.getByRole('button',{name:'返回编辑器'}).click();
  await expect(page.getByTestId('browser-compile')).toBeEnabled();
});

test('uploaded TeXPage editor geometry: compact top header, file + outline, source and PDF', async ({page}) => {
  await page.goto('/?local=1');
  await expect(page.getByTestId('browser-compile')).toBeEnabled();
  const top=await page.locator('.browser-aldine__toolbar').boundingBox();
  const explorer=await page.getByTestId('sidebar').boundingBox();
  const source=await page.locator('.browser-aldine__source').boundingBox();
  const preview=await page.locator('.browser-aldine__preview').boundingBox();
  expect(top).not.toBeNull();
  expect(top!.height).toBeGreaterThanOrEqual(39);
  expect(top!.height).toBeLessThanOrEqual(45);
  expect(explorer!.width).toBeGreaterThanOrEqual(245);
  expect(explorer!.width).toBeLessThanOrEqual(255);
  expect(source!.x).toBeGreaterThan(explorer!.x + explorer!.width - 2);
  expect(preview!.x).toBeGreaterThan(source!.x+source!.width-2);
  const icons=page.getByRole('toolbar',{name:'文件目录快捷操作'});
  await expect(icons.locator('svg')).toHaveCount(4);
  await icons.getByRole('button',{name:'定位文件搜索框'}).click();
  await expect(page.getByRole('textbox',{name:'搜索文件'})).toBeFocused();
  await expect(page.locator('.texpage-editor__statusline')).toContainText('main.tex');
});

test('TeXPage split/editor/PDF controls are functional without remounting or downloading fonts', async ({page}) => {
  const loaded: string[]=[];
  page.on('request', req => {
    if (/texpage\.com|static\.texpage\.com/i.test(req.url())) loaded.push(req.url());
  });
  await page.goto('/?local=1');
  await expect(page.locator('.cm-content')).toBeVisible();
  await page.getByLabel('选择编辑界面排布').click();
  await page.getByRole('button',{name:'仅显示编辑器'}).click();
  await expect(page.locator('.browser-aldine__source')).toBeVisible();
  await expect(page.locator('.browser-aldine__preview')).toBeHidden();
  await page.getByRole('button',{name:'仅显示 PDF'}).click();
  await expect(page.locator('.browser-aldine__preview')).toBeVisible();
  await expect(page.locator('.browser-aldine__source')).toBeHidden();
  await page.getByRole('button',{name:'右侧显示 PDF'}).click();
  await expect(page.locator('.browser-aldine__source')).toBeVisible();
  await expect(page.locator('.browser-aldine__preview')).toBeVisible();
  expect(loaded).toEqual([]);
});
