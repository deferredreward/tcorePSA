import { zipSync } from 'fflate';
import fs from 'node:fs';
import path from 'node:path';

const root = process.argv[2];
const dir = path.join(root, 'test/fixtures/sample-burrito');
const files = {};
const walk = (d, base = '') =>
  fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) walk(path.join(d, e.name), rel);
    else files[rel] = new Uint8Array(fs.readFileSync(path.join(d, e.name)));
  });
walk(dir);
fs.writeFileSync(path.join(root, 'test/fixtures/sample-burrito.zip'), zipSync(files));
console.log('zip written:', Object.keys(files).length, 'files');
