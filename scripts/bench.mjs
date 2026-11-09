/**
 * 性能自检：用本机 Chrome（优先真实 GPU）打开 ?bench=1，跑完整套场景并输出结果。
 * 用法：node scripts/bench.mjs [headful|swiftshader]
 */
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const mode = process.argv[2] || 'headful';
const headless = mode !== 'headful';
const args = [
  '--window-size=1600,900',
  '--window-position=0,0',
  '--no-sandbox',
  '--disable-dev-shm-usage',
  '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows',
  '--disable-features=CalculateNativeWinOcclusion',
];
if (headless) args.push('--use-angle=swiftshader', '--enable-unsafe-swiftshader');

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
  headless,
  args,
  defaultViewport: { width: 1600, height: 900 },
});

const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

fs.mkdirSync('screenshots', { recursive: true });
await page.goto('http://localhost:5173/?bench=1', { waitUntil: 'domcontentloaded', timeout: 60000 });

console.log('等待性能自检完成（可能需要数分钟）…');
let lastLog = '';
const t0 = Date.now();
while (Date.now() - t0 < 20 * 60 * 1000) {
  let s = null;
  try {
    s = await page.evaluate(() => ({
      rows: window.__bench ? window.__bench.length : -1,
      note: document.getElementById('bench-note')?.textContent || '',
      hud: document.getElementById('hud-rendered')?.textContent,
    }));
  } catch { /* 页面可能短暂卡住 */ }
  if (s) {
    const msg = `rows=${s.rows} hud=${s.hud} note=${s.note.slice(0, 40)}`;
    if (msg !== lastLog) console.log(`[${Math.round((Date.now() - t0) / 1000)}s] ${msg}`);
    lastLog = msg;
    if (s.rows >= 13) break;
  }
  await new Promise((r) => setTimeout(r, 5000));
}

const rows = await page.evaluate(() => window.__bench || []);
const renderer = await page.evaluate(() => {
  try {
    const gl = document.querySelector('canvas').getContext('webgl2');
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
  } catch { return 'n/a'; }
});
const layers = await page.evaluate(() => [...window.__gis.state.layers.entries()].map(([k, v]) => ({
  k, status: v.status, count: v.layer?.count ?? 0,
  buildMs: Math.round(v.buildMs || 0), readyMs: Math.round(v.readyMs || 0),
})));

console.log('\n渲染器：', renderer);
const rowsOut = rows.map((r) => ({ ...r, fps: Number(r.fps.toFixed(1)), min: Number(r.min.toFixed(1)) }));
console.log(JSON.stringify(rowsOut, null, 1));
console.log('\n图层构建：', JSON.stringify(layers));
console.log('\n错误：', errors.slice(0, 10).join(' | ') || '(none)');

await page.screenshot({ path: `screenshots/03-bench-${mode}.png` });
fs.writeFileSync(`screenshots/bench-${mode}.json`, JSON.stringify({ renderer, rows, layers, errors }, null, 2));
await browser.close();
