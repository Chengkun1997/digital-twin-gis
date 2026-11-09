/**
 * 数据构建脚本：把 OSM 省级 .osm.pbf 提取解析为前端可直接消费的精简专题数据。
 *
 * 数据来源：OpenStreetMap（© OpenStreetMap contributors，ODbL 1.0）
 * 提取来源：https://download.openstreetmap.fr/extracts/asia/china/ （每日更新）
 *
 * 用法：node scripts/build-data.mjs [regionCode...]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const osmPbfParser = require('osm-pbf-parser');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PBF_DIR = path.join(ROOT, 'data', 'pbf');
const OUT_DIR = path.join(ROOT, 'public', 'data');

/** 区域配置：detailBbox 内保留全部道路等级，范围外只保留骨架路网（控制数据量） */
const REGIONS = [
  { code: 'beijing', name: '北京市', level: '直辖市', adminName: '北京市', detailBbox: [39.6, 115.9, 40.35, 116.95] },
  { code: 'shanghai', name: '上海市', level: '直辖市', adminName: '上海市', detailBbox: [30.9, 121.05, 31.55, 121.95] },
  { code: 'chongqing', name: '重庆市', level: '直辖市', adminName: '重庆市', detailBbox: [29.3, 106.2, 29.95, 106.95] },
  { code: 'sichuan', name: '四川省', level: '省', adminName: '四川省', detailBbox: [30.4, 103.75, 31.0, 104.5] },
  { code: 'zhejiang', name: '浙江省', level: '省', adminName: '浙江省', detailBbox: [30.05, 119.9, 30.55, 120.55] },
  { code: 'guangdong', name: '广东省', level: '省', adminName: '广东省', detailBbox: [22.85, 113.05, 23.45, 113.75] },
];

const ROAD_CLASSES = ['高速公路', '快速路', '主干路', '次干路', '支路', '居民区道路'];
/** 骨架路网等级（全省保留） */
const SKELETON = new Set(['motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link', 'secondary', 'secondary_link']);
/** 详细路网等级（仅重点城市范围保留） */
const DETAIL = new Set(['tertiary', 'tertiary_link', 'unclassified', 'residential', 'living_street', 'service']);

function roadClass(tags) {
  const h = tags.highway;
  if (!h) return -1;
  if (h === 'motorway' || h === 'motorway_link') return 0;
  if (h === 'trunk' || h === 'trunk_link') return 1;
  if (h === 'primary' || h === 'primary_link') return 2;
  if (h === 'secondary' || h === 'secondary_link') return 3;
  if (h === 'tertiary' || h === 'tertiary_link') return 4;
  if (h === 'residential' || h === 'living_street' || h === 'unclassified' || h === 'service') return 5;
  return -1;
}

const LANDUSE_CLASSES = [
  '居住用地', '商业用地', '工业用地', '在建用地', '农业用地',
  '林地', '绿地草地', '公共服务', '交通设施', '其他用地',
];
const LANDUSE_MAP = {
  residential: 0, commercial: 1, retail: 1, industrial: 2, construction: 3,
  brownfield: 3, greenfield: 3, farmland: 4, orchard: 4, vineyard: 4, plant_nursery: 4,
  greenhouse_horticulture: 4, farmyard: 4, forest: 5, grass: 6, meadow: 6,
  village_green: 6, recreation_ground: 6, cemetery: 9, military: 9, railway: 8,
  railway_yard: 8, port: 8, quarry: 2, landfill: 9, landfill_site: 2, reservoir: 9,
  basin: 9, salt_pond: 2, aquaculture: 4, allotments: 4, education: 7, religious: 7,
  civic_admin: 7, health: 7, health_care: 7,
};
function landuseClass(tags) {
  if (!tags.landuse) return -1;
  const c = LANDUSE_MAP[tags.landuse];
  return c === undefined ? 9 : c;
}

