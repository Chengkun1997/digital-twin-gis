window.CESIUM_BASE_URL = `${import.meta.env.BASE_URL}cesium/`;
const Cesium = await import('cesium');

import { THEMES, THEME_ORDER, LANDUSE_COLORS, ROAD_COLORS, POI_COLORS, SOURCES } from './config.js';
import {
  buildPolygonLayer, buildLineLayer, buildPointLayer, buildBoundaryLayer,
  cacheInstanceAttributes, applyLayerOpacity,
} from './layers.js';

// ---------------------------------------------------------------- 基础格式化
const fmtNum = (n) => (n >= 10000 ? `${(n / 10000).toFixed(1)} 万` : String(n));
const fmtInt = (n) => n.toLocaleString('zh-CN');
const fmtBytes = (b) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${(b / 1024).toFixed(1)} KB`);
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

function toast(msg, ms = 2200) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('show'), ms);
}

// ---------------------------------------------------------------- 三维场景
const esri = new Cesium.UrlTemplateImageryProvider({
  url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  maximumLevel: 18,
  credit: new Cesium.Credit('Esri, Maxar, Earthstar Geographics', false),
});
const carto = new Cesium.UrlTemplateImageryProvider({
  url: 'https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
  maximumLevel: 19,
  credit: new Cesium.Credit('© CARTO · © OpenStreetMap contributors', false),
});

const viewer = new Cesium.Viewer('cesiumContainer', {
  baseLayer: false,
  animation: false,
  timeline: false,
  baseLayerPicker: false,
  geocoder: false,
  homeButton: false,
  sceneModePicker: false,
  navigationHelpButton: false,
  fullscreenButton: false,
  infoBox: false,
  selectionIndicator: false,
  shouldAnimate: true,
});

viewer.scene.globe.baseColor = new Cesium.Color(0.035, 0.055, 0.08, 1);
viewer.scene.backgroundColor = new Cesium.Color(0.02, 0.03, 0.05, 1);
viewer.scene.globe.showGroundAtmosphere = true;
viewer.scene.fog.enabled = false;
viewer.scene.globe.enableLighting = false;

const esriLayer = viewer.imageryLayers.addImageryProvider(esri);
const cartoLayer = viewer.imageryLayers.addImageryProvider(carto);
cartoLayer.show = false;

const CHINA_VIEW = Cesium.Rectangle.fromDegrees(73, 16, 136, 54);
viewer.camera.setView({ destination: CHINA_VIEW });

function resetCamera() {
  viewer.camera.flyTo({ destination: CHINA_VIEW, duration: 1.6 });
}
function flyToRegion(region) {
  const b = region.bbox;
  const pad = 0.25;
  viewer.camera.flyTo({
    destination: Cesium.Rectangle.fromDegrees(b[0] - pad, b[1] - pad, b[2] + pad, b[3] + pad),
    duration: 1.8,
  });
}

/** 默认视角：落到重点城市核心区（detailBbox 中心），而不是整个省域 */
function flyToCityView(region) {
  const b = region.detailBbox;
  const lon = (b[1] + b[3]) / 2;
  const lat = (b[0] + b[2]) / 2;
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(lon, lat, 11000),
    orientation: {
      heading: Cesium.Math.toRadians(0),
      pitch: Cesium.Math.toRadians(-48),
      roll: 0,
    },
    duration: 2.2,
  });
}

// ---------------------------------------------------------------- 状态
const state = {
  manifest: null,
  regionOn: new Set(['beijing']),
  themeOn: { landuse: true, roads: true, poi: true, boundary: true },
  opacity: {
    landuse: THEMES.landuse.opacity,
    roads: THEMES.roads.opacity,
    poi: THEMES.poi.opacity,
    boundary: THEMES.boundary.opacity,
  },
  layers: new Map(),   // `${code}:${theme}` -> {status, layer, bytes, buildMs}
  loads: new Map(),    // code -> Promise
  openAlbums: new Set(['landuse']),
};

const regions = () => state.manifest?.regions || [];
const loadedBytes = () => {
  let sum = 0;
  for (const v of state.layers.values()) if (v.status === 'ready') sum += v.bytes || 0;
  return sum;
};

// ---------------------------------------------------------------- HUD
let fpsStat = { frames: 0, t0: performance.now(), last: 60 };
viewer.scene.postRender.addEventListener(() => {
  fpsStat.frames++;
  const now = performance.now();
  if (now - fpsStat.t0 >= 600) {
    fpsStat.last = Math.round((fpsStat.frames * 1000) / (now - fpsStat.t0));
    fpsStat.frames = 0;
    fpsStat.t0 = now;
    document.getElementById('hud-fps').textContent = fpsStat.last;
  }
});

function updateHud() {
  let layerCount = 0;
  let rendered = 0;
  let total = 0;
  let loading = 0;
  for (const r of regions()) {
    for (const t of THEME_ORDER) {
      if (!state.themeOn[t]) continue;
      const count = r.themes[t]?.count || 0;
      const key = `${r.code}:${t}`;
      const st = state.layers.get(key);
      if (st?.status === 'loading') { loading++; continue; }
      const enabledRegion = state.regionOn.has(r.code);
      if (!enabledRegion) continue;
      layerCount++;
      total += count;
      if (st?.status === 'ready' && st.layer) rendered += st.layer.count || 0;
    }
  }
  document.getElementById('hud-layers').textContent = layerCount;
  document.getElementById('hud-rendered').textContent = fmtInt(rendered);
  document.getElementById('hud-total').textContent = fmtInt(total);
  document.getElementById('hud-mem').textContent = (loadedBytes() / 1024 / 1024).toFixed(1);
  const ls = document.getElementById('load-state');
  ls.textContent = loading ? `加载中 ${loading} 个图层…` : '';
}

// ---------------------------------------------------------------- 面板渲染
function albumStats(themeKey) {
  let bytes = 0, count = 0, layers = 0;
  for (const r of regions()) {
    const t = r.themes[themeKey];
    if (!t) continue;
    layers++;
    count += t.count;
    bytes += t.bytes;
  }
  return { layers, count, bytes };
}

function renderAlbums() {
  const box = document.getElementById('albums');
  box.innerHTML = '';
  let allBytes = 0;
  for (const t of THEME_ORDER) {
    const meta = THEMES[t];
    const stats = albumStats(t);
    allBytes += stats.bytes;
    const card = document.createElement('div');
    card.className = 'album' + (state.themeOn[t] ? ' active' : '') + (state.openAlbums.has(t) ? ' open' : '');
    card.dataset.theme = t;

    const head = document.createElement('div');
    head.className = 'album-head';
    head.innerHTML = `
      <div class="album-icon ${meta.iconClass}">${meta.short}</div>
      <div class="album-main">
        <div class="album-title">${meta.title}</div>
        <div class="album-meta">${stats.layers} 图层<span class="sep">|</span>${fmtNum(stats.count)}要素<span class="sep">|</span>${fmtBytes(stats.bytes)}</div>
      </div>
      <div class="switch ${state.themeOn[t] ? 'on' : ''}" data-theme-switch="${t}" title="开启/关闭该专辑"></div>
    `;
    head.addEventListener('click', (e) => {
      if (e.target.closest('[data-theme-switch]')) return;
      if (state.openAlbums.has(t)) state.openAlbums.delete(t);
      else state.openAlbums.add(t);
      card.classList.toggle('open');
    });
    head.querySelector('[data-theme-switch]').addEventListener('click', () => {
      state.themeOn[t] = !state.themeOn[t];
      for (const r of regions()) syncRegionLayer(r.code, t);
      if (state.themeOn[t]) ensureAllEnabled();
      renderAlbums();
      updateHud();
    });

    const layersBox = document.createElement('div');
    layersBox.className = 'album-layers';
    for (const r of regions()) {
      const info = r.themes[t];
      if (!info) continue;
      const key = `${r.code}:${t}`;
      const st = state.layers.get(key);
      const status = !state.themeOn[t] ? '已关闭'
        : st?.status === 'ready' ? '已就绪'
        : st?.status === 'loading' ? '加载中…' : '待加载';
      const row = document.createElement('div');
      row.className = 'layer-row';
      row.innerHTML = `
        <span class="dot"></span>
        <span class="name">${r.name}</span>
        <span class="num">${fmtNum(info.count)}</span>
        <span class="state ${st?.status === 'ready' ? 'ready' : st?.status === 'loading' ? 'loading' : ''}">${status}</span>
      `;
      layersBox.appendChild(row);
    }
    card.appendChild(head);
    card.appendChild(layersBox);
    box.appendChild(card);
  }
  document.getElementById('album-total').textContent = `${fmtBytes(allBytes)} / ${regions().length} 省级区域`;
  // 图例随专辑状态更新
  renderLegend();
}

function renderSources() {
  const box = document.getElementById('sources');
  if (!box) return;
  box.innerHTML = SOURCES.map((s) => `
    <div class="source-item">
      <div class="source-name">${s.name}</div>
      <div class="source-detail">${s.detail}</div>
      <div class="source-license">${s.license}</div>
    </div>
  `).join('');
}

function renderRegions() {
  const box = document.getElementById('regions');
  box.innerHTML = '';
  for (const r of regions()) {
    const on = state.regionOn.has(r.code);
    const total = THEME_ORDER.reduce((s, t) => s + (r.themes[t]?.count || 0), 0);
    const row = document.createElement('div');
    row.className = 'region-row' + (on ? ' on' : '');
    row.innerHTML = `
      <span class="box"></span>
      <span class="rname">${r.name}<small>${r.level}</small></span>
      <span class="rnum"><b>${fmtNum(total)}</b> 要素</span>
    `;
    row.addEventListener('click', () => {
      if (state.regionOn.has(r.code)) {
        state.regionOn.delete(r.code);
        for (const t of THEME_ORDER) syncRegionLayer(r.code, t);
      } else {
        state.regionOn.add(r.code);
        ensureRegion(r.code);
        flyToRegion(r);
      }
      renderRegions();
      updateHud();
      renderAlbums();
    });
    box.appendChild(row);
  }
  const statusEl = document.getElementById('load-state');
  if (statusEl) statusEl.title = '区域勾选后按需加载，未勾选的省级数据不会发起网络请求';
}

function renderOpacity() {
  const box = document.getElementById('opacity');
  box.innerHTML = '';
  for (const t of ['landuse', 'roads', 'poi', 'boundary']) {
    const v = Math.round(state.opacity[t] * 100);
    const row = document.createElement('div');
    row.className = 'slider-row';
    row.innerHTML = `
      <span class="sname">${THEMES[t].short}图</span>
      <input type="range" min="10" max="100" value="${v}" data-opacity="${t}" />
      <span class="sval" id="opacity-val-${t}">${v}%</span>
    `;
    const input = row.querySelector('input');
    const label = row.querySelector('.sval');
    input.addEventListener('input', () => {
      label.textContent = `${input.value}%`;
      state.opacity[t] = Number(input.value) / 100;
    });
    input.addEventListener('change', () => {
      for (const [key, st] of state.layers) {
        if (!key.endsWith(`:${t}`) || st.status !== 'ready' || !st.layer) continue;
        applyLayerOpacity(Cesium, st.layer, state.opacity[t]);
      }
    });
    box.appendChild(row);
  }
}

function renderLegend() {
  const box = document.getElementById('legend');
  const parts = [];
  if (state.themeOn.landuse) {
    parts.push('<div class="legend-title">用地分类</div><div class="legend-grid">');
    (state.manifest?.regions?.[0]?.themes?.landuse?.classes || []).forEach((name, i) => {
      parts.push(`<div class="legend-item"><span class="legend-swatch" style="background:${LANDUSE_COLORS[i]}"></span>${name}</div>`);
    });
    parts.push('</div>');
  }
  if (state.themeOn.roads) {
    parts.push('<div class="legend-title">道路等级</div><div class="legend-grid">');
    ['高速', '快速路', '主干路', '次干路', '支路', '居民区道路'].forEach((name, i) => {
      parts.push(`<div class="legend-item"><span class="legend-swatch line" style="background:${ROAD_COLORS[i]}"></span>${name}</div>`);
    });
    parts.push('</div>');
  }
  if (state.themeOn.poi) {
    const count = state.manifest?.regions?.[0]?.themes?.poi?.classes?.length || 0;
    parts.push('<div class="legend-title">POI 分类</div><div class="legend-grid">');
    for (let i = 0; i < count; i++) {
      const name = state.manifest.regions[0].themes.poi.classes[i];
      parts.push(`<div class="legend-item"><span class="legend-swatch round" style="background:${POI_COLORS[i]}"></span>${name}</div>`);
    }
    parts.push('</div>');
  }
  if (state.themeOn.boundary) {
    parts.push(`<div class="legend-item" style="margin-top:8px"><span class="legend-swatch line" style="background:#6beadb"></span>省级边界（OSM admin_level=4）</div>`);
  }
  box.innerHTML = parts.filter(Boolean).join('');
}

// ---------------------------------------------------------------- 数据加载与图元
function syncRegionLayer(code, theme) {
  const st = state.layers.get(`${code}:${theme}`);
  const visible = state.regionOn.has(code) && state.themeOn[theme];
  if (!st?.layer) return;
  const obj = st.layer.primitive || st.layer.collection;
  if (obj) obj.show = visible;
}

async function ensureRegion(code) {
  if (state.loads.has(code)) return state.loads.get(code);
  const region = regions().find((r) => r.code === code);
  if (!region) return;
  const p = (async () => {
    // 并发取数
    const fetches = THEME_ORDER.map(async (t) => {
      const info = region.themes[t];
      if (!info) return null;
      const key = `${code}:${t}`;
      state.layers.set(key, { status: 'loading', bytes: 0 });
      updateHud();
      try {
        const t0 = performance.now();
        const res = await fetch(info.file);
        const json = await res.json();
        const fetchMs = performance.now() - t0;
        return { t, info, json, fetchMs, bytes: info.bytes };
      } catch (err) {
        state.layers.set(key, { status: 'error', bytes: 0 });
        console.error(`[加载失败] ${key}`, err);
        return null;
      }
    });
    const results = await Promise.all(fetches);
    // 顺序构建，避免一次性阻塞主线程
    for (const res of results) {
      if (!res) continue;
      const { t, info, json, fetchMs, bytes } = res;
      await nextFrame();
      const t0 = performance.now();
      let layer = null;
      try {
        if (t === 'landuse') layer = buildPolygonLayer(Cesium, json.f, state.opacity.landuse, `${code}-lu`);
        else if (t === 'roads') layer = buildLineLayer(Cesium, json.f, state.opacity.roads, `${code}-rd`);
        else if (t === 'poi') layer = buildPointLayer(Cesium, json.f, state.opacity.poi, `${code}-poi`);
        else if (t === 'boundary') layer = buildBoundaryLayer(Cesium, (json.rings || []).concat(json.segments || []), state.opacity.boundary, `${code}-bnd`);
      } catch (err) {
        console.error(`[构建失败] ${code}:${t}`, err);
      }
      if (!layer) {
        state.layers.set(`${code}:${t}`, { status: 'error', bytes });
        continue;
      }
      const obj = layer.primitive || layer.collection;
      if (obj) {
        viewer.scene.primitives.add(obj);
        obj.show = state.regionOn.has(code) && state.themeOn[t];
      }
      const buildMs = performance.now() - t0;
      const key = `${code}:${t}`;
      state.layers.set(key, { status: 'ready', layer, bytes, fetchMs, buildMs, info, loadedAt: performance.now() });

      if (layer.primitive) {
        await waitPrimitiveReady(layer.primitive);
        const st = state.layers.get(key);
        if (st) st.readyMs = performance.now() - t0;
      }
      updateHud();
      renderAlbums();
    }
    updateHud();
    renderAlbums();
  })();
  state.loads.set(code, p);
  await p;
  return p;
}

function ensureAllEnabled() {
  for (const code of state.regionOn) ensureRegion(code);
}

/** Cesium 1.147 的 Primitive 没有 readyEvent，用 postRender 轮询等待几何体就绪 */
function waitPrimitiveReady(primitive, timeoutMs = 20000) {
  return new Promise((resolve) => {
    if (primitive.ready) return resolve();
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      remove();
      clearTimeout(timer);
      resolve();
    };
    const remove = viewer.scene.postRender.addEventListener(() => {
      if (primitive.ready) finish();
    });
    const timer = setTimeout(finish, timeoutMs);
  });
}

// ---------------------------------------------------------------- 底图
document.querySelectorAll('#basemap-bar button').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#basemap-bar button').forEach((b) => b.classList.toggle('active', b === btn));
    const mode = btn.dataset.basemap;
    esriLayer.show = mode === 'esri';
    cartoLayer.show = mode === 'carto';
    viewer.scene.globe.baseColor = new Cesium.Color(0.035, 0.055, 0.08, 1);
    if (mode === 'none') {
      viewer.scene.globe.baseColor = new Cesium.Color(0.045, 0.075, 0.085, 1);
      viewer.scene.globe.showGroundAtmosphere = false;
    }
  });
});

// ---------------------------------------------------------------- 性能自检
const bench = { rows: [], running: false };

function measureFps(durationMs = 4000) {
  return new Promise((resolve) => {
    const deltas = [];
    let last = performance.now();
    const start = last;
    const loop = () => {
      const now = performance.now();
      deltas.push(now - last);
      last = now;
      if (now - start < durationMs) requestAnimationFrame(loop);
      else {
        const total = now - start;
        const avg = (deltas.length * 1000) / total;
        const sorted = deltas.slice(2).sort((a, b) => a - b);
        const p95 = sorted[Math.floor(sorted.length * 0.95)] || 0;
        resolve({ avg, min: 1000 / p95, frames: deltas.length });
      }
    };
    requestAnimationFrame(loop);
  });
}

function benchRow(step) {
  const tr = document.createElement('tr');
  const fpsCls = step.fps >= 50 ? 'good' : step.fps >= 25 ? 'mid' : 'bad';
  tr.innerHTML = `
    <td class="num">${bench.rows.length}</td>
    <td>${step.label}</td>
    <td class="num">${fmtInt(step.count)}</td>
    <td class="num ${fpsCls}">${step.fps.toFixed(1)}</td>
    <td class="num ${fpsCls}">${step.min.toFixed(1)}</td>
    <td class="num">${step.buildMs ? `${Math.round(step.buildMs)} ms` : '—'}</td>
  `;
  document.querySelector('#bench-table tbody').appendChild(tr);
  bench.rows.push(step);
  window.__bench = bench.rows;
}

function renderedCount() {
  let n = 0;
  for (const st of state.layers.values()) if (st.status === 'ready' && st.layer) n += st.layer.count || 0;
  return n;
}

async function setCameraBeijing() {
  viewer.camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(116.42, 39.88, 14000),
    orientation: { heading: 0, pitch: Cesium.Math.toRadians(-52), roll: 0 },
  });
}

function setCameraCity(code) {
  const region = regions().find((r) => r.code === code);
  const b = (region || { detailBbox: [39.6, 115.9, 40.35, 116.95] }).detailBbox;
  viewer.camera.setView({
    destination: Cesium.Cartesian3.fromDegrees((b[1] + b[3]) / 2, (b[0] + b[2]) / 2, 14000),
    orientation: { heading: 0, pitch: Cesium.Math.toRadians(-52), roll: 0 },
  });
}

async function runBenchmark() {
  if (bench.running) return;
  bench.running = true;
  document.getElementById('bench-panel').classList.remove('hidden');
  document.getElementById('bench-note').textContent = '测试中…每个场景采集 4 秒，请勿操作。';
  document.querySelector('#bench-table tbody').innerHTML = '';
  bench.rows = [];
  window.__bench = bench.rows;

  const allRegions = regions().map((r) => r.code);
  const steps = [
    { label: '基线（无矢量图层）', themes: [], regions: [], view: 'beijing' },
    { label: '北京 · 用地分类（面）', themes: ['landuse'], regions: ['beijing'], view: 'beijing' },
    { label: '北京 · 道路网（线）', themes: ['roads'], regions: ['beijing'], view: 'beijing' },
    { label: '北京 · POI（点）', themes: ['poi'], regions: ['beijing'], view: 'beijing' },
    { label: '北京 · 全部专题', themes: THEME_ORDER, regions: ['beijing'], view: 'beijing' },
    { label: '广东 · 用地分类（面）', themes: ['landuse'], regions: ['guangdong'], view: 'guangdong' },
    { label: '广东 · 道路网（线）', themes: ['roads'], regions: ['guangdong'], view: 'guangdong' },
    { label: '广东 · POI（点）', themes: ['poi'], regions: ['guangdong'], view: 'guangdong' },
    { label: '广东 · 全部专题', themes: THEME_ORDER, regions: ['guangdong'], view: 'guangdong' },
    { label: '6 省 · 用地分类（面）', themes: ['landuse'], regions: allRegions, view: 'china' },
    { label: '6 省 · 道路网（线）', themes: ['roads'], regions: allRegions, view: 'china' },
    { label: '6 省 · POI（点）', themes: ['poi'], regions: allRegions, view: 'china' },
    { label: '6 省 · 全部专题', themes: THEME_ORDER, regions: allRegions, view: 'china' },
  ];

  for (const step of steps) {
    const stepStart = performance.now();
    for (const t of THEME_ORDER) state.themeOn[t] = step.themes.includes(t);
    // 只保留本步需要的区域
    for (const r of allRegions) {
      if (step.regions.includes(r)) state.regionOn.add(r); else state.regionOn.delete(r);
    }
    for (const code of step.regions) await ensureRegion(code);
    for (const r of allRegions) for (const t of THEME_ORDER) syncRegionLayer(r, t);
    renderAlbums(); updateHud();

    if (step.view === 'beijing') await setCameraBeijing();
    else if (step.view === 'guangdong') setCameraCity('guangdong');
    else viewer.camera.setView({ destination: CHINA_VIEW });

    // 等待瓦片/几何体稳定
    await new Promise((r) => setTimeout(r, 1200));
    const r0 = await measureFps(4000);

    let buildMs = 0;
    for (const code of step.regions) for (const t of step.themes) {
      const st = state.layers.get(`${code}:${t}`);
      if (st?.status === 'ready' && st.loadedAt >= stepStart) {
        buildMs += st.readyMs ?? st.buildMs ?? 0;
      }
    }
    benchRow({
      label: step.label,
      count: renderedCountFor(step.regions),
      fps: r0.avg,
      min: r0.min,
      buildMs,
    });
    await nextFrame();
  }

  document.getElementById('bench-note').textContent = `完成：${bench.rows.length} 个场景。平均帧率越低说明越吃紧；要素数为该场景实际渲染的要素总数。`;
  bench.running = false;
}

function renderedCountFor(codes) {
  let n = 0;
  for (const code of codes) for (const t of THEME_ORDER) {
    const st = state.layers.get(`${code}:${t}`);
    if (st?.status !== 'ready' || !st.layer) continue;
    const obj = st.layer.primitive || st.layer.collection;
    if (obj && obj.show === false) continue;
    n += st.layer.count || 0;
  }
  return n;
}

document.getElementById('btn-bench').addEventListener('click', runBenchmark);
document.getElementById('bench-close').addEventListener('click', () => document.getElementById('bench-panel').classList.add('hidden'));
document.getElementById('btn-reset').addEventListener('click', resetCamera);

// ---------------------------------------------------------------- 启动
async function boot() {
  const res = await fetch('data/manifest.json').catch(() => null);
  if (!res || !res.ok) {
    document.getElementById('albums').innerHTML = `
      <div class="empty-note">
        未找到 <code>public/data/manifest.json</code>。<br />
        仓库不包含体积较大的矢量数据，请先执行<br />
        <code>npm run fetch</code> → <code>npm run data</code><br />
        生成数据后刷新页面。
      </div>`;
    renderSources();
    return;
  }
  state.manifest = await res.json();
  renderRegions();
  renderAlbums();
  renderOpacity();
  renderSources();
  updateHud();

  await ensureRegion('beijing');

  const params = new URLSearchParams(location.search);
  if (params.get('all') === '1') {
    for (const r of regions()) { state.regionOn.add(r.code); ensureRegion(r.code); }
    renderRegions(); renderAlbums(); updateHud();
  }
  if (params.get('bench') === '1') {
    await runBenchmark();
  } else {
    setTimeout(() => flyToCityView(regions().find((r) => r.code === 'beijing')), 600);
  }
}
boot().catch((e) => {
  console.error(e);
  toast('初始化失败：' + e.message, 5000);
});

window.__gis = { viewer, state, Cesium, runBenchmark, ensureRegion, setCameraBeijing };
