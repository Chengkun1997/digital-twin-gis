# 数字孪生 GIS 基础系统（开源数据版）

参照《数字孪生技术已经不是门槛-2小时建站过程》的形态，用 **Vite + CesiumJS + OpenStreetMap 开源数据** 复现一套可运行的
数字孪生 GIS 基础系统。原文中的 LCC Web SDK 属于自研封装、公开渠道无法获取，本项目使用 CesiumJS 原生能力实现等价能力。

![总览](screenshots/04-gpu.png)

## 1. 快速开始

> **仓库不包含矢量数据**（`public/data/*.json` 约 148 MB，`.gitignore` 已排除），
> clone 下来必须先跑 `npm run fetch` + `npm run data` 才会有数据，否则页面会提示找不到 `manifest.json`。

```bash
npm install
npm run fetch        # 下载 6 个省级 .osm.pbf 到 data/pbf（约 490 MB，需联网，支持断点续传）
npm run data         # 解析并生成 public/data/*.json + manifest.json（约 148 MB，耗时数分钟）
npm run dev          # http://localhost:5173
```

如果本机已有 `public/data/`，可跳过前两步，直接 `npm install && npm run dev`。

生产构建与静态部署：

```bash
npm run build        # 产物在 dist/（含 Cesium 静态资源与 data/）
npm run preview      # 本地预览构建产物
```

`dist/` 是完全静态的，可放到任意静态服务器（Nginx / OSS / GitHub Pages / `npx serve dist`）。
Vite 使用相对路径 `base: './'`，因此支持部署在子目录下，无需额外配置。

构建产物实测约 **160 MB**：`data/` 148 MB（矢量数据）+ `cesium/` 约 11 MB（Cesium Workers/Assets/Widgets）+ `assets/` 约 5 MB（Cesium 主包 4.9 MB，gzip 后 1.35 MB）。
注意 `main.js` 使用了顶层 `await`，`vite.config.js` 里已把 `build.target` 设为 `esnext`（否则默认 es2020 目标会报错）。


## 2. 功能对照

| 原文能力 | 本项目实现 | 说明 |
| --- | --- | --- |
| 左侧「数据专辑」面板 | ✅ | 4 个专辑：用地分类（面）/ 道路网（线）/ POI（点）/ 省级边界；每项显示图层数、要素数、数据量（均为真实统计值） |
| 顶部实时计数 | ✅ | 「已启用图层」「已渲染 X / Y 要素」、FPS、已加载 MB，随区域与专题开关实时变化 |
| 右侧「按区域开关」 | ✅ | 6 个省级区域，勾选即按需加载、显示/隐藏；含主题透明度滑杆（面/线/点/边界各一条） |
| 面状专题 | ✅ | OSM `landuse` 面，按 10 类用地分色填充 + 图例 |
| 线状专题（十万级） | ✅ | OSM `highway` 线，按 6 级道路分色，全量 102.3 万条 |
| 点状专题（十万级以上） | ✅ | OSM 带标签 POI，按 12 类分色，全量 37.5 万点 |
| 卫星影像底图 + 瓦片流式加载 | ✅ | Esri World Imagery（XYZ 瓦片，调用不需要 API key），另附 CARTO 暗色底图、无底图。**免 key ≠ 免费商用**，见第 3 节 |
| 三维地球旋转/缩放/切底图 | ✅ | Cesium 原生相机 + 底图切换 |

> 说明：本项目没有引入 3D Tiles / 倾斜摄影 / 建筑白模，原文也未要求；所有要素都是真实矢量图元，不是静态图片。

## 3. 数据来源与授权

| 数据 | 来源 | 授权/署名 |
| --- | --- | --- |
| 道路、用地、POI、行政边界 | OpenStreetMap 省级提取：`download.openstreetmap.fr/extracts/asia/china/`（2026-11-05 快照） | **ODbL 1.0**，© OpenStreetMap contributors |
| 省级边界 | 同一份 OSM 数据中的 `boundary=administrative` + `admin_level=4` 关系，按共享节点拼接 | ODbL 1.0 |
| 卫星影像 | Esri World Imagery（`server.arcgisonline.com/.../World_Imagery/MapServer`） | Esri / Maxar / Earthstar Geographics，**非开放许可**，仅作演示底图 |
| 暗色底图 | CARTO Dark Matter（`basemaps.cartocdn.com`） | © CARTO · © OpenStreetMap contributors |
| 地形 | Cesium 默认椭球（未使用 Cesium ion 地形，因为需要 key） | — |

界面左下角「数据来源」面板中对每一项都有署名与协议说明；底图版权同时显示在 Cesium credit 中。

**关于底图的重要提醒**：

- 矢量数据（道路/用地/POI/省界）来自 OSM，受 **ODbL 1.0** 保护，可自由使用、修改、再分发，
  但再分发衍生数据库必须同样以 ODbL 提供，并署名 `© OpenStreetMap contributors`；
