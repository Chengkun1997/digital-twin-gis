/**
 * 太阳位置 / 日出日落计算（NOAA Solar Calculator 算法）。
 *
 * 算法来源：NOAA Global Monitoring Laboratory, "Solar Calculator"（
 * https://gml.noaa.gov/grad/solcalc/ 及其公开的 solar_position 公式），
 * 主要用到：儒略世纪 T、太阳几何平黄经 L0、平近点角 M、中心差 C、
 * 真黄经→视黄经修正、平黄赤交角→真黄赤交角、赤纬 δ、时差 EoT。
 *
 * 精度：赤纬与均时差在 1901–2099 年内误差约 ±0.01°，日出日落时刻通常
 * 与 timeanddate.com / 天文台数据相差 1 分钟以内（考虑大气折射 -0.833°）。
 */

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
const mod360 = (v) => ((v % 360) + 360) % 360;

/** JS Date → 儒略日（含小数） */
export function julianDay(date) {
  return date.getTime() / 86400000 + 2440587.5;
}

/**
 * 某一 UTC 时刻的太阳参数。
 * @returns {{declination:number, eotMinutes:number, obliquity:number}}
 *   declination 视赤纬（度）、eotMinutes 均时差（分钟，真太阳时 - 平太阳时）
 */
export function solarParams(date) {
  const T = (julianDay(date) - 2451545) / 36525;

  const L0 = mod360(280.46646 + T * (36000.76983 + T * 0.0003032));
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);

  const Mr = M * RAD;
  const C = Math.sin(Mr) * (1.914602 - T * (0.004817 + 0.000014 * T))
    + Math.sin(2 * Mr) * (0.019993 - 0.000101 * T)
    + Math.sin(3 * Mr) * 0.000289;

  const trueLong = L0 + C;
  const omega = 125.04 - 1934.136 * T;
  const appLong = trueLong - 0.00569 - 0.00478 * Math.sin(omega * RAD);

  const e0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
  const eps = e0 + 0.00256 * Math.cos(omega * RAD);

  const declination = Math.asin(Math.sin(eps * RAD) * Math.sin(appLong * RAD)) * DEG;

  const y = Math.tan((eps * RAD) / 2) ** 2;
  const L0r = L0 * RAD;
  const eotMinutes = 4 * DEG * (
    y * Math.sin(2 * L0r)
    - 2 * e * Math.sin(Mr)
    + 4 * e * y * Math.sin(Mr) * Math.cos(2 * L0r)
    - 0.5 * y * y * Math.sin(4 * L0r)
    - 1.25 * e * e * Math.sin(2 * Mr)
  );

  return { declination, eotMinutes, obliquity: eps };
}

/** 太阳直射点（subsolar point）经纬度 */
export function subsolarPoint(date) {
  const { declination, eotMinutes } = solarParams(date);
  const utcHours = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  let lon = -15 * (utcHours + eotMinutes / 60 - 12);
  lon = mod360(lon + 180) - 180;
  return { lat: declination, lon };
}

/** 观测点的太阳高度角与方位角（度，方位角自北顺时针） */
export function solarAltitudeAzimuth(date, lat, lon) {
  const { declination, eotMinutes } = solarParams(date);
  const utcHours = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  // 真太阳时角：H = 15*(UTC + EoT/60 + lon/15 - 12)
  const H = (15 * (utcHours + eotMinutes / 60 + lon / 15 - 12)) * RAD;
  const φ = lat * RAD;
  const δ = declination * RAD;
  const sinAlt = Math.sin(φ) * Math.sin(δ) + Math.cos(φ) * Math.cos(δ) * Math.cos(H);
  const altitude = Math.asin(Math.max(-1, Math.min(1, sinAlt))) * DEG;
  const az = Math.atan2(
    Math.sin(H),
    Math.cos(H) * Math.sin(φ) - Math.tan(δ) * Math.cos(φ),
  ) * DEG;
  return { altitude, azimuth: mod360(az + 180) };
}

/**
 * 日出 / 日落 / 昼长。算法：以当地正午为初值求太阳正午时刻，
 * 再用太阳高度 -0.833°（含大气折射与日面半径）求时角，迭代两次收敛。
 *
 * @param {Date} dayLocalNoon 该日期当地正午左右的时间（只用年月日）
 * @param {number} lat 纬度（度，北正）
 * @param {number} lon 经度（度，东正）
 * @param {number} tzHours 当地时区偏移（如北京 8）
 */
