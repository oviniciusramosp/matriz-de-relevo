import { DOMParser } from '@xmldom/xmldom';
import * as THREE from 'three';
import fs from 'node:fs';
import { parseSVG } from '../svgpoly.js';
import { nestTree } from '../geom.js';
import { setTriangulator } from '../mesh.js';
import { buildStamp, DEFAULTS } from '../stamp.js';
import { toSTL, to3MF } from '../exporters.js';

globalThis.DOMParser = DOMParser;
setTriangulator((c, h) => THREE.ShapeUtils.triangulateShape(c, h));

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100">
  <!-- anel: externo + furo -->
  <path d="M20,50 a30,30 0 1,0 60,0 a30,30 0 1,0 -60,0 Z M35,50 a15,15 0 1,1 30,0 a15,15 0 1,1 -30,0 Z" fill="#000"/>
  <!-- quadrado com furo e ilha (profundidade 2) -->
  <path d="M110 21 H180 V79 H110 Z M120 31 H170 V69 H120 Z M135 43 H155 V57 H135 Z" fill="#000" fill-rule="evenodd"/>
  <circle cx="95" cy="88" r="6" fill="#000"/>
  <rect x="92" y="8" width="16" height="10" rx="3" fill="#000"/>
</svg>`;

const { contours, warnings } = parseSVG(svg);
console.log('contornos:', contours.length, 'avisos:', warnings);
const nodes = nestTree(contours);
console.log('nós por profundidade:', nodes.reduce((a, n) => (a[n.depth] = (a[n.depth] || 0) + 1, a), {}));

function analyze(part) {
  const v = part.v;
  const key = (i) => `${v[i].toFixed(5)}|${v[i + 1].toFixed(5)}|${v[i + 2].toFixed(5)}`;
  const dir = new Map();
  let vol = 0, degenerate = 0, nan = 0;
  for (let i = 0; i < v.length; i += 9) {
    const a = [v[i], v[i + 1], v[i + 2]], b = [v[i + 3], v[i + 4], v[i + 5]], c = [v[i + 6], v[i + 7], v[i + 8]];
    if ([...a, ...b, ...c].some((n) => !isFinite(n))) { nan++; continue; }
    vol += (a[0] * (b[1] * c[2] - c[1] * b[2]) - a[1] * (b[0] * c[2] - c[0] * b[2]) + a[2] * (b[0] * c[1] - c[0] * b[1])) / 6;
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const wx = c[0] - a[0], wy = c[1] - a[1], wz = c[2] - a[2];
    const cr = Math.hypot(uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx) / 2;
    if (cr < 1e-9) degenerate++;
    const ks = [key(i), key(i + 3), key(i + 6)];
    for (let e = 0; e < 3; e++) {
      const k = ks[e] + '>' + ks[(e + 1) % 3];
      dir.set(k, (dir.get(k) || 0) + 1);
    }
  }
  let unmatched = 0, dup = 0;
  for (const [k, n] of dir) {
    if (n > 1) dup++;
    const [a, b] = k.split('>');
    if (!dir.has(b + '>' + a)) unmatched++;
  }
  return { tris: part.count, vol: vol.toFixed(2), degenerate, nan, unmatched, dup };
}

for (const mode of ['hinge', 'magnets']) {
  console.log(`\n=== modo ${mode} ===`);
  const r = buildStamp(nodes, { ...DEFAULTS, mode, pin: mode === 'hinge', preset: 'cartao', relief: 1.2, clearance: 0.32 });
  for (const p of r.parts) console.log(p.name.padEnd(10), JSON.stringify(analyze(p)));
  console.log('bbox', Object.entries(r.bbox).map(([k, x]) => `${k}=${x.toFixed(2)}`).join(' '));
  console.log('avisos', r.warnings);
  const stl = toSTL(r.parts);
  const mf = to3MF(r.parts);
  fs.writeFileSync(`out-${mode}.stl`, stl);
  fs.writeFileSync(`out-${mode}.3mf`, mf);
  console.log('stl', (stl.length / 1024).toFixed(1) + 'kB', '3mf', (mf.length / 1024).toFixed(1) + 'kB');
}
