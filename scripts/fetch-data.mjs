/**
 * 下载 OSM 省级 PBF 提取（download.openstreetmap.fr，无需 key）
 * 用法：node scripts/fetch-data.mjs [regionCode...]
 * 支持断点续传（HTTP Range）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'data', 'pbf');
fs.mkdirSync(DIR, { recursive: true });

const ALL = ['beijing', 'shanghai', 'chongqing', 'sichuan', 'zhejiang', 'guangdong'];
const codes = process.argv.slice(2).length ? process.argv.slice(2) : ALL;
const BASE = 'https://download.openstreetmap.fr/extracts/asia/china';

for (const code of codes) {
  const url = `${BASE}/${code}.osm.pbf`;
  const dest = path.join(DIR, `${code}.osm.pbf`);
  let start = 0;
  if (fs.existsSync(dest)) {
    start = fs.statSync(dest).size;
    const head = await fetch(url, { method: 'HEAD' });
    const total = Number(head.headers.get('content-length') || 0);
    if (total && start >= total) {
      console.log(`[跳过] ${code} 已完整（${(total / 1e6).toFixed(1)} MB）`);
      continue;
    }
    console.log(`[续传] ${code} 从 ${(start / 1e6).toFixed(1)} MB 继续`);
  }
  const res = await fetch(url, { headers: start ? { Range: `bytes=${start}-` } : {} });
  if (!res.ok || !res.body) throw new Error(`下载失败 ${code}: HTTP ${res.status}`);
  if (start && res.status !== 206) {
    console.log(`[重下] ${code} 服务端不支持续传`);
    start = 0;
  }
  const ws = fs.createWriteStream(dest, { flags: start ? 'a' : 'w' });
  let written = start;
  for await (const chunk of res.body) {
    ws.write(chunk);
    written += chunk.length;
  }
  ws.end();
  await new Promise((r) => ws.on('finish', r));
  console.log(`[完成] ${code} ${(written / 1e6).toFixed(1)} MB`);
}
