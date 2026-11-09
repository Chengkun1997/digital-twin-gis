/**
 * 图元构建与样式更新。
 * 大数据量刻意避开 Entity：面/线用 Primitive + GeometryInstance 批量提交，
 * 点用 PointPrimitiveCollection（内部同样批量绘制）。
 */
import { LANDUSE_COLORS, ROAD_COLORS, POI_COLORS } from './config.js';

function colorOf(Cesium, hex, alpha) {
  const c = Cesium.Color.fromCssColorString(hex);
  return new Cesium.Color(c.red, c.green, c.blue, alpha);
}

/** 面要素：每个要素一个 GeometryInstance，全部合入一个 Primitive */
export function buildPolygonLayer(Cesium, features, alpha, idPrefix) {
  const instances = [];
  const base = new Float32Array(features.length * 3);
  const t0 = performance.now();
  features.forEach((f, i) => {
    const cls = f[0];
    const flat = f.slice(1);
    if (flat.length < 6) return;
    const hex = LANDUSE_COLORS[cls] || '#8899aa';
    const c = Cesium.Color.fromCssColorString(hex);
    base[i * 3] = Math.round(c.red * 255);
    base[i * 3 + 1] = Math.round(c.green * 255);
    base[i * 3 + 2] = Math.round(c.blue * 255);
    instances.push(new Cesium.GeometryInstance({
      id: `${idPrefix}-${i}`,
      geometry: new Cesium.PolygonGeometry({
        polygonHierarchy: new Cesium.PolygonHierarchy(Cesium.Cartesian3.fromDegreesArray(flat)),
        vertexFormat: Cesium.PerInstanceColorAppearance.VERTEX_FORMAT,
        height: 0,
      }),
      attributes: {
        color: Cesium.ColorGeometryInstanceAttribute.fromColor(
          new Cesium.Color(c.red, c.green, c.blue, alpha),
        ),
      },
    }));
  });
  const primitive = new Cesium.Primitive({
    geometryInstances: instances,
    appearance: new Cesium.PerInstanceColorAppearance({
      flat: true,
      translucent: true,
      closed: false,
    }),
    asynchronous: true,
    releaseGeometryInstances: false,
  });
  return { kind: 'polygon', primitive, count: instances.length, base, alpha, buildMs: performance.now() - t0 };
}

/** 线要素：每段道路一个 GeometryInstance，用 PolylineColorAppearance 批量绘制 */
export function buildLineLayer(Cesium, features, alpha, idPrefix) {
  const instances = [];
  const base = new Float32Array(features.length * 3);
  const t0 = performance.now();
  features.forEach((f, i) => {
    const cls = f[0];
    const flat = f.slice(1);
    if (flat.length < 4) return;
    const hex = ROAD_COLORS[cls] || '#8899aa';
    const c = Cesium.Color.fromCssColorString(hex);
    base[i * 3] = Math.round(c.red * 255);
    base[i * 3 + 1] = Math.round(c.green * 255);
    base[i * 3 + 2] = Math.round(c.blue * 255);
    instances.push(new Cesium.GeometryInstance({
      id: `${idPrefix}-${i}`,
      geometry: new Cesium.PolylineGeometry({
        positions: Cesium.Cartesian3.fromDegreesArray(flat),
        width: 1.0,
        vertexFormat: Cesium.PolylineColorAppearance.VERTEX_FORMAT,
      }),
      attributes: {
        color: Cesium.ColorGeometryInstanceAttribute.fromColor(
          new Cesium.Color(c.red, c.green, c.blue, alpha),
        ),
      },
    }));
  });
  const primitive = new Cesium.Primitive({
    geometryInstances: instances,
    appearance: new Cesium.PolylineColorAppearance({ translucent: true }),
    asynchronous: true,
    releaseGeometryInstances: false,
  });
  return { kind: 'line', primitive, count: instances.length, base, alpha, buildMs: performance.now() - t0 };
}