export function sunTimes(dayLocalNoon, lat, lon, tzHours) {
  const y = dayLocalNoon.getFullYear();
  const m = dayLocalNoon.getMonth();
  const d = dayLocalNoon.getDate();
  // 以该历日的 UTC 0 时为基准，所有小时数都是 UTC 小时（可超出 0–24，Date 会自动进位）
  const utcMidnight = Date.UTC(y, m, d, 0, 0, 0);

  let solarNoon = 12 - lon / 15;
  let decl = 0;
  for (let i = 0; i < 3; i++) {
    const p = solarParams(new Date(utcMidnight + solarNoon * 3600 * 1000));
    decl = p.declination;
    solarNoon = 12 - lon / 15 - p.eotMinutes / 60;
  }

  const φ = lat * RAD;
  const δ = decl * RAD;
  const cosH = Math.cos(90.833 * RAD) / (Math.cos(φ) * Math.cos(δ)) - Math.tan(φ) * Math.tan(δ);
  const noonDate = new Date(utcMidnight + solarNoon * 3600 * 1000);

  if (cosH > 1) return { polar: 'night', solarNoon: noonDate, sunrise: null, sunset: null, dayLength: 0 };
  if (cosH < -1) return { polar: 'day', solarNoon: noonDate, sunrise: null, sunset: null, dayLength: 24 };

  const H0 = Math.acos(cosH) * DEG;
  let riseH = solarNoon - H0 / 15;
  let setH = solarNoon + H0 / 15;

  // 用日出/日落时刻的赤纬再修正一次
  for (let i = 0; i < 2; i++) {
    const pr = solarParams(new Date(utcMidnight + riseH * 3600 * 1000));
    const ps = solarParams(new Date(utcMidnight + setH * 3600 * 1000));
    const midDec = (pr.declination + ps.declination) / 2;
    const cosH2 = Math.cos(90.833 * RAD) / (Math.cos(φ) * Math.cos(midDec * RAD))
      - Math.tan(φ) * Math.tan(midDec * RAD);
    if (Math.abs(cosH2) > 1) break;
    const H2 = Math.acos(cosH2) * DEG;
    const noon2 = 12 - lon / 15 - (pr.eotMinutes + ps.eotMinutes) / 2 / 60;
    riseH = noon2 - H2 / 15;
    setH = noon2 + H2 / 15;
  }

  return {
    polar: null,
    solarNoon: new Date(utcMidnight + solarNoon * 3600 * 1000),
    sunrise: new Date(utcMidnight + riseH * 3600 * 1000),
    sunset: new Date(utcMidnight + setH * 3600 * 1000),
    dayLength: setH - riseH,
  };
}

/**
 * 晨昏线（太阳高度 = 0 的大圆）经纬度序列。
 * 由 sinφ·sinδ + cosφ·cosδ·cosH = 0 解得 tanφ = -cosH / tanδ，
 * 用 atan2(-cosH·cosδ, sinδ) 避免 δ→0 时除零。
 */
export function terminatorPositions(declinationDeg, step = 1) {
  const δ = declinationDeg * RAD;
  const out = [];
  for (let h = -180; h <= 180; h += step) {
    const H = h * RAD;
    const lat = Math.atan2(-Math.cos(H) * Math.cos(δ), Math.sin(δ)) * DEG;
    out.push(h, lat);
  }
  return out;
}

/**
 * 春分 / 夏至 / 秋分 / 冬至日期：逐日扫描太阳视赤纬（每日 12:00 UTC），
 * 取过零点与极值点所在日期。这是对 NOAA 赤纬的数值扫描，不是查表；
 * 精度约 ±1 天（未求解精确到分钟的交节时刻）。
 */
export function seasonEvents(year) {
  const days = [];
  const start = Date.UTC(year, 0, 1, 12);
  for (let i = 0; i < 366; i++) {
    const d = new Date(start + i * 86400000);
    if (d.getUTCFullYear() !== year) break;
    days.push({ date: d, decl: solarParams(d).declination });
  }
  const events = { spring: null, summer: null, autumn: null, winter: null };
  let maxD = days[0], minD = days[0];
  for (let i = 1; i < days.length; i++) {
    const a = days[i - 1].decl, b = days[i].decl;
    if (a <= 0 && b > 0) events.spring = days[i].date;      // 赤纬由负转正 → 春分
    if (a >= 0 && b < 0) events.autumn = days[i].date;      // 赤纬由正转负 → 秋分
    if (days[i].decl > maxD.decl) maxD = days[i];
    if (days[i].decl < minD.decl) minD = days[i];
  }
  events.summer = maxD.date;
  events.winter = minD.date;
  return events;
}

/** 把 UTC 时刻格式化为指定时区的 HH:MM */
export function formatHM(date, tzHours) {
  if (!date) return '—';
  const t = new Date(date.getTime() + tzHours * 3600 * 1000);
  return `${String(t.getUTCHours()).padStart(2, '0')}:${String(t.getUTCMinutes()).padStart(2, '0')}`;
}

/** 由北京时间「年月日 + 当日分钟数」得到 UTC Date */
export function beijingToUTC(y, m, d, minutes, tzHours = 8) {
  return new Date(Date.UTC(y, m, d, 0, minutes) - tzHours * 3600 * 1000);
}

/** 某年某月某日是当年第几天（1 起） */
export function dayOfYear(date) {
  const start = Date.UTC(date.getFullYear(), 0, 1);
  return Math.floor((Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) - start) / 86400000) + 1;
}

/** 当年总天数 */
export function daysInYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 366 : 365;
}

/** 由「年内第几天」得到 {month, day} */
export function fromDayOfYear(year, n) {
  const d = new Date(Date.UTC(year, 0, 1) + (n - 1) * 86400000);
  return { month: d.getUTCMonth(), day: d.getUTCDate() };
}
