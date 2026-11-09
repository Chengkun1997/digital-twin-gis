import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const osmPbfParser = require('osm-pbf-parser');

const file = process.argv[2];
const t0 = Date.now();
const nodeLon = new Map();
let nodes = 0, ways = 0, rels = 0;
const highway = {};
const poi = {};
const landuse = {};

fs.createReadStream(file)
  .pipe(osmPbfParser())
  .on('data', (items) => {
    for (const it of items) {
      if (it.type === 'node') {
        nodes++;
        if (it.tags && Object.keys(it.tags).length) { /* poi候选 */ }
        nodeLon.set(it.id, [it.lon, it.lat]);
      } else if (it.type === 'way') {
        ways++;
        const t = it.tags || {};
        if (t.highway) highway[t.highway] = (highway[t.highway] || 0) + 1;
        if (t.landuse) landuse[t.landuse] = (landuse[t.landuse] || 0) + 1;
      } else {
        rels++;
      }
    }
  })
  .on('end', () => {
    console.log({ nodes, ways, rels, ms: Date.now() - t0, memMB: Math.round(process.memoryUsage().heapUsed / 1e6) });
    console.log('highway', Object.entries(highway).sort((a, b) => b[1] - a[1]).slice(0, 12));
    console.log('landuse', Object.entries(landuse).sort((a, b) => b[1] - a[1]).slice(0, 12));
  });