/** 点要素：PointPrimitiveCollection（批量图元，比逐 Entity 快很多） */
export function buildPointLayer(Cesium, features, alpha, idPrefix) {
  const t0 = performance.now();
  const collection = new Cesium.PointPrimitiveCollection();
  const base = new Float32Array(features.length * 3);
  const scale = new Cesium.NearFarScalar(2000, 1.5, 400000, 0.4);
  features.forEach((f, i) => {
    const cls = f[0];
    const hex = POI_COLORS[cls] || '#99a3b3';
    const c = Cesium.Color.fromCssColorString(hex);
    base[i * 3] = Math.round(c.red * 255);
    base[i * 3 + 1] = Math.round(c.green * 255);
    base[i * 3 + 2] = Math.round(c.blue * 255);
    collection.add({
      id: `${idPrefix}-${i}`,
      position: Cesium.Cartesian3.fromDegrees(f[1], f[2]),
      color: new Cesium.Color(c.red, c.green, c.blue, alpha),
      pixelSize: 5,
      scaleByDistance: scale,
      translucencyByDistance: new Cesium.NearFarScalar(200000, 1.0, 900000, 0.15),
    });
  });
  return { kind: 'point', collection, count: collection.length, base, alpha, buildMs: performance.now() - t0 };
}

/** 省界：环数很少，用 PolylineCollection 设置线宽 */
export function buildBoundaryLayer(Cesium, rings, alpha, idPrefix) {
  const t0 = performance.now();
  const collection = new Cesium.PolylineCollection();
  for (const ring of rings) {
    if (ring.length < 4) continue;
    collection.add({
      positions: Cesium.Cartesian3.fromDegreesArray(ring),
      width: 2.2,
      material: Cesium.Material.fromType('Color', {
        color: new Cesium.Color(0.42, 0.93, 0.87, alpha),
      }),
    });
  }
  return { kind: 'boundary', collection, count: collection.length, base: null, alpha, buildMs: performance.now() - t0 };
}

/** 缓存每个 instance 的颜色代理，供透明度批量刷新 */
export function cacheInstanceAttributes(layer) {
  if (!layer.primitive || layer.attrs) return;
  const list = [];
  const gis = layer.primitive.geometryInstances || [];
  for (const gi of gis) {
    const a = layer.primitive.getGeometryInstanceAttributes(gi.id);
    if (a) list.push(a);
  }
  layer.attrs = list;
}

function setInstanceAlphaCached(layer, alpha) {
  const attrs = layer.attrs;
  if (!attrs) return false;
  const a = Math.round(255 * alpha);
  for (let i = 0; i < attrs.length; i++) {
    const arr = attrs[i].color;
    // 直接写回 Uint8Array，减少分配
    if (arr) {
      arr[3] = a;
      attrs[i].color = arr;
    }
  }
  return true;
}

/** 透明度更新（面/线：改 per-instance color 的 alpha；点：改点颜色；边界：改材质） */
export function applyLayerOpacity(Cesium, layer, alpha) {
  if (layer.kind === 'polygon' || layer.kind === 'line') {
    if (!layer.attrs) cacheInstanceAttributes(layer);
    if (!setInstanceAlphaCached(layer, alpha)) {
      // 属性代理未就绪（首次渲染前），退化为重建颜色属性
      const gis = layer.primitive.geometryInstances || [];
      for (let i = 0; i < gis.length; i++) {
        const b = layer.base;
        gis[i].attributes.color.value[3] = Math.round(255 * alpha);
      }
    }
  } else if (layer.kind === 'point') {
    const a = Math.round(255 * alpha);
    const coll = layer.collection;
    const base = layer.base;
    for (let i = 0; i < coll.length; i++) {
      const p = coll.get(i);
      const r = base[i * 3] / 255, g = base[i * 3 + 1] / 255, bl = base[i * 3 + 2] / 255;
      p.color = new Cesium.Color(r, g, bl, alpha);
    }
  } else if (layer.kind === 'boundary') {
    const coll = layer.collection;
    for (let i = 0; i < coll.length; i++) {
      coll.get(i).material.uniforms.color.alpha = alpha;
    }
  }
  layer.alpha = alpha;
}
