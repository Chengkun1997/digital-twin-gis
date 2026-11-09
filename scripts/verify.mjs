/**
 * 本地渲染自检（真实 Chromium + SwiftShader WebGL）
 * 用法：node scripts/verify.mjs [url]
 */
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const URL = process.argv[2] || 'http://localhost:5173/';
const OUT = 'screenshots';
fs.mkdirSync(OUT, { recursive: true });

/** 定位本机 Chrome：优先 CHROME_PATH 环境变量，其次常见安装路径 */
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);
const executablePath = CHROME_CANDIDATES.find((p) => fs.existsSync(p));
if (!executablePath) {
  throw new Error('未找到 Chrome，可设置环境变量 CHROME_PATH 指向可执行文件');
}

const browser = await puppeteer.launch({
  executablePath,
  headless: 'new',
  args: [
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--no-sandbox',
    '--window-size=1600,900',
    '--disable-dev-shm-usage',
  ],
  defaultViewport: { width: 1600, height: 900 },
});

const page = await browser.newPage();
const errors = [];
const logs = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
  else logs.push(`[${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`));
page.on('requestfailed', (r) => errors.push(`REQFAIL: ${r.url()} ${r.failure()?.errorText}`));

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => document.querySelectorAll('#albums .album').length >= 3, { timeout: 60000 });
await page.waitForFunction(() => window.__gis && window.__gis.state.layers.size > 0, { timeout: 60000 });

// 等待北京数据全部构建完成（最多 60s）
await page.waitForFunction(() => {
  const st = window.__gis.state;
  return st.layers.size >= 3 && [...st.layers.values()].some((v) => v.status === 'ready');
}, { timeout: 90000 }).catch(() => {});

await new Promise((r) => setTimeout(r, 8000));

const info = await page.evaluate(() => {
  const st = window.__gis.state;
  const layers = [];
  for (const [k, v] of st.layers) layers.push({ k, status: v.status, count: v.layer?.count ?? 0, buildMs: Math.round(v.buildMs || 0), readyMs: Math.round(v.readyMs || 0) });
  const hud = {
    layers: document.getElementById('hud-layers')?.textContent,
    rendered: document.getElementById('hud-rendered')?.textContent,
    total: document.getElementById('hud-total')?.textContent,
    fps: document.getElementById('hud-fps')?.textContent,
    mem: document.getElementById('hud-mem')?.textContent,
  };
  const albums = [...document.querySelectorAll('.album')].map((a) => a.innerText.replace(/\n/g, ' | '));
  return {
    hud,
    albums,
    layers,
    canvas: { w: document.querySelector('canvas')?.width, h: document.querySelector('canvas')?.height },
    renderer: (() => {
      try {
        const gl = document.querySelector('canvas').getContext('webgl2') || document.querySelector('canvas').getContext('webgl');
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
      } catch (e) { return 'n/a'; }
    })(),
    scene: { primitives: window.__gis.viewer.scene.primitives.length, imagery: window.__gis.viewer.imageryLayers.length },
  };
});

console.log(JSON.stringify(info, null, 2));
console.log('\n--- errors ---');
console.log(errors.length ? errors.slice(0, 20).join('\n') : '(none)');

await page.screenshot({ path: `${OUT}/01-boot.png` });

// 交互：在右侧勾选上海，验证按需加载
const regionRows = await page.$$('.region-row');
if (regionRows.length > 1) {
  await regionRows[1].click();
  await new Promise((r) => setTimeout(r, 6000));
  const after = await page.evaluate(() => ({
    hud: document.getElementById('hud-rendered').textContent,
    total: document.getElementById('hud-total').textContent,
    fps: document.getElementById('hud-fps').textContent,
    states: [...window.__gis.state.layers.entries()].map(([k, v]) => `${k}=${v.status}`),
  }));
  console.log('\n--- 开启第二个区域后 ---');
  console.log(after);
  await page.screenshot({ path: `${OUT}/02-two-regions.png` });
}

// 交互：底图切换 + 透明度滑杆 + 图例
const baseStates = {};
for (const name of ['none', 'carto', 'osm']) {
  await page.click(`[data-basemap="${name}"]`);
  await new Promise((r) => setTimeout(r, 700));
  baseStates[name] = await page.evaluate(() => ({
    show: window.__gis.viewer.imageryLayers._layers.map((l) => (l.show ? 1 : 0)).join(''),
    active: document.querySelector('#basemap-bar .active')?.dataset.basemap,
  }));
}

const alphaBefore = await page.evaluate(() => {
  const st = window.__gis.state.layers.get('beijing:landuse');
  const a = st.layer.primitive.getGeometryInstanceAttributes(st.layer.primitive.geometryInstances[0].id);
  return a ? a.color[3] : null;
});
await page.evaluate(() => {
  const input = document.querySelector('#opacity input[data-opacity="landuse"]');
  input.value = '30';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
});
await new Promise((r) => setTimeout(r, 600));
const alphaAfter = await page.evaluate(() => {
  const st = window.__gis.state.layers.get('beijing:landuse');
  const a = st.layer.primitive.getGeometryInstanceAttributes(st.layer.primitive.geometryInstances[0].id);
  return {
    alpha: a ? a.color[3] : null,
    label: document.getElementById('opacity-val-landuse')?.textContent,
    legend: document.querySelectorAll('#legend .legend-item').length,
  };
});
console.log('\n--- 底图切换 / 透明度 / 图例 ---');
console.log({ baseStates, alphaBefore, alphaAfter });
await page.screenshot({ path: `${OUT}/05-interactions.png` });

await browser.close();