const POI_CLASSES = [
  '餐饮', '购物', '教育', '医疗', '交通出行', '住宿', '景点名胜', '金融', '政务', '体育休闲', '办公', '其他服务',
];
function poiClass(tags) {
  const a = tags.amenity, s = tags.shop, t = tags.tourism, l = tags.leisure;
  if (a) {
    if (['restaurant', 'fast_food', 'cafe', 'bar', 'pub', 'food_court', 'biergarten', 'ice_cream'].includes(a)) return 0;
    if (['marketplace', 'vending_machine'].includes(a)) return 1;
    if (['school', 'college', 'university', 'kindergarten', 'library', 'language_school', 'music_school', 'driving_school'].includes(a)) return 2;
    if (['hospital', 'clinic', 'pharmacy', 'doctors', 'dentist', 'veterinary', 'nursing_home'].includes(a)) return 3;
    if (['bus_station', 'parking', 'parking_space', 'fuel', 'taxi', 'car_rental', 'bicycle_rental', 'charging_station', 'ferry_terminal'].includes(a)) return 4;
    if (['bank', 'atm', 'bureau_de_change'].includes(a)) return 7;
    if (['townhall', 'police', 'courthouse', 'post_office', 'embassy', 'fire_station', 'prison', 'public_building', 'community_centre'].includes(a)) return 8;
    if (['toilets', 'drinking_water', 'shelter', 'bbq', 'waste_basket', 'recycling', 'bench', 'waste_disposal', 'shower', 'telephone', 'watering_place', 'fountain'].includes(a)) return 11;
    if (['place_of_worship', 'grave_yard', 'monastery'].includes(a)) return 6;
    return 11;
  }
  if (s && s !== 'no') return 1;
  if (t) {
    if (['hotel', 'motel', 'hostel', 'guest_house', 'apartment', 'camp_site', 'chalet', 'alpine_hut'].includes(t)) return 5;
    return 6;
  }
  if (l) return 9;
  if (tags.historic) return 6;
  if (tags.office) return 10;
  if (tags.public_transport === 'station' || tags.railway === 'station' || tags.railway === 'halt') return 4;
  if (tags.highway === 'bus_stop') return 4;
  if (tags.healthcare) return 3;
  if (tags.emergency) return 8;
  return -1;
}

const round5 = (v) => Math.round(v * 1e5) / 1e5;

/** Douglas-Peucker，输入 flat [x,y,x,y...] */
function simplify(flat, tolerance) {
  const n = flat.length / 2;
  if (n <= 2) return flat;
  const keep = new Uint8Array(n);
  keep[0] = 1; keep[n - 1] = 1;
  const stack = [[0, n - 1]];
  const tol2 = tolerance * tolerance;
  while (stack.length) {
    const [i0, i1] = stack.pop();
    let maxD = -1, idx = -1;
    const x0 = flat[i0 * 2], y0 = flat[i0 * 2 + 1], x1 = flat[i1 * 2], y1 = flat[i1 * 2 + 1];
    const dx = x1 - x0, dy = y1 - y0;
    const len2 = dx * dx + dy * dy;
    for (let i = i0 + 1; i < i1; i++) {
      const px = flat[i * 2], py = flat[i * 2 + 1];
      let d;
      if (len2 === 0) {
        d = (px - x0) ** 2 + (py - y0) ** 2;
      } else {
        let tt = ((px - x0) * dx + (py - y0) * dy) / len2;
        tt = Math.max(0, Math.min(1, tt));
        const qx = x0 + tt * dx - px, qy = y0 + tt * dy - py;
        d = qx * qx + qy * qy;
      }
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > tol2 && idx > 0) {
      keep[idx] = 1;
      stack.push([i0, idx], [idx, i1]);
    }
  }
  const out = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(flat[i * 2], flat[i * 2 + 1]);
  return out;
}

function inBbox(lon, lat, b) {
  return lon >= b[1] && lon <= b[3] && lat >= b[0] && lat <= b[2];
}

function streamPbf(file, onItem) {
  return new Promise((resolve, reject) => {
    fs.createReadStream(file)
      .pipe(osmPbfParser())
      .on('data', (items) => { for (const it of items) onItem(it); })
      .on('error', reject)
      .on('end', resolve);
  });
}

