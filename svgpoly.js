/* svgpoly.js — SVG -> polígonos planos (contornos externos + furos)
   Sem dependências. Funciona no browser e no Node (com um DOMParser global).
   Saída em milímetros já com Y invertido (SVG tem Y para baixo, o modelo 3D tem Y para cima). */

/* ---------- matrizes afins 2D ---------- */
export const IDENT = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
export function matMul(m, n) {
  return {
    a: m.a * n.a + m.c * n.b,
    b: m.b * n.a + m.d * n.b,
    c: m.a * n.c + m.c * n.d,
    d: m.b * n.c + m.d * n.d,
    e: m.a * n.e + m.c * n.f + m.e,
    f: m.b * n.e + m.d * n.f + m.f,
  };
}
export function apply(m, p) {
  return { x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f };
}
function matScaleOf(m) {
  // fator de escala médio, usado para converter tolerância de flatten
  return Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) || 1;
}

export function parseTransform(str) {
  let m = IDENT;
  if (!str) return m;
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
  let r;
  while ((r = re.exec(str))) {
    const n = r[2].split(/[\s,]+/).filter((s) => s.length).map(Number);
    let t = IDENT;
    switch (r[1]) {
      case 'matrix':
        t = { a: n[0], b: n[1], c: n[2], d: n[3], e: n[4], f: n[5] };
        break;
      case 'translate':
        t = { a: 1, b: 0, c: 0, d: 1, e: n[0] || 0, f: n[1] || 0 };
        break;
      case 'scale':
        t = { a: n[0], b: 0, c: 0, d: n.length > 1 ? n[1] : n[0], e: 0, f: 0 };
        break;
      case 'rotate': {
        const ang = ((n[0] || 0) * Math.PI) / 180;
        const co = Math.cos(ang), si = Math.sin(ang);
        const rot = { a: co, b: si, c: -si, d: co, e: 0, f: 0 };
        if (n.length >= 3) {
          const tr = { a: 1, b: 0, c: 0, d: 1, e: n[1], f: n[2] };
          const back = { a: 1, b: 0, c: 0, d: 1, e: -n[1], f: -n[2] };
          t = matMul(matMul(tr, rot), back);
        } else t = rot;
        break;
      }
      case 'skewX':
        t = { a: 1, b: 0, c: Math.tan(((n[0] || 0) * Math.PI) / 180), d: 1, e: 0, f: 0 };
        break;
      case 'skewY':
        t = { a: 1, b: Math.tan(((n[0] || 0) * Math.PI) / 180), c: 0, d: 1, e: 0, f: 0 };
        break;
    }
    m = matMul(m, t);
  }
  return m;
}

