/**
 * 日照模式：太阳光照、晨昏线、直射点、日出日落信息面板。
 *
 * 光照使用 Cesium 的 SunLight（scene.globe.enableLighting = true），
 * 太阳方向由 viewer.clock.currentTime 决定，因此把时钟设成我们选定的 UTC 时刻即可。
 * 明暗交界（terminator）另外用一条虚线大圆画出，保证在任何缩放下都清晰可见。
 */
import {
  subsolarPoint, sunTimes, terminatorPositions, seasonEvents, solarAltitudeAzimuth,
  beijingToUTC, dayOfYear, daysInYear, fromDayOfYear, formatHM,
} from './sun.js';

const TZ = 8;

const pad2 = (n) => String(n).padStart(2, '0');
const mod360 = (v) => ((v % 360) + 360) % 360;

function fmtLatLon(lat, lon) {
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lon >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(2)}°${ns} ${Math.abs(lon).toFixed(2)}°${ew}`;
}

/** 北京时间（UTC+8）的墙上时间分量 */
function beijingNow() {
  const t = new Date(Date.now() + TZ * 3600 * 1000);
  return {
    year: t.getUTCFullYear(),
    month: t.getUTCMonth(),
    day: t.getUTCDate(),
    minutes: t.getUTCHours() * 60 + t.getUTCMinutes(),
  };
}

export function createSunMode({ Cesium, viewer, toast }) {
  const $ = (id) => document.getElementById(id);

  const now = beijingNow();
  const state = {
    on: false,
    year: now.year,
    doy: dayOfYear(new Date(Date.UTC(now.year, now.month, now.day))),
    minutes: now.minutes,
    playing: false,
    speed: 30,
    showTerminator: true,
    place: { name: '北京', lat: 39.9042, lon: 116.4074 },
  };

  // ---------------------------------------------------------------- 场景开关
  // Cesium 默认的昼夜光照有一段「按相机距离淡入」的过渡带：
  //   GlobeFS 里 fade = clamp((cameraDist - fadeOut) / (fadeIn - fadeOut), 0, 1)，
  //   fadeOut = π/2·R ≈ 9 985 km，fadeIn = π·R ≈ 19 970 km（距离指到球心）。
  // 全球视角（相机高度 7000–12000 km → 距球心约 13000–18000 km）正好落在过渡带里，
  // fade 只有 0.4 左右，昼夜对比被削掉一大半，看起来几乎一样亮。
  // 因此开启日照模式时把过渡带整体下移，让全球视角拿到 fade = 1 的完全光照。
  const globeDefaults = {
    lightIntensity: viewer.scene.light ? viewer.scene.light.intensity : undefined,
    lightingFadeOutDistance: viewer.scene.globe.lightingFadeOutDistance,
    lightingFadeInDistance: viewer.scene.globe.lightingFadeInDistance,
    nightFadeInDistance: viewer.scene.globe.nightFadeInDistance,
  };

  function setLighting(on) {
    const scene = viewer.scene;
    const globe = scene.globe;
    globe.enableLighting = on;
    globe.dynamicAtmosphereLighting = on;
    globe.dynamicAtmosphereLightingFromSun = on;
    globe.showGroundAtmosphere = true;
    scene.skyAtmosphere.show = true;
    scene.sun.show = on;

    if (on) {
      // 高度约 1640 km 以上全量光照，640 km 以下淡出（贴地看城市时地面不会全黑）
      globe.lightingFadeOutDistance = 7.0e6;
      globe.lightingFadeInDistance = 8.0e6;
      // 夜间大气暗化：默认在 43600 km 以外才完全生效，全球视角只有约 10%；
      // 收紧到 14000 km 后夜间一侧的大气散射会被压暗，昼夜边界更明显。
      globe.nightFadeInDistance = 14e6;
      // 太阳光强度：Cesium 默认 2.0 会让白天一侧过曝，1.0 时白天≈原亮度、夜间≈30%
      if (scene.light) scene.light.intensity = 1.0;
    } else {
      globe.lightingFadeOutDistance = globeDefaults.lightingFadeOutDistance;
      globe.lightingFadeInDistance = globeDefaults.lightingFadeInDistance;
      globe.nightFadeInDistance = globeDefaults.nightFadeInDistance;
      if (scene.light && globeDefaults.lightIntensity !== undefined) {
        scene.light.intensity = globeDefaults.lightIntensity;
      }
    }
  }

  // ---------------------------------------------------------------- 图元
  const terminator = viewer.entities.add({
    show: false,
    polyline: {
      positions: [],
      width: 2,
      arcType: Cesium.ArcType.NONE,
      material: new Cesium.PolylineDashMaterialProperty({
        color: new Cesium.Color(1.0, 0.62, 0.16, 0.95),
        dashLength: 18,
      }),
    },
  });

  const subMarker = viewer.entities.add({
    show: false,
    position: Cesium.Cartesian3.fromDegrees(0, 0, 0),
    point: {
      pixelSize: 10,
      color: new Cesium.Color(1.0, 0.86, 0.3, 1),
      outlineColor: new Cesium.Color(0.1, 0.08, 0.02, 0.9),
      outlineWidth: 2,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
    label: {
      text: '',
      font: '12px "Segoe UI", "Microsoft YaHei", sans-serif',
      fillColor: new Cesium.Color(1.0, 0.88, 0.55, 1),
      showBackground: true,
      backgroundColor: new Cesium.Color(0.05, 0.07, 0.11, 0.82),
      pixelOffset: new Cesium.Cartesian2(0, -22),
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
  });

  // ---------------------------------------------------------------- 时间
  function utcDate() {
    const { month, day } = fromDayOfYear(state.year, state.doy);
    return beijingToUTC(state.year, month, day, state.minutes, TZ);
  }

  function applyTime() {
    const utc = utcDate();
    viewer.clock.currentTime = Cesium.JulianDate.fromDate(utc);
    viewer.clock.shouldAnimate = false;
    return utc;
  }

  // ---------------------------------------------------------------- 刷新
  function updateEntities(utc) {
    const sub = subsolarPoint(utc);

    subMarker.show = state.on;
    subMarker.position = Cesium.Cartesian3.fromDegrees(sub.lon, sub.lat, 0);
    subMarker.label.text = `直射点 ${fmtLatLon(sub.lat, sub.lon)}`;

    terminator.show = state.on && state.showTerminator;
    if (terminator.show) {
      const pairs = terminatorPositions(sub.lat, 1.5);
      const flat = new Array(pairs.length);
      for (let i = 0; i < pairs.length; i += 2) {
        flat[i] = sub.lon + pairs[i];
        flat[i + 1] = pairs[i + 1];
      }
      terminator.polyline.positions = Cesium.Cartesian3.fromDegreesArray(flat);
    }
    return sub;
  }

  let seasonText = '';
  function updateSeason() {
    if (seasonText) return seasonText;
    const ev = seasonEvents(state.year);
    const f = (d) => (d ? `${d.getUTCMonth() + 1}/${d.getUTCDate()}` : '—');
    seasonText = `${state.year} 春分 ${f(ev.spring)} · 夏至 ${f(ev.summer)} · 秋分 ${f(ev.autumn)} · 冬至 ${f(ev.winter)}`
      + '（NOAA 太阳赤纬逐日扫描，±1 天）';
    $('sun-season').textContent = seasonText;
    return seasonText;
  }

  function updateInfo(utc, sub) {
    const { month, day } = fromDayOfYear(state.year, state.doy);
    const dateStr = `${state.year}-${pad2(month + 1)}-${pad2(day)}`;
    const hh = Math.floor(state.minutes / 60);
    const mm = Math.floor(state.minutes % 60);

    $('sun-day-label').textContent = `${month + 1} 月 ${pad2(day)} 日`;
    $('sun-time-label').textContent = `${pad2(hh)}:${pad2(mm)}`;
    $('sun-utc-label').textContent = `UTC ${formatHM(utc, 0)}`;

    const { lat, lon } = state.place;
    const t = sunTimes(new Date(Date.UTC(state.year, month, day, 12)), lat, lon, TZ);
    const alt = solarAltitudeAzimuth(utc, lat, lon);

    $('sun-place-name').textContent = state.place.name;
    $('sun-coord').textContent = fmtLatLon(lat, lon);
    $('sun-date2').textContent = dateStr;
    $('sun-bj').textContent = `${pad2(hh)}:${pad2(mm)}`;
    $('sun-utc').textContent = formatHM(utc, 0);
    $('sun-sub').textContent = fmtLatLon(sub.lat, sub.lon);
    $('sun-alt').textContent = `${alt.altitude.toFixed(1)}° ${alt.altitude > 0 ? '（白昼）' : '（夜间）'}`;

    if (t.polar === 'day') {
      $('sun-riseset').textContent = '极昼（全天不落）';
      $('sun-daylen').textContent = '24h00m';
    } else if (t.polar === 'night') {
      $('sun-riseset').textContent = '极夜（全天不升）';
      $('sun-daylen').textContent = '00h00m';
    } else {
      $('sun-riseset').textContent = `${formatHM(t.sunrise, TZ)} / ${formatHM(t.sunset, TZ)}`;
      const dh = Math.floor(t.dayLength);
      const dm = Math.round((t.dayLength - dh) * 60);
      $('sun-daylen').textContent = `${dh}h${pad2(dm)}m`;
    }
  }

  function syncSliders() {
    $('sun-day').max = String(daysInYear(state.year));
    $('sun-day').value = String(state.doy);
    $('sun-minute').value = String(Math.round(state.minutes));
  }

  /** 完整刷新：时钟、图元、面板 */
  function refresh() {
    const utc = applyTime();
    const sub = updateEntities(utc);
    updateInfo(utc, sub);
    return { utc, sub };
  }

  // ---------------------------------------------------------------- 交互
  function setEnabled(on) {
    state.on = on;
    $('sun-switch').classList.toggle('on', on);
    $('sun-panel').querySelector('.sun-body').classList.toggle('off', !on);
    setLighting(on);
    if (on) {
      refresh();
      updateSeason();
      const h = viewer.camera.positionCartographic.height;
      if (h < 2.5e6) {
        viewer.camera.flyTo({
          destination: Cesium.Cartesian3.fromDegrees(105, 22, 1.15e7),
          orientation: { heading: 0, pitch: Cesium.Math.toRadians(-90), roll: 0 },
          duration: 1.8,
        });
      }
      toast('日照模式已开启：拖动日期/时刻查看晨昏线移动');
    } else {
      terminator.show = false;
      subMarker.show = false;
      viewer.clock.shouldAnimate = true;
    }
  }

  let rafId = 0;
  let lastTs = 0;
  let lastInfo = 0;
  function loop(ts) {
    if (!state.playing || !state.on) { rafId = 0; return; }
    if (!lastTs) lastTs = ts;
    const dt = Math.min(0.12, (ts - lastTs) / 1000);
    lastTs = ts;
    state.minutes = (state.minutes + state.speed * dt) % 1440;
    const utc = applyTime();
    const sub = updateEntities(utc);
    if (ts - lastInfo > 100) {
      lastInfo = ts;
      updateInfo(utc, sub);
      $('sun-minute').value = String(Math.round(state.minutes));
    }
    rafId = requestAnimationFrame(loop);
  }

  function setPlaying(on) {
    if (on && !state.on) setEnabled(true);
    state.playing = on;
    $('sun-play').textContent = on ? '⏸ 暂停' : '▶ 播放';
    $('sun-play').classList.toggle('playing', on);
    if (on) {
      if (!rafId) { lastTs = 0; rafId = requestAnimationFrame(loop); }
    } else if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
  }

  $('sun-switch').addEventListener('click', () => setEnabled(!state.on));
  $('sun-play').addEventListener('click', () => setPlaying(!state.playing));
  $('sun-speed').addEventListener('change', (e) => { state.speed = Number(e.target.value); });

  $('sun-day').addEventListener('input', (e) => {
    state.doy = Number(e.target.value);
    if (!state.on) setEnabled(true);
    refresh();
  });

  $('sun-minute').addEventListener('input', (e) => {
    state.minutes = Number(e.target.value);
    if (!state.on) setEnabled(true);
    refresh();
  });

  $('sun-now').addEventListener('click', () => {
    const n = beijingNow();
    state.year = n.year;
    state.doy = dayOfYear(new Date(Date.UTC(n.year, n.month, n.day)));
    state.minutes = n.minutes;
    seasonText = '';
    if (!state.on) setEnabled(true);
    syncSliders();
    updateSeason();
    refresh();
  });

  $('sun-terminator').addEventListener('change', (e) => {
    state.showTerminator = e.target.checked;
    refresh();
  });

  $('sun-follow').addEventListener('click', () => {
    const canvas = viewer.scene.canvas;
    const p = viewer.camera.pickEllipsoid(
      new Cesium.Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2),
      Cesium.Ellipsoid.WGS84,
    );
    if (!p) { toast('视图中心不在球面上，请先拖动地球'); return; }
    const c = Cesium.Cartographic.fromCartesian(p);
    state.place = {
      name: '视图中心',
      lat: Cesium.Math.toDegrees(c.latitude),
      lon: Cesium.Math.toDegrees(c.longitude),
    };
    refresh();
    toast(`观测位置已设为视图中心 ${fmtLatLon(state.place.lat, state.place.lon)}`);
  });

  // 初始化：面板先显示当前时刻，但不开启光照
  syncSliders();
  setLighting(false);
  refresh();
  updateSeason();

  return {
    state,
    setEnabled,
    setPlaying,
    refresh,
    isOn: () => state.on,
  };
}
