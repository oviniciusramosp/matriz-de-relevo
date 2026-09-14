/* mesh.js — malhas por sopa de triângulos + extrusão de regiões planas com furos.
   Triangulador injetado (THREE.ShapeUtils no browser, three/npm no Node). */
import { clean, signedArea, ensureCCW, ensureCW, offsetPolygon } from './geom.js';

class P { constructor(x, y) { this.x = x; this.y = y; } equals(o) { return this.x === o.x && this.y === o.y; } }

let TRI = null;
export function setTriangulator(fn) { TRI = fn; }

/** contour CCW, holes CW -> lista de triângulos [{x,y},{x,y},{x,y}] */
export function triangulate(contour, holes = []) {
  if (!TRI) throw new Error('triangulador não configurado');
  const c = clean(contour);
  const hs = holes.map((h) => clean(h)).filter((h) => h.length >= 3);
  if (c.length < 3) return [];
  const faces = TRI(c.map((p) => new P(p.x, p.y)), hs.map((h) => h.map((p) => new P(p.x, p.y))));
  const all = c.concat(...hs);
  const out = [];
  for (const f of faces) {
    const a = all[f[0]], b = all[f[1]], d = all[f[2]];
    if (a && b && d) out.push([a, b, d]);
  }
  return out;
}

export class Mesh {
  constructor(name = 'part', color = '#b9c2cc') {
    this.name = name; this.color = color; this.v = [];
  }
  get count() { return this.v.length / 9; }
  tri(a, b, c) { this.v.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z); }
  /** quad a->b->c->d (normal pela regra da mão direita) */
  quad(a, b, c, d) { this.tri(a, b, c); this.tri(a, c, d); }
  /** tampa plana em z, com normal +Z (up=true) ou -Z */
  cap(tris, z, up) {
    for (const t of tris) {
      const s = (t[1].x - t[0].x) * (t[2].y - t[0].y) - (t[1].y - t[0].y) * (t[2].x - t[0].x);
      const ccw = s > 0;
      const [p, q, r] = ccw === up ? t : [t[0], t[2], t[1]];
      this.tri({ x: p.x, y: p.y, z }, { x: q.x, y: q.y, z }, { x: r.x, y: r.y, z });
    }
  }
  /** parede entre o anel em zA e o anel (possivelmente deslocado) em zB */
  wall(ringA, zA, ringB, zB) {
    const n = ringA.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const a0 = { x: ringA[i].x, y: ringA[i].y, z: zA };
      const b0 = { x: ringA[j].x, y: ringA[j].y, z: zA };
      const b1 = { x: ringB[j].x, y: ringB[j].y, z: zB };
      const a1 = { x: ringB[i].x, y: ringB[i].y, z: zB };
      this.quad(a0, b0, b1, a1);
    }
  }
  merge(other) { for (let i = 0; i < other.v.length; i++) this.v.push(other.v[i]); return this; }
  transform(fn) {
    for (let i = 0; i < this.v.length; i += 3) {
      const p = fn({ x: this.v[i], y: this.v[i + 1], z: this.v[i + 2] });
      this.v[i] = p.x; this.v[i + 1] = p.y; this.v[i + 2] = p.z;
    }
    return this;
  }
  translate(dx, dy, dz) { return this.transform((p) => ({ x: p.x + dx, y: p.y + dy, z: p.z + dz })); }
  bbox() {
    const b = { x0: Infinity, y0: Infinity, z0: Infinity, x1: -Infinity, y1: -Infinity, z1: -Infinity };
    for (let i = 0; i < this.v.length; i += 3) {
      b.x0 = Math.min(b.x0, this.v[i]); b.x1 = Math.max(b.x1, this.v[i]);
      b.y0 = Math.min(b.y0, this.v[i + 1]); b.y1 = Math.max(b.y1, this.v[i + 1]);
      b.z0 = Math.min(b.z0, this.v[i + 2]); b.z1 = Math.max(b.z1, this.v[i + 2]);
    }
    return b;
  }
  toFloat32() { return new Float32Array(this.v); }
}

/** Fecha buracos deixados pelo triangulador (orelhas degeneradas, SVGs patológicos).
    Devolve o número de triângulos de remendo adicionados. */
export function sealBoundaries(mesh) {
  const v = mesh.v;
  const key = (i) => `${v[i].toFixed(5)}|${v[i + 1].toFixed(5)}|${v[i + 2].toFixed(5)}`;
  const count = new Map();
  for (let i = 0; i < v.length; i += 9) {
    const k = [key(i), key(i + 3), key(i + 6)];
    for (let e = 0; e < 3; e++) {
      const s = k[e] + '>' + k[(e + 1) % 3];
      count.set(s, (count.get(s) || 0) + 1);
    }
  }
  const open = [];
  for (const [k, n] of count) {
    const [a, b] = k.split('>');
    const back = count.get(b + '>' + a) || 0;
    for (let i = 0; i < n - back; i++) open.push([a, b]);
  }
  if (!open.length) return 0;
  const pt = (k) => { const [x, y, z] = k.split('|').map(Number); return { x, y, z }; };
  const from = new Map();
  open.forEach((e, i) => {
    if (!from.has(e[0])) from.set(e[0], []);
    from.get(e[0]).push(i);
  });
  const used = new Uint8Array(open.length);
  let added = 0;
  for (let i = 0; i < open.length; i++) {
    if (used[i]) continue;
    const loop = [open[i][0]];
    let cur = i;
    used[i] = 1;
    for (let g = 0; g < open.length + 2; g++) {
      loop.push(open[cur][1]);
      const cands = from.get(open[cur][1]) || [];
      let nxt = -1;
      for (const c of cands) if (!used[c]) { nxt = c; break; }
      if (nxt < 0) break;
      if (open[nxt][1] === loop[0] && loop.length > 1) { used[nxt] = 1; cur = nxt; loop.push(open[nxt][1]); break; }
      used[nxt] = 1;
      cur = nxt;
    }
    const ring = loop.filter((k, j) => j === 0 || k !== loop[j - 1]);
    if (ring[ring.length - 1] === ring[0]) ring.pop();
    if (ring.length < 3) continue;
    // o remendo precisa percorrer o laço ao contrário das arestas órfãs
    for (let j = 1; j + 1 < ring.length; j++) {
      mesh.tri(pt(ring[0]), pt(ring[j + 1]), pt(ring[j]));
      added++;
    }
  }
  return added;
}