/* ---------- leitor de "d" ---------- */
class Reader {
  constructor(d) { this.d = d; this.i = 0; }
  ws() { while (this.i < this.d.length && /[\s,]/.test(this.d[this.i])) this.i++; }
  done() { this.ws(); return this.i >= this.d.length; }
  peekCmd() { this.ws(); const c = this.d[this.i]; return /[a-zA-Z]/.test(c) ? c : null; }
  cmd() { const c = this.peekCmd(); if (c) this.i++; return c; }
  num() {
    this.ws();
    const m = /^[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/.exec(this.d.slice(this.i));
    if (!m) throw new Error('path: número esperado em ' + this.i);
    this.i += m[0].length;
    return parseFloat(m[0]);
  }
  flag() {
    this.ws();
    const c = this.d[this.i];
    if (c === '0' || c === '1') { this.i++; return c === '1' ? 1 : 0; }
    return this.num() ? 1 : 0;
  }
}

/* ---------- achatamento de curvas ---------- */
function cubicSegments(p0, p1, p2, p3, tol) {
  const dx1 = p0.x - 2 * p1.x + p2.x, dy1 = p0.y - 2 * p1.y + p2.y;
  const dx2 = p1.x - 2 * p2.x + p3.x, dy2 = p1.y - 2 * p2.y + p3.y;
  const dev = Math.max(Math.hypot(dx1, dy1), Math.hypot(dx2, dy2)) * 0.75;
  return Math.max(2, Math.min(160, Math.ceil(Math.sqrt(dev / Math.max(tol, 1e-9)) * 2)));
}
function emitCubic(out, p0, p1, p2, p3, tol) {
  const n = cubicSegments(p0, p1, p2, p3, tol);
  for (let i = 1; i <= n; i++) {
    const t = i / n, u = 1 - t;
    out.push({
      x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
      y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
    });
  }
}
function emitArc(out, p0, rx, ry, rot, largeArc, sweep, p1, tol) {
  if (rx === 0 || ry === 0) { out.push(p1); return; }
  rx = Math.abs(rx); ry = Math.abs(ry);
  const phi = (rot * Math.PI) / 180, cp = Math.cos(phi), sp = Math.sin(phi);
  const dx2 = (p0.x - p1.x) / 2, dy2 = (p0.y - p1.y) / 2;
  const x1 = cp * dx2 + sp * dy2, y1 = -sp * dx2 + cp * dy2;
  let lam = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (lam > 1) { const s = Math.sqrt(lam); rx *= s; ry *= s; }
  const sign = largeArc !== sweep ? 1 : -1;
  let num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  const den = rx * rx * y1 * y1 + ry * ry * x1 * x1;
  num = Math.max(0, num);
  const co = sign * Math.sqrt(den === 0 ? 0 : num / den);
  const cx1 = (co * rx * y1) / ry, cy1 = (-co * ry * x1) / rx;
  const cx = cp * cx1 - sp * cy1 + (p0.x + p1.x) / 2;
  const cy = sp * cx1 + cp * cy1 + (p0.y + p1.y) / 2;
  const ang = (ux, uy, vx, vy) => {
    const d = (ux * vx + uy * vy) / (Math.hypot(ux, uy) * Math.hypot(vx, vy));
    const a = Math.acos(Math.min(1, Math.max(-1, d)));
    return ux * vy - uy * vx < 0 ? -a : a;
  };
  const th0 = ang(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry);
  let dth = ang((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry);
  if (!sweep && dth > 0) dth -= 2 * Math.PI;
  if (sweep && dth < 0) dth += 2 * Math.PI;
  const rmax = Math.max(rx, ry);
  const step = 2 * Math.acos(Math.max(-1, Math.min(1, 1 - tol / rmax)));
  const n = Math.max(2, Math.min(360, Math.ceil(Math.abs(dth) / Math.max(step, 1e-4))));
  for (let i = 1; i <= n; i++) {
    const th = th0 + (dth * i) / n;
    const ex = rx * Math.cos(th), ey = ry * Math.sin(th);
    out.push({ x: cp * ex - sp * ey + cx, y: sp * ex + cp * ey + cy });
  }
}

/** Converte o atributo `d` em uma lista de sub-caminhos (arrays de pontos). */
export function pathToSubpaths(d, tol = 0.05) {
  const r = new Reader(d);
  const subs = [];
  let cur = null, start = { x: 0, y: 0 }, pt = { x: 0, y: 0 };
  let prevCtrl = null, prevQCtrl = null, cmd = null;
  const push = (p) => { cur.push(p); pt = p; };
  const openSub = (p) => { cur = [p]; subs.push(cur); start = p; pt = p; };
  while (!r.done()) {
    const c = r.peekCmd();
    if (c) { cmd = r.cmd(); } else if (!cmd) break;
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    const rx = rel ? pt.x : 0, ry = rel ? pt.y : 0;
    if (C === 'M') {
      const p = { x: r.num() + rx, y: r.num() + ry };
      openSub(p);
      cmd = rel ? 'l' : 'L';
      prevCtrl = prevQCtrl = null;
    } else if (C === 'L') {
      if (!cur) openSub({ ...pt });
      push({ x: r.num() + rx, y: r.num() + ry });
      prevCtrl = prevQCtrl = null;
    } else if (C === 'H') {
      push({ x: r.num() + rx, y: pt.y });
      prevCtrl = prevQCtrl = null;
    } else if (C === 'V') {
      push({ x: pt.x, y: r.num() + ry });
      prevCtrl = prevQCtrl = null;
    } else if (C === 'C' || C === 'S') {
      let c1;
      if (C === 'C') c1 = { x: r.num() + rx, y: r.num() + ry };
      else c1 = prevCtrl ? { x: 2 * pt.x - prevCtrl.x, y: 2 * pt.y - prevCtrl.y } : { ...pt };
      const c2 = { x: r.num() + rx, y: r.num() + ry };
      const p = { x: r.num() + rx, y: r.num() + ry };
      emitCubic(cur, pt, c1, c2, p, tol);
      pt = p; prevCtrl = c2; prevQCtrl = null;
    } else if (C === 'Q' || C === 'T') {
      let q;
      if (C === 'Q') q = { x: r.num() + rx, y: r.num() + ry };
      else q = prevQCtrl ? { x: 2 * pt.x - prevQCtrl.x, y: 2 * pt.y - prevQCtrl.y } : { ...pt };
      const p = { x: r.num() + rx, y: r.num() + ry };
      const c1 = { x: pt.x + (2 / 3) * (q.x - pt.x), y: pt.y + (2 / 3) * (q.y - pt.y) };
      const c2 = { x: p.x + (2 / 3) * (q.x - p.x), y: p.y + (2 / 3) * (q.y - p.y) };
      emitCubic(cur, pt, c1, c2, p, tol);
      pt = p; prevQCtrl = q; prevCtrl = null;
    } else if (C === 'A') {
      const arx = r.num(), ary = r.num(), rot = r.num();
      const la = r.flag(), sw = r.flag();
      const p = { x: r.num() + rx, y: r.num() + ry };
      emitArc(cur, pt, arx, ary, rot, la, sw, p, tol);
      pt = p; prevCtrl = prevQCtrl = null;
    } else if (C === 'Z') {
      if (cur && cur.length) { cur.closed = true; pt = { ...start }; }
      prevCtrl = prevQCtrl = null;
      cur = null;
      cmd = null;
      if (!r.done() && !r.peekCmd()) break; // dados soltos depois de Z: aborta
    } else {
      break;
    }
  }
  return subs.filter((s) => s.length > 1);
}

/* ---------- primitivas ---------- */
function rectPts(x, y, w, h, rx, ry, tol) {
  if (!rx && !ry) return [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
  rx = Math.min(rx || ry, w / 2); ry = Math.min(ry || rx, h / 2);
  const n = Math.max(4, Math.ceil(Math.PI / 2 / Math.acos(Math.max(-1, Math.min(1, 1 - tol / Math.max(rx, ry))))));
  const out = [];
  const corner = (cx, cy, a0) => {
    for (let i = 0; i <= n; i++) {
      const a = a0 + (Math.PI / 2) * (i / n);
      out.push({ x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) });
    }
  };
  corner(x + w - rx, y + ry, -Math.PI / 2);
  corner(x + w - rx, y + h - ry, 0);
  corner(x + rx, y + h - ry, Math.PI / 2);
  corner(x + rx, y + ry, Math.PI);
  return out;
}
function ellipsePts(cx, cy, rx, ry, tol) {
  const rmax = Math.max(rx, ry);
  const n = Math.max(12, Math.min(512, Math.ceil((2 * Math.PI) / (2 * Math.acos(Math.max(-1, Math.min(1, 1 - tol / rmax)))))));
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n;
    out.push({ x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) });
  }
  return out;
}

