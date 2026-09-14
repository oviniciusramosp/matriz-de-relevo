/* geom.js — utilidades de polígonos 2D (mm). Sem dependências. */

export function area(pts) {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    a += (pts[j].x - pts[i].x) * (pts[j].y + pts[i].y);
  }
  return a / 2; // > 0 = sentido horário em Y-para-cima; usamos ccw() abaixo
}
export function signedArea(pts) {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    a += pts[j].x * pts[i].y - pts[i].x * pts[j].y;
  }
  return a / 2; // > 0 = anti-horário
}
export function ensureCCW(pts) { return signedArea(pts) < 0 ? pts.slice().reverse() : pts; }
export function ensureCW(pts) { return signedArea(pts) > 0 ? pts.slice().reverse() : pts; }

export function bbox(list) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const pts of list) for (const p of pts) {
    if (p.x < x0) x0 = p.x; if (p.y < y0) y0 = p.y;
    if (p.x > x1) x1 = p.x; if (p.y > y1) y1 = p.y;
  }
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
}

export function pointInPolygon(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Ponto seguramente dentro do polígono (média das duas primeiras interseções de um raio). */
export function interiorPoint(poly) {
  const bb = bbox([poly]);
  for (const frac of [0.5, 0.37, 0.63, 0.21, 0.79]) {
    const y = bb.y0 + bb.h * frac;
    const xs = [];
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i], b = poly[j];
      if ((a.y > y) !== (b.y > y)) xs.push(a.x + ((y - a.y) * (b.x - a.x)) / (b.y - a.y));
    }
    xs.sort((m, n) => m - n);
    if (xs.length >= 2 && xs[1] - xs[0] > 1e-9) return { x: (xs[0] + xs[1]) / 2, y };
  }
  return { x: bb.cx, y: bb.cy };
}

/** Remove pontos repetidos, o ponto final duplicado e vértices colineares. */
export function clean(pts, eps = 1e-7) {
  const out = [];
  for (const p of pts) {
    const q = out[out.length - 1];
    if (!q || Math.abs(q.x - p.x) > eps || Math.abs(q.y - p.y) > eps) out.push({ x: p.x, y: p.y });
  }
  while (out.length > 1) {
    const a = out[0], b = out[out.length - 1];
    if (Math.abs(a.x - b.x) < eps && Math.abs(a.y - b.y) < eps) out.pop(); else break;
  }
  // vértices exatamente colineares confundem o triangulador (orelhas de área zero)
  if (out.length > 3) {
    const keep = [];
    for (let i = 0; i < out.length; i++) {
      const a = out[(i - 1 + out.length) % out.length], p = out[i], b = out[(i + 1) % out.length];
      const cr = (p.x - a.x) * (b.y - a.y) - (p.y - a.y) * (b.x - a.x);
      if (Math.abs(cr) > 1e-9) keep.push(p);
    }
    if (keep.length >= 3) return keep;
  }
  return out;
}

/** Ramer–Douglas–Peucker. */
export function simplify(pts, tol) {
  if (pts.length < 4 || tol <= 0) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [i0, i1] = stack.pop();
    const a = pts[i0], b = pts[i1];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1e-12;
    let best = -1, bestD = tol;
    for (let i = i0 + 1; i < i1; i++) {
      const d = Math.abs((pts[i].x - a.x) * dy - (pts[i].y - a.y) * dx) / len;
      if (d > bestD) { bestD = d; best = i; }
    }
    if (best > 0) { keep[best] = 1; stack.push([i0, best], [best, i1]); }
  }
  const out = [];
  for (let i = 0; i < pts.length; i++) if (keep[i]) out.push(pts[i]);
  return out.length >= 3 ? out : pts;
}

