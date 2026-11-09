import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const osmPbfParser = require('osm-pbf-parser');
const file = process.argv[2];

let n = 0;
fs.createReadStream(file)
  .pipe(osmPbfParser())
  .on('data', (items) => {
    for (const it of items) {
      if (it.type !== 'relation') continue;
      const t = it.tags || {};
      if (t.boundary === 'administrative' && t.admin_level && Number(t.admin_level) <= 6) {
        console.log(t.admin_level, t.name, 'members:', it.members.length,
          it.members.filter((m) => m.role === 'outer').length, 'ways', it.members.filter(m=>m.type==='way').length);
        if (++n > 40) process.exit(0);
      }
    }
  });