async function buildRegion(cfg) {
  const pbf = path.join(PBF_DIR, `${cfg.code}.osm.pbf`);
  if (!fs.existsSync(pbf)) {
    console.warn(`[skip] ${cfg.code}: 缺少 ${pbf}`);
    return null;
  }
  const t0 = Date.now();
  console.log(`\n==== ${cfg.name} (${cfg.code}) ====`);

  const ways = [];            // {id, refs, cls, kind}
  const poi = [];             // [cls, lon, lat, name]
  const boundaryWays = new Map(); // wayId -> role，用于省级边界
  const neededNodes = new Set();
  let boundaryRelations = [];

  // ---------- 第一遍：标签与引用 ----------
  await streamPbf(pbf, (it) => {
    if (it.type === 'node') {
      if (!it.tags) return;
      const c = poiClass(it.tags);
      if (c < 0) return;
      poi.push([c, round5(it.lon), round5(it.lat), it.tags.name || it.tags['name:zh'] || '']);
      return;
    }
    if (it.type === 'way') {
      const tags = it.tags;
      if (!tags) return;
      const rc = roadClass(tags);
      if (rc >= 0) {
        // 重点城市范围外仅保留骨架路网
        if (rc >= 4) {
          // 用首节点坐标粗判（精确判断放在第二遍）
          ways.push({ id: it.id, refs: it.refs, cls: rc, kind: 'road', marginal: true });
        } else {
          ways.push({ id: it.id, refs: it.refs, cls: rc, kind: 'road' });
        }
      }
      const lc = landuseClass(tags);
      if (lc >= 0 && it.refs.length >= 4) {
        ways.push({ id: it.id, refs: it.refs, cls: lc, kind: 'landuse' });
      }
      return;
    }
    if (it.type === 'relation') {
      const t = it.tags || {};
      if (t.boundary === 'administrative' && Number(t.admin_level) === 4 && t.name === cfg.adminName) {
        boundaryRelations.push(it);
      }
    }
  });

  console.log(`  第一遍：候选道路/面 ${ways.length}，POI ${poi.length}，边界关系 ${boundaryRelations.length}`);

  for (const w of ways) for (const r of w.refs) neededNodes.add(r);
  for (const rel of boundaryRelations) {
    for (const m of rel.members) {
      if (m.type === 'way' && m.role !== 'inner') boundaryWays.set(m.id ?? m.ref, m.role);
    }
  }

  // ---------- 第二遍：边界 way 的节点引用 ----------
  const boundaryWayNodes = new Map();
  if (boundaryWays.size) {
    await streamPbf(pbf, (it) => {
      if (it.type === 'way' && boundaryWays.has(it.id)) {
        boundaryWayNodes.set(it.id, it.refs);
        for (const r of it.refs) neededNodes.add(r);
      }
    });
  }

  // ---------- 第三遍：节点坐标 ----------
  const nodeLon = new Map(), nodeLat = new Map();
  await streamPbf(pbf, (it) => {
    if (it.type === 'node' && neededNodes.has(it.id)) {
      nodeLon.set(it.id, round5(it.lon));
      nodeLat.set(it.id, round5(it.lat));
    }
  });
  console.log(`  节点坐标：${nodeLon.size} 个，用时 ${Date.now() - t0}ms，内存 ${Math.round(process.memoryUsage().heapUsed / 1e6)}MB`);

  // ---------- 组装 ----------
  const roads = [];
  const landuse = [];
  const roadCounts = new Array(ROAD_CLASSES.length).fill(0);
  const luCounts = new Array(LANDUSE_CLASSES.length).fill(0);

  for (const w of ways) {
    let coords = [];
    let ok = true;
    for (const r of w.refs) {
      const lon = nodeLon.get(r), lat = nodeLat.get(r);
      if (lon === undefined) { ok = false; break; }
      coords.push(lon, lat);
    }
    if (!ok || coords.length < 4) continue;

    if (w.kind === 'road') {
      if (w.marginal) {
        // 支路级：仅在重点城市范围内保留
        const b = cfg.detailBbox;
        let anyIn = false;
        for (let i = 0; i < coords.length; i += 2) {
          if (inBbox(coords[i], coords[i + 1], b)) { anyIn = true; break; }
        }
        if (!anyIn) continue;
      }
      const s = simplify(coords, 0.00009);
      if (s.length < 4) continue;
      roads.push([w.cls, ...s]);
      roadCounts[w.cls]++;
    } else {
      const closed = w.refs[0] === w.refs[w.refs.length - 1];
      if (!closed) continue;
      const s = simplify(coords, 0.00012);
      if (s.length < 7) continue; // 至少 3 个点 + 闭合点
      landuse.push([w.cls, ...s]);
      luCounts[w.cls]++;
    }
  }

  // ---------- 省级边界拼环 ----------
  const rings = [];
  if (boundaryWayNodes.size) {
    const segments = [...boundaryWayNodes.entries()].map(([id, refs]) => ({ refs, used: false }));
    while (segments.some((s) => !s.used)) {
      const cur = segments.find((s) => !s.used);
      if (!cur) break;
      cur.used = true;
      let chainRefs = cur.refs.slice();
      let closedRing = chainRefs[0] === chainRefs[chainRefs.length - 1];
      let guard = 0;
      while (!closedRing && guard++ < 4000) {
        const tail = chainRefs[chainRefs.length - 1];
        const nb = segments.find((s) => !s.used && (s.refs[0] === tail || s.refs[s.refs.length - 1] === tail));
        if (!nb) break;
        nb.used = true;
        const reversed = nb.refs[nb.refs.length - 1] === tail;
        const add = reversed ? nb.refs.slice().reverse() : nb.refs.slice();
        chainRefs = chainRefs.concat(add.slice(1));
        closedRing = chainRefs[0] === chainRefs[chainRefs.length - 1];
      }
      if (!closedRing || chainRefs.length < 4) continue;
      const flat = [];
      for (const r of chainRefs) {
        const lon = nodeLon.get(r), lat = nodeLat.get(r);
        if (lon === undefined) continue;
        flat.push(lon, lat);
      }
      if (flat.length < 8) continue;
      rings.push(simplify(flat, 0.0004));
    }
  }

  // 拼环失败时退化为逐段边界线（同样是真实 OSM 边界，只是未闭合）
  const segments = [];
  if (!rings.length) {
    for (const [, refs] of boundaryWayNodes) {
      const flat = [];
      for (const r of refs) {
        const lon = nodeLon.get(r), lat = nodeLat.get(r);
        if (lon === undefined) continue;
        flat.push(lon, lat);
      }
      if (flat.length >= 4) segments.push(simplify(flat, 0.0004));
    }
  }

  // ---------- 输出 ----------
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const write = (name, obj) => {
    const p = path.join(OUT_DIR, `${cfg.code}-${name}.json`);
    fs.writeFileSync(p, JSON.stringify(obj));
    return { bytes: fs.statSync(p).size };
  };

  const roadOut = { c: ROAD_CLASSES, f: roads };
  const luOut = { c: LANDUSE_CLASSES, f: landuse };
  const poiOut = { c: POI_CLASSES, f: poi };
  const bndOut = { rings, segments };

  const files = {
    roads: write('roads', roadOut),
    landuse: write('landuse', luOut),
    poi: write('poi', poiOut),
    boundary: write('boundary', bndOut),
  };

  const poiCounts = new Array(POI_CLASSES.length).fill(0);
  for (const p of poi) poiCounts[p[0]]++;

  // 区域 bbox 由边界/要素计算
  let bbox = [180, 90, -180, -90];
  for (const p of poi) {
    const lon = p[1], lat = p[2];
    if (lon < bbox[0]) bbox[0] = lon; if (lat < bbox[1]) bbox[1] = lat;
    if (lon > bbox[2]) bbox[2] = lon; if (lat > bbox[3]) bbox[3] = lat;
  }
  for (const r of rings) for (let i = 0; i < r.length; i += 2) {
    if (r[i] < bbox[0]) bbox[0] = r[i]; if (r[i + 1] < bbox[1]) bbox[1] = r[i + 1];
    if (r[i] > bbox[2]) bbox[2] = r[i]; if (r[i + 1] > bbox[3]) bbox[3] = r[i + 1];
  }
  for (const r of segments) for (let i = 0; i < r.length; i += 2) {
    if (r[i] < bbox[0]) bbox[0] = r[i]; if (r[i + 1] < bbox[1]) bbox[1] = r[i + 1];
    if (r[i] > bbox[2]) bbox[2] = r[i]; if (r[i + 1] > bbox[3]) bbox[3] = r[i + 1];
  }
  if (bbox[2] < bbox[0]) bbox = [0, 0, 0, 0];

  const totalBytes = files.roads.bytes + files.landuse.bytes + files.poi.bytes + files.boundary.bytes;
  console.log(`  输出：道路 ${roads.length} / 用地 ${landuse.length} / POI ${poi.length} / 边界环 ${rings.length}；${(totalBytes / 1e6).toFixed(1)}MB；总耗时 ${Date.now() - t0}ms`);

  return {
    code: cfg.code, name: cfg.name, level: cfg.level,
    bbox, detailBbox: cfg.detailBbox,
    themes: {
      landuse: { count: landuse.length, bytes: files.landuse.bytes, classes: LANDUSE_CLASSES, classCounts: luCounts, file: `data/${cfg.code}-landuse.json` },
      roads: { count: roads.length, bytes: files.roads.bytes, classes: ROAD_CLASSES, classCounts: roadCounts, file: `data/${cfg.code}-roads.json` },
      poi: { count: poi.length, bytes: files.poi.bytes, classes: POI_CLASSES, classCounts: poiCounts, file: `data/${cfg.code}-poi.json` },
      boundary: { count: rings.length || segments.length, bytes: files.boundary.bytes, file: `data/${cfg.code}-boundary.json` },
    },
  };
}

const only = process.argv.slice(2);
const targets = only.length ? REGIONS.filter((r) => only.includes(r.code)) : REGIONS;
const manifestRegions = [];
for (const cfg of targets) {
  const res = await buildRegion(cfg);
  if (res) manifestRegions.push(res);
}

const manifestPath = path.join(OUT_DIR, 'manifest.json');
let prev = { regions: [] };
if (fs.existsSync(manifestPath)) {
  try { prev = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch { /* ignore */ }
}
const merged = manifestRegions.concat(prev.regions.filter((r) => !manifestRegions.some((m) => m.code === r.code)));
merged.sort((a, b) => REGIONS.findIndex((r) => r.code === a.code) - REGIONS.findIndex((r) => r.code === b.code));
fs.writeFileSync(manifestPath, JSON.stringify({
  generatedAt: new Date().toISOString(),
  license: 'ODbL 1.0',
  attribution: '© OpenStreetMap contributors',
  source: 'OpenStreetMap 省级提取（download.openstreetmap.fr），2026-11-05 快照',
  regions: merged,
}, null, 2));
console.log('\nmanifest 写入完成：', manifestPath);
