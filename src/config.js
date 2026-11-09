/** 主题、配色、数据源说明 */

export const THEMES = {
  landuse: {
    key: 'landuse',
    title: '用地分类（面）',
    short: '面',
    iconClass: 'poly',
    kind: 'polygon',
    opacity: 0.8,
    describe: 'OSM landuse 面要素，按用地类型分色填充',
  },
  roads: {
    key: 'roads',
    title: '城市道路网（线）',
    short: '线',
    iconClass: 'line',
    kind: 'line',
    opacity: 0.95,
    describe: 'OSM highway 线要素，按道路等级分色；重点城市保留支路',
  },
  poi: {
    key: 'poi',
    title: '城市 POI（点）',
    short: '点',
    iconClass: 'point',
    kind: 'point',
    opacity: 1,
    describe: 'OSM 带标签兴趣点，按 12 类服务属性分色',
  },
  boundary: {
    key: 'boundary',
    title: '省级行政边界（线）',
    short: '界',
    iconClass: 'admin',
    kind: 'boundary',
    opacity: 0.9,
    describe: '由 OSM admin_level=4 关系拼接的省级边界',
  },
};

export const THEME_ORDER = ['landuse', 'roads', 'poi', 'boundary'];

export const LANDUSE_COLORS = [
  '#f0b352', // 居住
  '#e06c75', // 商业
  '#a06cd5', // 工业
  '#d9a06b', // 在建
  '#8ec07c', // 农业
  '#4f9d69', // 林地
  '#7bd389', // 绿地
  '#56b4e9', // 公共服务
  '#8d99ae', // 交通设施
  '#6b7280', // 其他
];

export const ROAD_COLORS = [
  '#ff5d5d', // 高速
  '#ff9f45', // 快速路
  '#ffd166', // 主干路
  '#9ee493', // 次干路
  '#5ec8ff', // 支路
  '#7d8ba1', // 居民区道路
];

export const POI_COLORS = [
  '#ff8a4c', '#ffd166', '#6ec1ff', '#ff6b81', '#4dd0e1', '#b38bff',
  '#6ee7a2', '#f4d35e', '#c9d1e0', '#57e0a4', '#aab6cc', '#7c8aa0',
];

/** 数据来源与授权（界面与 README 共用） */
export const SOURCES = [
  {
    name: 'OSM 省级矢量数据',
    detail: 'OpenStreetMap 省级提取（download.openstreetmap.fr/asia/china/，2026-11-05 快照）',
    license: 'ODbL 1.0 · © OpenStreetMap contributors',
  },
  {
    name: '省级行政边界',
    detail: '由同一份 OSM 数据中的 boundary=administrative、admin_level=4 关系拼接',
    license: 'ODbL 1.0 · © OpenStreetMap contributors',
  },
  {
    name: '卫星影像底图',
    detail: 'Esri World Imagery（无需 key，直接 XYZ 瓦片流式加载）',
    license: 'Esri / Maxar / Earthstar Geographics 版权，非开放许可，仅作演示底图',
  },
  {
    name: '暗色矢量底图',
    detail: 'CARTO Dark Matter 栅格瓦片（无需 key）',
    license: '© CARTO · © OpenStreetMap contributors',
  },
  {
    name: '地形',
    detail: 'Cesium 默认椭球地形（Cesium ion 地形需要 key，本项目未使用）',
    license: '—',
  },
];