- **Esri World Imagery 不是开源/开放许可**。它只是「调用时不需要填 API key」，不代表可以免费商用；
  本项目仅把它作为**本地演示底图**。若要对外提供服务或商业使用，请自行替换为天地图（需 key）、
  自建影像瓦片或其它已获授权的影像服务；切换到「无底图」即为纯矢量模式。
- 本项目代码采用 **MIT**，详见 [LICENSE](LICENSE)；MIT 不覆盖上述第三方数据与底图服务。

## 4. 数据规模（真实统计）

| 区域 | 级别 | 道路（线） | 用地分类（面） | POI（点） | 省级边界 | 合计要素 | 数据量 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 北京市 | 直辖市 | 133,973 | 36,936 | 49,190 | 1 | 220,100 | 16.0 MB |
| 上海市 | 直辖市 | 155,766 | 26,380 | 54,170 | 2 | 236,318 | 13.2 MB |
| 重庆市 | 直辖市 | 83,973 | 15,295 | 15,460 | 4 | 114,732 | 12.8 MB |
| 四川省 | 省 | 162,749 | 76,586 | 30,143 | 5 | 269,483 | 34.3 MB |
| 浙江省 | 省 | 192,642 | 75,986 | 75,968 | 238 | 344,834 | 28.8 MB |
| 广东省 | 省 | 293,724 | 117,798 | 150,237 | 22 | 561,781 | 43.2 MB |
| **合计** | — | **1,022,827** | **348,981** | **375,168** | **272** | **1,747,248** | **148.2 MB** |

- 边界列是 OSM `admin_level=4` relation 拼出的环 / 边界段数量，不是要素顶点数；
- 数据量是前端实际下载的 JSON 字节数（已做坐标压缩与 Douglas-Peucker 简化），不是原始 pbf（原始 6 个 pbf 合计约 400 MB）；
- 道路线覆盖了「全省骨架路网（motorway/trunk/primary/secondary）+ 重点城市范围内的 tertiary 及以下支路」，所以各省道路量差异与 `detailBbox` 覆盖面积直接相关。

数据由 `scripts/build-data.mjs` 从 `.osm.pbf` 离线解析生成，产物在 `public/data/`，属于**本地内置静态文件**，运行时不会请求 Overpass 或其它 OSM 接口。
这些文件**不在 Git 仓库中**（体积 148 MB，且 `dist/data/` 会再复制一份），需用第 5 节的命令重新生成。
**离线情况下**：矢量专题（面/线/点/省界）、面板计数、区域开关、透明度、图例全部正常，只有 Cesium 的球体渲染与深色背景；底图瓦片（Esri/CARTO）会加载失败，地球显示为纯色底，这不影响矢量数据的展示与交互。切换底图按钮里的「无底图」就是纯矢量模式。

## 5. 数据再生成（可选）

```bash
npm run fetch                 # 下载 6 个省级 .osm.pbf 到 data/pbf（约 400 MB，支持断点续传）
npm run data                  # 解析并生成 public/data/*.json + manifest.json
```

解析规则（脚本内可调）：

- 道路：骨架等级（motorway/trunk/primary/secondary）全省保留；tertiary 及以下只保留在各省重点城市 `detailBbox` 内，避免支路把数据量撑爆；
- 用地：只保留闭合 `landuse` way，按 10 类归并；
- POI：只保留带 `amenity/shop/tourism/leisure/office/historic/railway/...` 标签的节点，按 12 类归并；
- 简化：Douglas-Peucker（道路约 9 m、面约 12 m、省界约 40 m），坐标保留 5 位小数（约 1 m）。

## 6. 性能实测

13 个场景，每个场景固定相机、采样 4 秒（`scripts/bench.mjs`，原始数据见 `screenshots/bench-headful.json`）：

![性能自检](screenshots/03-bench-headful.png)

| 场景 | 要素数 | 平均 FPS | 最低 FPS |
| --- | --- | --- | --- |
| 基线（无矢量图层） | 0 | 56.0 | 52.6 |
| 北京 · 用地分类（面） | 36,936 | 44.4 | 52.9 |
| 北京 · 道路网（线） | 133,973 | 45.2 | 40.8 |
| 北京 · POI（点） | 49,190 | 56.4 | 52.9 |
| 北京 · 全部专题 | 220,100 | 41.0 | 37.0 |
| 广东 · 用地分类（面） | 117,798 | 56.1 | 53.2 |
| 广东 · 道路网（线） | 293,724 | 30.9 | 27.2 |
| 广东 · POI（点） | 150,237 | 56.6 | 53.2 |
| 广东 · 全部专题 | 561,781 | 28.1 | 26.2 |
| 6 省 · 用地分类（面） | 348,981 | 31.8 | 29.9 |
| 6 省 · 道路网（线） | 1,022,827 | **7.2** | 8.8 |
| 6 省 · POI（点） | 375,168 | **10.4** | 10.0 |
| 6 省 · 全部专题 | 1,747,010 | **4.8** | 1.4 |