/** Deslocamento por bissetriz (positivo = para fora, se o polígono estiver CCW). */
export function offsetPolygon(pts, d, miter = 2.5) {
  if (!d) return pts.slice();
  const n = pts.length, out = [];
  for (let i = 0; i < n; i++) {
    const p = pts[i], a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n];
    let n1x = p.y - a.y, n1y = a.x - p.x;
    let n2x = b.y - p.y, n2y = p.x - b.x;
    const l1 = Math.hypot(n1x, n1y) || 1e-12, l2 = Math.hypot(n2x, n2y) || 1e-12;
    n1x /= l1; n1y /= l1; n2x /= l2; n2y /= l2;
    let bx = n1x + n2x, by = n1y + n2y;
    const bl = Math.hypot(bx, by);
    if (bl < 1e-9) { out.push({ x: p.x + n1x * d, y: p.y + n1y * d }); continue; }
    bx /= bl; by /= bl;
    let scale = 1 / Math.max(0.2, bx * n1x + by * n1y);
    if (scale > miter) scale = miter;
    out.push({ x: p.x + bx * d * scale, y: p.y + by * d * scale });
  }
  return out;
}

/** Retângulo com raio por canto: r = [supDir, supEsq, infEsq, infDir] ou número. */
export function roundedRect(x0, y0, w, h, r, seg = 8) {
  const rr = Array.isArray(r) ? r.slice() : [r, r, r, r];
  const lim = Math.min(w, h) / 2;
  for (let i = 0; i < 4; i++) rr[i] = Math.max(0, Math.min(rr[i], lim));
  const x1 = x0 + w, y1 = y0 + h;
  const out = [];
  const arc = (cx, cy, rad, a0, a1) => {
    if (rad <= 0) { out.push({ x: cx, y: cy }); return; }
    for (let i = 0; i <= seg; i++) {
      const a = a0 + (a1 - a0) * (i / seg);
      out.push({ x: cx + rad * Math.cos(a), y: cy + rad * Math.sin(a) });
    }
  };
  arc(x1 - rr[0], y1 - rr[0], rr[0], 0, Math.PI / 2);            // sup dir
  arc(x0 + rr[1], y1 - rr[1], rr[1], Math.PI / 2, Math.PI);       // sup esq
  arc(x0 + rr[2], y0 + rr[2], rr[2], Math.PI, 1.5 * Math.PI);     // inf esq
  arc(x1 - rr[3], y0 + rr[3], rr[3], 1.5 * Math.PI, 2 * Math.PI); // inf dir
  return clean(out);
}