/** Prisma fechado simples: contorno + furos, de z0 a z1, com inset opcional no topo. */
export function prism(mesh, shape, z0, z1, inset = 0) {
  const outer = ensureCCW(clean(shape.outer));
  const holes = (shape.holes || []).map((h) => ensureCW(clean(h))).filter((h) => h.length >= 3);
  const faces = triangulate(outer, holes);
  mesh.cap(faces, z0, false);
  const outerT = inset ? safeOffset(outer, -inset) : outer;
  const holesT = holes.map((h) => (inset ? safeOffset(h, inset) : h));
  const facesT = inset ? triangulate(outerT, holesT) : faces;
  mesh.cap(facesT, z1, true);
  mesh.wall(outer, z0, outerT, z1);
  holes.forEach((h, i) => mesh.wall(h, z0, holesT[i], z1));
  return mesh;
}

/** Offset que devolve o anel original se a operação degenerar. */
export function safeOffset(ring, d) {
  if (!d) return ring;
  const before = signedArea(ring);
  const out = offsetPolygon(ring, d);
  const after = signedArea(out);
  if (!isFinite(after) || Math.sign(after) !== Math.sign(before) || Math.abs(after) < Math.abs(before) * 0.15) return ring;
  return out;
}

/**
 * Placa manifold única: base sólida + regiões em relevo (positivo) ou cavidade (negativo),
 * com aninhamento arbitrário (ilha dentro de furo dentro de forma).
 *
 * @param {object} o
 * @param {Array}  o.outline   contorno da placa (mm)
 * @param {number} o.thickness espessura
 * @param {Array}  o.nodes     árvore de regiões: {pts, depth, children[]}
 * @param {number} o.relief    + = macho (sobe), - = fêmea (afunda)
 * @param {number} o.draft     inset no topo do relevo (saída de ângulo)
 * @param {Array}  o.pockets   [{ring, depth}] bolsos cegos na face inferior
 */
export function buildPlate(o) {
  const mesh = new Mesh(o.name || 'plate', o.color);
  const t = o.thickness;
  const zTop = t + (o.relief || 0);
  const outline = ensureCCW(clean(o.outline));
  const pockets = (o.pockets || []).map((p) => ({ ring: ensureCW(clean(p.ring)), depth: p.depth }));

  // face inferior (com bocas dos bolsos)
  mesh.cap(triangulate(outline, pockets.map((p) => p.ring)), 0, false);
  for (const p of pockets) {
    mesh.wall(p.ring, 0, p.ring, p.depth);
    mesh.cap(triangulate(ensureCCW(p.ring)), p.depth, false);
  }
  // parede externa
  mesh.wall(outline, 0, outline, t);

  // superfícies superiores
  const nodes = o.nodes || [];
  const draft = o.draft || 0;
  const roots = nodes.filter((n) => n.depth === 0);
  mesh.cap(triangulate(outline, roots.map((n) => ensureCW(n.pts))), t, true);

  const inkRanges = [];
  const visit = (n) => {
    const even = n.depth % 2 === 0;
    const ring = even ? ensureCCW(clean(n.pts)) : ensureCW(clean(n.pts));
    const zFace = even ? zTop : t;
    const kids = n.children || [];
    // anel do topo do relevo (com saída de ângulo) só nas faces deslocadas
    const ringTop = even && draft ? safeOffset(ring, -draft) : ring;
    if (even) {
      const kidRings = kids.map((k) => ensureCW(clean(k.pts)));
      const kidRingsTop = draft ? kidRings.map((r) => safeOffset(r, draft)) : kidRings;
      const mark = mesh.count;
      mesh.cap(triangulate(ringTop, kidRingsTop), zFace, true);
      mesh.wall(ring, t, ringTop, zTop);
      kids.forEach((k, i) => mesh.wall(kidRings[i], t, kidRingsTop[i], zTop));
      inkRanges.push([mark, mesh.count]);   // só as faces que realmente sobem/descem
      // as paredes dos filhos já foram emitidas acima; desce para os netos
      kids.forEach((k) => (k.children || []).forEach(visit));
      kids.forEach((k) => {
        const kr = ensureCCW(clean(k.pts));
        mesh.cap(triangulate(kr, (k.children || []).map((g) => ensureCW(clean(g.pts)))), t, true);
      });
    }
  };
  roots.forEach(visit);
  mesh.ink = inkRanges.sort((a, b) => a[0] - b[0]);
  mesh.patched = sealBoundaries(mesh);
  return mesh;
}