结论（如实）：

- **约 56 万要素以内可保持交互**：广东全专题 28 FPS，北京全专题 41 FPS，拖拽/缩放仍跟手；
- **到 102 万条道路线时明显掉帧**（7.2 FPS），瓶颈是百万级 `GeometryInstance` 的合批与绘制，而不是 JSON 解析；
- **全量 174.7 万要素基本不可交互**（4.8 FPS，最低 1.4 FPS）。这个量级在集成显卡上不适合一次全开，实际使用应按「一个省」为单位开；
- 点要素的表现明显优于线：37.5 万 POI 仍有 10.4 FPS，而 37.5 万面（用地）有 31.8 FPS，主要成本在线的顶点数与合批。

首次加载耗时（主线程构建 `buildMs` / 到图元可渲染 `readyMs`，含 Cesium 异步合批，实测于集显机器）：

| 图层 | 构建 | 可渲染 |
| --- | --- | --- |
| 北京 用地 3.7 万面 | 101 ms | 1,434 ms |
| 北京 道路 13.4 万线 | 237 ms | 3,599 ms |
| 北京 POI 4.9 万点 | 38 ms | 立即 |
| 广东 道路 29.4 万线 | 440 ms | 4,839 ms |
| 广东 POI 15.0 万点 | 114 ms | 立即 |
| 浙江 道路 19.3 万线 | 368 ms | 3,063 ms |
| 6 省 用地 34.9 万面 | 约 1.3 s | 3,610 ms |



测试口径：Chrome 实测（非软件渲染）、1600×900 视口、Cesium 默认椭球、每个场景固定相机并采样 4 秒；
FPS 由 `requestAnimationFrame` 帧间隔统计，最低 FPS 取 P95 帧间隔的倒数。测试机为集成显卡（Intel UHD），不代表高端独显表现。
可在界面底部点击「性能自检」重跑（或访问 `?bench=1`），结果表会打印在页面中央，原始数据写入 `screenshots/bench-headful.json`。

## 7. 渲染实现要点

- **面 / 线**：每个要素一个 `GeometryInstance`，按「区域 × 专题」合成一个 `Primitive`（`PerInstanceColorAppearance` / `PolylineColorAppearance`），
  用 per-instance color 表示分类，避免几十万 Entity 带来的 draw call 爆炸。
- **点**：`PointPrimitiveCollection`（内部批量绘制），比逐个 Entity 更适合大批量点位。
- **透明度**：面/线通过 `Primitive.getGeometryInstanceAttributes().color` 批量改 alpha；点在滑杆释放时批量改 `point.color`。
- **区域开关**：每个区域单独持有图元，切换只改 `show`，不重建几何体；未勾选的省份不会发起任何数据请求。

## 8. 已知限制 / 未做到

1. 区域筛选是 **6 个省级区域**（4 直辖市 + 2 省），不是全国 34 个省级行政区；市/县两级未做。
2. 省界由 OSM relation 拼接，个别省（浙江）因边界 way 不闭合退化为「分段线」渲染，仍是真实边界数据，但不是单环。
3. 底图卫星影像是 Esri 的公开服务，**不是开放许可**，商用需自行替换（可换天地图/自建影像，需 key）；
   OSM 官方栅格瓦片在本机网络不可达，因此暗色底图改用 CARTO。
4. 未使用 Cesium ion：无全球地形、无 ion 影像；地形为椭球面，山区没有高程起伏。
5. 未实现 POI 点击拾取/属性查询、空间查询、路径分析等业务功能。
6. 大数据量下首次加载有明显构建耗时（几十万图元的主线程构建 + Cesium 异步合批），详见性能表。

## 9. 目录结构

```
digital-twin-gis/
├─ public/data/             # 运行时数据（manifest + 各省 roads/landuse/poi/boundary.json）
├─ data/pbf/                # 原始 OSM 提取（仅构建时使用，可删除）
├─ scripts/
│  ├─ fetch-data.mjs        # 下载省级 pbf（断点续传）
│  ├─ build-data.mjs        # pbf → 精简专题 GeoJSON
│  ├─ verify.mjs            # 无头 Chromium 渲染自检
│  └─ bench.mjs             # 性能自检（真实 GPU）
├─ src/
│  ├─ main.js               # 场景、面板、加载、计数、性能自检
│  ├─ layers.js             # 面/线/点/边界图元构建与透明度
│  ├─ config.js             # 配色、专题、数据源说明
│  └─ styles.css
└─ vite.config.js
```