export function circle(cx, cy, r, seg = 48) {
  const out = [];
  for (let i = 0; i < seg; i++) {
    const a = (2 * Math.PI * i) / seg;
    out.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  return out;
}

/** Agrupa contornos em {outer, holes[]} por profundidade de aninhamento (paridade). */
export function nest(contours) {
  const items = contours
    .map((pts) => clean(pts))
    .filter((pts) => pts.length >= 3 && Math.abs(signedArea(pts)) > 1e-9)
    .map((pts) => ({ pts, p: interiorPoint(pts), a: Math.abs(signedArea(pts)) }));
  for (const it of items) {
    it.parents = items.filter((o) => o !== it && o.a > it.a && pointInPolygon(it.p, o.pts));
    it.depth = it.parents.length;
  }
  const shapes = [];
  for (const it of items) {
    if (it.depth % 2 === 0) shapes.push({ outer: ensureCCW(it.pts), holes: [], _src: it });
  }
  for (const it of items) {
    if (it.depth % 2 === 1) {
      // pai = menor contorno que o contém e é externo
      let best = null;
      for (const s of shapes) {
        if (pointInPolygon(it.p, s.outer) && (!best || s._src.a < best._src.a)) best = s;
      }
      if (best) best.holes.push(ensureCW(it.pts));
    }
  }
  return shapes.map((s) => ({ outer: s.outer, holes: s.holes }));
}

/* ---------- transformações em lote ---------- */
export function mapShapes(shapes, fn) {
  return shapes.map((s) => ({ outer: s.outer.map(fn), holes: s.holes.map((h) => h.map(fn)) }));
}
export function fixWinding(shapes) {
  return shapes.map((s) => ({ outer: ensureCCW(s.outer), holes: s.holes.map(ensureCW) }));
}

/** Normaliza: centraliza, aplica rotação (graus) e escala para caber em (w,h) mm. */
export function fitShapes(shapes, maxW, maxH, rotDeg = 0, scale = 1, mirrorX = false) {
  let sh = shapes;
  if (rotDeg) {
    const a = (rotDeg * Math.PI) / 180, co = Math.cos(a), si = Math.sin(a);
    sh = mapShapes(sh, (p) => ({ x: p.x * co - p.y * si, y: p.x * si + p.y * co }));
  }
  const bb = bbox(sh.flatMap((s) => [s.outer, ...s.holes]));
  if (!isFinite(bb.w) || bb.w <= 0 || bb.h <= 0) return { shapes: sh, k: 1, bb };
  const k = Math.min(maxW / bb.w, maxH / bb.h) * scale;
  sh = mapShapes(sh, (p) => ({ x: (p.x - bb.cx) * k * (mirrorX ? -1 : 1), y: (p.y - bb.cy) * k }));
  if (mirrorX) sh = fixWinding(sh.map((s) => ({ outer: s.outer.slice().reverse(), holes: s.holes.map((h) => h.slice().reverse()) })));
  return { shapes: sh, k, bb };
}

/* ---------- marching squares (ferramenta de texto) ---------- */
/** Extrai contornos suaves de um campo alpha (Uint8/Float array, w*h) no limiar thr. */
export function traceField(data, w, h, thr = 128) {
  const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : data[y * w + x]);
  const segs = [];
  const ip = (v0, v1) => {
    const d = v1 - v0;
    return Math.abs(d) < 1e-9 ? 0.5 : (thr - v0) / d;
  };
  for (let y = -1; y < h; y++) {
    for (let x = -1; x < w; x++) {
      const tl = at(x, y), tr = at(x + 1, y), br = at(x + 1, y + 1), bl = at(x, y + 1);
      let c = 0;
      if (tl >= thr) c |= 8;
      if (tr >= thr) c |= 4;
      if (br >= thr) c |= 2;
      if (bl >= thr) c |= 1;
      if (c === 0 || c === 15) continue;
      const T = { x: x + ip(tl, tr), y: y };
      const R = { x: x + 1, y: y + ip(tr, br) };
      const B = { x: x + ip(bl, br), y: y + 1 };
      const L = { x: x, y: y + ip(tl, bl) };
      const add = (a, b) => segs.push([a, b]);
      switch (c) {
        case 1: add(L, B); break;
        case 2: add(B, R); break;
        case 3: add(L, R); break;
        case 4: add(T, R); break;
        case 5: { const avg = (tl + tr + br + bl) / 4; if (avg >= thr) { add(L, T); add(B, R); } else { add(L, B); add(T, R); } break; }
        case 6: add(T, B); break;
        case 7: add(L, T); break;
        case 8: add(T, L); break;
        case 9: add(T, B); break;
        case 10: { const avg = (tl + tr + br + bl) / 4; if (avg >= thr) { add(T, R); add(B, L); } else { add(T, L); add(B, R); } break; }
        case 11: add(T, R); break;
        case 12: add(R, L); break;
        case 13: add(R, B); break;
        case 14: add(B, L); break;
      }
    }
  }
  // costura dos segmentos em contornos fechados
  const key = (p) => Math.round(p.x * 1000) + ':' + Math.round(p.y * 1000);
  const map = new Map();
  segs.forEach((s, i) => {
    const k = key(s[0]);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(i);
  });
  const used = new Uint8Array(segs.length);
  const contours = [];
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    const poly = [segs[i][0]];
    let cur = i;
    used[i] = 1;
    for (let guard = 0; guard < segs.length + 2; guard++) {
      poly.push(segs[cur][1]);
      const cand = map.get(key(segs[cur][1])) || [];
      let nxt = -1;
      for (const c of cand) if (!used[c]) { nxt = c; break; }
      if (nxt < 0) break;
      used[nxt] = 1;
      cur = nxt;
    }
    if (poly.length > 3) contours.push(clean(poly));
  }
  return contours;
}

