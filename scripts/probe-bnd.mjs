import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const pbf = require('osm-pbf-parser');
const file = process.argv[2];
fs.createReadStream(file).pipe(pbf()).on('data', (items) => {
  for (const it of items) {
    if (it.type !== 'relation') continue;
    const t = it.tags || {};
    if (t.boundary === 'administrative' && t.admin_level === '4') {
      const types = {};
      for (const m of it.members) types[m.type] = (types[m.type] || 0) + 1;
      console.log(it.id, t.name, 'members', it.members.length, JSON.stringify(types));
      const rels = it.members.filter((m) => m.type === 'relation').slice(0, 5);
      if (rels.length) console.log('  sub-relations:', rels.map((m) => `${m.id}:${m.role}`).join(' '));
    }
  }
});
