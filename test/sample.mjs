import { DOMParser } from '@xmldom/xmldom';
import * as THREE from 'three';
import fs from 'node:fs';
import { parseSVG } from '../svgpoly.js';
import { nestTree } from '../geom.js';
import { setTriangulator } from '../mesh.js';
import { buildStamp, DEFAULTS } from '../stamp.js';
import { toSTL } from '../exporters.js';
globalThis.DOMParser = DOMParser;
setTriangulator((c,h)=>THREE.ShapeUtils.triangulateShape(c,h));
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">
<path d="M60 3 A57 57 0 1 0 60.01 3 Z M60 14 A46 46 0 1 1 59.99 14 Z"/>
<path d="M30 86 L52 46 L64 68 L72 55 L90 86 Z"/>
<circle cx="80" cy="36" r="9"/></svg>`;
const nodes = nestTree(parseSVG(svg).contours);
const r = buildStamp(nodes, { ...DEFAULTS, mode:'hinge', preset:'papel' });
fs.writeFileSync('exemplo.stl', toSTL(r.parts));
console.log('partes:', r.parts.map(p=>p.name+':'+p.count).join(' '), '| bbox',
  Object.entries(r.bbox).map(([k,v])=>k+'='+v.toFixed(2)).join(' '));
function analyze(part){const v=part.v;const key=i=>`${v[i].toFixed(5)}|${v[i+1].toFixed(5)}|${v[i+2].toFixed(5)}`;const dir=new Map();let deg=0;
for(let i=0;i<v.length;i+=9){const a=[v[i],v[i+1],v[i+2]],b=[v[i+3],v[i+4],v[i+5]],c=[v[i+6],v[i+7],v[i+8]];
const ux=b[0]-a[0],uy=b[1]-a[1],uz=b[2]-a[2],wx=c[0]-a[0],wy=c[1]-a[1],wz=c[2]-a[2];
if(Math.hypot(uy*wz-uz*wy,uz*wx-ux*wz,ux*wy-uy*wx)/2<1e-9)deg++;
const ks=[key(i),key(i+3),key(i+6)];for(let e=0;e<3;e++){const k=ks[e]+'>'+ks[(e+1)%3];dir.set(k,(dir.get(k)||0)+1);}}
let un=0;for(const k of dir.keys()){const[a,b]=k.split('>');if(!dir.has(b+'>'+a))un++;}
return {tris:part.count,deg,un,patched:part.patched||0};}
for(const p of r.parts) console.log(p.name, JSON.stringify(analyze(p)));