/* ---------- árvore de aninhamento (representação canônica das "tintas") ---------- */
/** contornos -> lista plana de nós {pts, depth, children[]} (depth par = tinta, ímpar = vazio) */
export function nestTree(contours) {
  const items = contours
    .map((c) => clean(Array.isArray(c) ? c : c.pts))
    .filter((pts) => pts.length >= 3 && Math.abs(signedArea(pts)) > 1e-9)
    .map((pts) => ({ pts, p: interiorPoint(pts), a: Math.abs(signedArea(pts)), children: [] }));
  for (const it of items) {
    const parents = items.filter((o) => o !== it && o.a > it.a && pointInPolygon(it.p, o.pts));
    it.depth = parents.length;
    it.parent = parents.sort((x, y) => x.a - y.a)[0] || null;
  }
  for (const it of items) if (it.parent) it.parent.children.push(it);
  for (const it of items) { delete it.p; delete it.a; delete it.parent; }
  return items;
}

export function mapTree(nodes, fn) {
  const copy = new Map();
  for (const n of nodes) copy.set(n, { pts: n.pts.map(fn), depth: n.depth, children: [] });
  for (const n of nodes) for (const c of n.children) copy.get(n).children.push(copy.get(c));
  return nodes.map((n) => copy.get(n));
}

export function treeBBox(nodes) {
  return bbox(nodes.map((n) => n.pts));
}

/** Normaliza a árvore: rotaciona, espelha em X, escala para caber e centraliza. */
export function fitTree(nodes, maxW, maxH, { rotDeg = 0, scale = 1, mirrorX = false } = {}) {
  let ns = nodes;
  if (rotDeg) {
    const a = (rotDeg * Math.PI) / 180, co = Math.cos(a), si = Math.sin(a);
    ns = mapTree(ns, (p) => ({ x: p.x * co - p.y * si, y: p.x * si + p.y * co }));
  }
  const bb = treeBBox(ns);
  if (!isFinite(bb.w) || bb.w <= 0 || bb.h <= 0) return { nodes: ns, k: 1, bb };
  const k = Math.min(maxW / bb.w, maxH / bb.h) * scale;
  ns = mapTree(ns, (p) => ({ x: (p.x - bb.cx) * k * (mirrorX ? -1 : 1), y: (p.y - bb.cy) * k }));
  return { nodes: ns, k, bb: treeBBox(ns) };
}

/** Dilata a "tinta" em d mm (anéis pares para fora, ímpares para dentro da área vazia). */
export function dilateTree(nodes, d, offsetFn) {
  if (!d) return nodes;
  const out = mapTree(nodes, (p) => ({ x: p.x, y: p.y }));
  for (const n of out) {
    const even = n.depth % 2 === 0;
    const ring = even ? ensureCCW(n.pts) : ensureCW(n.pts);
    n.pts = offsetFn(ring, d);
  }
  return out;
}

/** Remove nós cujo anel ficou degenerado (detalhes menores que a folga). */
export function pruneTree(nodes, minArea) {
  const dead = new Set();
  const kill = (n) => { dead.add(n); (n.children || []).forEach(kill); };
  for (const n of nodes) if (!dead.has(n) && Math.abs(signedArea(n.pts)) < minArea) kill(n);
  const alive = nodes.filter((n) => !dead.has(n));
  for (const n of alive) n.children = n.children.filter((c) => !dead.has(c));
  return alive;
}