/* ---------- varredura do documento ---------- */
const num = (el, name, def = 0) => {
  const v = el.getAttribute(name);
  if (v == null || v === '') return def;
  const f = parseFloat(v);
  return isNaN(f) ? def : f;
};
function styleFill(el, inherited) {
  const st = el.getAttribute('style') || '';
  const m = /(?:^|;)\s*fill\s*:\s*([^;]+)/i.exec(st);
  if (m) return m[1].trim();
  const a = el.getAttribute('fill');
  return a != null && a !== '' ? a.trim() : inherited;
}
function styleRule(el, inherited) {
  const st = el.getAttribute('style') || '';
  const m = /(?:^|;)\s*fill-rule\s*:\s*([^;]+)/i.exec(st);
  if (m) return m[1].trim();
  const a = el.getAttribute('fill-rule') || el.getAttribute('clip-rule');
  return a ? a.trim() : inherited;
}

/**
 * @returns {{contours: Array<{pts:Array<{x,y}>, rule:string, group:number}>, warnings:string[]}}
 */
export function parseSVG(text, opts = {}) {
  if (typeof DOMParser === 'undefined') throw new Error('DOMParser indisponível');
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const root = doc.documentElement;
  if (!root || /parsererror/i.test(root.nodeName)) throw new Error('SVG inválido');

  const contours = [];
  const warnings = new Set();
  let group = 0;

  // tolerância de achatamento relativa ao tamanho do desenho
  let span = 100;
  const vb = (root.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
  if (vb.length === 4 && vb[2] > 0) span = Math.max(vb[2], vb[3]);
  else span = Math.max(num(root, 'width', 100), num(root, 'height', 100)) || 100;
  const tol = span / 4000;

  const walk = (el, m, fill, rule) => {
    if (el.nodeType !== 1) return;
    const tag = (el.nodeName || '').toLowerCase().replace(/^.*:/, '');
    const lm = matMul(m, parseTransform(el.getAttribute && el.getAttribute('transform')));
    const lf = styleFill(el, fill);
    const lr = styleRule(el, rule);
    if (el.getAttribute && (el.getAttribute('clip-path') || el.getAttribute('mask'))) {
      warnings.add('clip-path/mask ignorados — achate os recortes antes de exportar.');
    }
    const display = (el.getAttribute && (el.getAttribute('display') || '')) || '';
    if (display === 'none') return;

    let subs = null;
    if (tag === 'path') {
      const d = el.getAttribute('d');
      if (d) { try { subs = pathToSubpaths(d, tol / matScaleOf(lm)); } catch (e) { warnings.add('um path não pôde ser lido: ' + e.message); } }
    } else if (tag === 'rect') {
      subs = [rectPts(num(el, 'x'), num(el, 'y'), num(el, 'width'), num(el, 'height'), num(el, 'rx'), num(el, 'ry'), tol / matScaleOf(lm))];
    } else if (tag === 'circle') {
      const r = num(el, 'r');
      if (r > 0) subs = [ellipsePts(num(el, 'cx'), num(el, 'cy'), r, r, tol / matScaleOf(lm))];
    } else if (tag === 'ellipse') {
      subs = [ellipsePts(num(el, 'cx'), num(el, 'cy'), num(el, 'rx'), num(el, 'ry'), tol / matScaleOf(lm))];
    } else if (tag === 'polygon' || tag === 'polyline') {
      const p = (el.getAttribute('points') || '').split(/[\s,]+/).filter((s) => s).map(Number);
      const pts = [];
      for (let i = 0; i + 1 < p.length; i += 2) pts.push({ x: p[i], y: p[i + 1] });
      if (pts.length > 2) subs = [pts];
    } else if (tag === 'line') {
      warnings.add('<line> não tem área e foi ignorado.');
    } else if (tag === 'text') {
      warnings.add('Texto vivo (<text>) foi ignorado — converta para contornos no editor vetorial.');
    } else if (tag === 'image') {
      warnings.add('Imagem embutida ignorada — o gerador só usa vetores.');
    } else if (tag === 'use') {
      warnings.add('<use> ignorado — expanda as referências antes de exportar.');
    }

    if (subs) {
      const noFill = lf === 'none';
      const hasStroke = el.getAttribute && (el.getAttribute('stroke') || /stroke\s*:/.test(el.getAttribute('style') || ''));
      if (noFill && hasStroke) warnings.add('Há traços sem preenchimento: converta o contorno em forma ("expandir traço") ou ele não vira relevo.');
      if (!noFill || opts.strokeAsFill) {
        group++;
        for (const s of subs) {
          if (s.length < 3) continue;
          // Y do SVG cresce para baixo; o modelo 3D usa Y para cima
          contours.push({ pts: s.map((p) => { const q = apply(lm, p); return { x: q.x, y: -q.y }; }), rule: (lr || 'nonzero').toLowerCase(), group });
        }
      }
    }
    const kids = el.childNodes || [];
    for (let i = 0; i < kids.length; i++) walk(kids[i], lm, lf, lr);
  };

  walk(root, IDENT, 'black', 'nonzero');
  if (!contours.length) warnings.add('Nenhuma forma preenchida encontrada no SVG.');
  return { contours, warnings: [...warnings], tol };
}
