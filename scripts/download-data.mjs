/**
 * 从 GitHub Releases 下载固定快照的矢量数据包，解压到 public/data。
 *
 * 数据包由 build-data.mjs 生成，OSM 快照日期 2026-11-05（ODbL 1.0）。
 * 私有仓库下载优先复用 gh 的登录凭据；gh 不可用时回退到 GH_TOKEN / GITHUB_TOKEN。
 *
 * 用法：npm run data:download [-- --force]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import AdmZip from 'adm-zip';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'public', 'data');
const TMP_DIR = path.join(ROOT, '.tmp-data-download');

const TAG = 'data-2026-11-05';
const ASSET = 'digital-twin-gis-data-2026-11-05.zip';
const FALLBACK_SLUG = 'Chengkun1997/digital-twin-gis';
const FORCE = process.argv.includes('--force');

const log = (msg) => console.log(msg);

function repoSlug() {
  const r = spawnSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8' });
  if (r.status === 0) {
    const m = r.stdout.match(/github\.com[:/]([\w.-]+)\/([\w.-]+)/i);
    if (m) return `${m[1]}/${m[2].replace(/\.git$/i, '')}`;
  }
  return FALLBACK_SLUG;
}

/** 优先用已登录的 gh 下载（私有仓库也能直接拉取） */
function downloadWithGh(slug, dir) {
  const r = spawnSync(
    'gh',
    ['release', 'download', TAG, '--repo', slug, '--pattern', ASSET, '--dir', dir, '--clobber'],
    { encoding: 'utf8' },
  );
  if (r.error) return { ok: false, reason: `gh 不可用（${r.error.code}），尝试 GH_TOKEN 方式` };
  if (r.status !== 0) {
    const err = `${r.stderr || ''}${r.stdout || ''}`.trim();
    return { ok: false, reason: err || `gh 退出码 ${r.status}` };
  }
  const file = path.join(dir, ASSET);
  return fs.existsSync(file) ? { ok: true } : { ok: false, reason: 'gh 执行成功但未找到下载文件' };
}

/** 备选路径：用 GH_TOKEN 调 GitHub API 下载 Release 资产 */
async function downloadWithToken(slug, dir) {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (!token) return { ok: false, reason: '未设置 GH_TOKEN / GITHUB_TOKEN' };

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'digital-twin-gis-data-loader',
  };
  const relRes = await fetch(`https://api.github.com/repos/${slug}/releases/tags/${TAG}`, { headers });
  if (!relRes.ok) return { ok: false, reason: `GitHub API ${relRes.status} ${relRes.statusText}` };
  const rel = await relRes.json();
  const asset = (rel.assets || []).find((a) => a.name === ASSET);
  if (!asset) return { ok: false, reason: `Release ${TAG} 中不存在资产 ${ASSET}` };

  // 资产接口会 302 到 S3，跳转后不能继续携带 Authorization，否则会被拒绝
  const res = await fetch(`https://api.github.com/repos/${slug}/releases/assets/${asset.id}`, {
    headers: { ...headers, Accept: 'application/octet-stream' },
    redirect: 'manual',
  });
  let body = res;
  if (res.status >= 300 && res.status < 400) {
    const loc = res.headers.get('location');
    if (!loc) return { ok: false, reason: 'GitHub 未返回资产下载地址' };
    body = await fetch(loc, { headers: { 'User-Agent': 'digital-twin-gis-data-loader' } });
  }
  if (!body.ok || !body.body) return { ok: false, reason: `资产下载失败 ${body.status} ${body.statusText}` };

  const outFile = path.join(dir, ASSET);
  await pipeline(Readable.fromWeb(body.body), fs.createWriteStream(outFile));
  return { ok: true };
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** 校验关键文件存在、JSON 可解析、要素数与 manifest 声明一致 */
function validate(dir) {
  const problems = [];
  const manifestFile = path.join(dir, 'manifest.json');
  if (!fs.existsSync(manifestFile)) {
    problems.push('缺少 manifest.json');
    return problems;
  }
  let manifest;
  try {
    manifest = readJson(manifestFile);
  } catch (e) {
    problems.push(`manifest.json 解析失败：${e.message}`);
    return problems;
  }
  if (!Array.isArray(manifest.regions) || manifest.regions.length === 0) {
    problems.push('manifest.json 中 regions 为空');
    return problems;
  }

  let checked = 0;
  for (const region of manifest.regions) {
    for (const [theme, info] of Object.entries(region.themes || {})) {
      // manifest 中的 file 形如 "data/beijing-landuse.json"，这里只取文件名
      const file = path.join(dir, path.basename(info.file || `${region.code}-${theme}.json`));
      const name = path.basename(file);
      if (!fs.existsSync(file)) {
        problems.push(`缺少 ${name}`);
        continue;
      }
      let json;
      try {
        json = readJson(file);
      } catch (e) {
        problems.push(`${name} 解析失败：${e.message}`);
        continue;
      }
      const count = json.f
        ? json.f.length
        : (json.rings?.length || 0) + (json.segments?.length || 0);
      if (count !== info.count) {
        problems.push(`${name} 要素数 ${count}，与 manifest 声明的 ${info.count} 不一致`);
      }
      checked++;
    }
  }
  if (!problems.length) log(`校验通过：${manifest.regions.length} 个区域 / ${checked} 个图层文件，要素数与 manifest 一致`);
  return problems;
}

async function main() {
  const slug = repoSlug();
  const manifestFile = path.join(OUT_DIR, 'manifest.json');

  if (fs.existsSync(manifestFile) && !FORCE) {
    log('public/data 已存在数据，跳过下载（如需重新下载请加 --force）');
    return;
  }

  log(`数据来源：${slug} 的 Release ${TAG}`);
  log(`资产：${ASSET}`);

  fs.rmSync(TMP_DIR, { recursive: true, force: true });
  fs.mkdirSync(TMP_DIR, { recursive: true });

  const gh = downloadWithGh(slug, TMP_DIR);
  if (gh.ok) {
    log('下载完成（gh release download）');
  } else {
    log(`gh 下载失败：${gh.reason}`);
    const tk = await downloadWithToken(slug, TMP_DIR);
    if (!tk.ok) {
      fs.rmSync(TMP_DIR, { recursive: true, force: true });
      throw new Error(
        `数据下载失败，两种方式都不可用。\n`
        + `请先执行 gh auth login（私有仓库必须有权限），或设置 GH_TOKEN 环境变量后重试。\n`
        + `也可以改用「npm run fetch && npm run data」从 OSM 重新生成数据。`,
      );
    }
    log('下载完成（GH_TOKEN 方式）');
  }

  const zipFile = path.join(TMP_DIR, ASSET);
  const sizeMB = (fs.statSync(zipFile).size / 1024 / 1024).toFixed(1);
  log(`压缩包 ${sizeMB} MB，开始解压…`);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  new AdmZip(zipFile).extractAllTo(OUT_DIR, true);

  const problems = validate(OUT_DIR);
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
  if (problems.length) {
    throw new Error(`数据校验失败：\n- ${problems.join('\n- ')}`);
  }
  log('数据已就绪，可执行 npm run dev');
}

main().catch((e) => {
  console.error(`\n[data:download] ${e.message}`);
  process.exit(1);
});
