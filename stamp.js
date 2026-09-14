/* stamp.js — gerador do selo de relevo (placa macho + placa fêmea + dobradiça/ímãs). */
import { roundedRect, circle, ensureCCW, clean, mapTree, fitTree, dilateTree, pruneTree, simplify } from './geom.js';
import { Mesh, buildPlate, prism, safeOffset } from './mesh.js';

export const PRESETS = {
  lata: { label: 'Lata de alumínio', relief: 0.40, clearance: 0.12, hint: 'Relevo suave para folha de alumínio (0,40 mm).' },
  papel: { label: 'Papel 80–120 g', relief: 0.50, clearance: 0.16, hint: 'Relevo padrão para papel de carta (0,50 mm).' },
  wrap: { label: 'Vegetal / wrap', relief: 0.60, clearance: 0.20, hint: 'Relevo profundo para papéis finos e maleáveis (0,60 mm).' },
  cartao: { label: 'Cartão 300 g', relief: 1.20, clearance: 0.32, hint: 'Relevo forte para cartão rígido (1,20 mm).' },
};

export const DEFAULTS = {
  preset: 'papel',
  relief: 0.50,
  clearance: 0.16,
  zClearance: 0.05,
  draft: 0.06,
  plateWidth: 64,
  plateHeight: 45,
  thickness: 4,
  cornerRadius: 5,
  padding: 4,
  mode: 'hinge',
  hingeCount: 1,
  pin: false,
  magnetD: 6,
  magnetH: 3,
  magnetCount: 4,
  logoScale: 1,
  logoRotation: 0,
  logoOffsetY: 0,
  swap: false,
  simplifyTol: 0.012,
};

/* Deslocamento determinístico de 0,2 µm: quebra colinearidades exatas entre contornos
   diferentes (que fazem o triangulador descartar orelhas de área zero) sem efeito físico. */
function jitter(nodes) {
  const h = (x, y) => {
    const v = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
    return (v - Math.floor(v) - 0.5) * 4e-4;
  };
  return mapTree(nodes, (p) => ({ x: p.x + h(p.x, p.y), y: p.y + h(p.y, p.x) }));
}

const COLORS = { macho: '#2fe08a', femea: '#1f2933', hinge: '#8d98a7', pin: '#e0a32f' };

/** Segmentos da dobradiça ao longo de Y. Pares -> placa A, ímpares -> placa B. */
export function hingeSegments(plateHeight, hingeCount) {
  const n = 2 * Math.max(1, hingeCount) + 1;
  const span = plateHeight * 0.92;
  const L = span / n;
  const g = 0.35;
  const segs = [];
  for (let i = 0; i < n; i++) {
    segs.push({
      y0: -span / 2 + i * L + (i === 0 ? 0 : g / 2),
      y1: -span / 2 + (i + 1) * L - (i === n - 1 ? 0 : g / 2),
      plate: i % 2 === 0 ? 'A' : 'B',
    });
  }
  return segs;
}

/** Contorno da placa: cantos arredondados do lado externo, borda reta no lado da dobradiça. */
function plateOutline(side, s) {
  const { plateWidth: W, plateHeight: H, cornerRadius: r, thickness: t } = s;
  const near = t / 2 + 0.3;              // folga de giro em relação ao eixo
  const sgn = side === 'A' ? -1 : 1;
  const x0 = sgn < 0 ? -(near + W) : near;
  const rr = [sgn < 0 ? r : 0, sgn < 0 ? 0 : r, sgn < 0 ? 0 : r, sgn < 0 ? r : 0];
  // rr = [sup dir, sup esq, inf esq, inf dir] — arredonda só o lado externo
  return ensureCCW(roundedRect(x0, -H / 2, W, H, rr, 10));
}

function plainOutline(side, s) {
  const { plateWidth: W, plateHeight: H, cornerRadius: r } = s;
  const gap = 2;
  const x0 = side === 'A' ? -(gap / 2 + W) : gap / 2;
  return ensureCCW(roundedRect(x0, -H / 2, W, H, r, 10));
}

function magnetPockets(side, s) {
  const { plateWidth: W, plateHeight: H, magnetD: D, magnetCount: n } = s;
  const gap = 2;
  const cx = side === 'A' ? -(gap / 2 + W / 2) : gap / 2 + W / 2;
  const m = D / 2 + 2.5;
  const xs = [cx - (W / 2 - m), cx + (W / 2 - m)];
  const ys = n >= 4 ? [-(H / 2 - m), H / 2 - m] : [0];
  const out = [];
  for (const x of xs) for (const y of ys) out.push({ ring: circle(x, y, D / 2 + 0.15, 32), depth: s.magnetH + 0.2 });
  return out;
}

/** Perfil do nó: barril + orelha retangular para o lado da própria placa, com furo do pino.
    A orelha é o que solda o nó à placa — sem ela o barril fica preso por uma lasca. */
function knuckleProfile(R, boreR, leaf, sgn, seg = 44) {
  const pts = [];
  for (let i = 0; i <= seg; i++) {            // semicírculo do lado oposto à orelha
    const a = -Math.PI / 2 + Math.PI * (i / seg);
    pts.push({ x: -sgn * R * Math.cos(a), y: R * Math.sin(a) });
  }
  pts.push({ x: sgn * leaf, y: R });          // orelha: topo, lateral, base
  pts.push({ x: sgn * leaf, y: -R });
  return { outer: ensureCCW(clean(pts)), holes: [circle(0, 0, boreR, 26)] };
}

/** Nó da dobradiça: eixo em Y, centrado em (x=0, z=t/2), soldado na placa `side`. */
function knuckle(s, y0, y1, side) {
  const R = s.thickness / 2;
  const boreR = Math.min(0.975, R - 0.8);
  const leaf = R + 3.5;                        // avança 3,2 mm para dentro da placa
  const m = new Mesh('hinge', COLORS.hinge);
  prism(m, knuckleProfile(R, boreR, leaf, side === 'A' ? -1 : 1), 0, y1 - y0);
  m.transform((p) => ({ x: p.x, y: p.z + y0, z: -p.y + s.thickness / 2 }));
  return m;
}

/**
 * @param {Array} inkNodes árvore de contornos (saída de nestTree), em unidades do SVG
 * @param {object} state
 */
export function buildStamp(inkNodes, state) {
  const s = { ...DEFAULTS, ...state };
  const t = s.thickness;
  const parts = [];
  const warn = [];

  const machoSide = s.swap ? 'B' : 'A';
  const femeaSide = s.swap ? 'A' : 'B';

  const segs = s.mode === 'hinge' ? hingeSegments(s.plateHeight, s.hingeCount) : [];
  const outlineOf = (side) => (s.mode === 'hinge' ? plateOutline(side, s) : plainOutline(side, s));

  // --- tinta: normaliza, posiciona no centro da placa macho ---
  let ink = [];
  if (inkNodes && inkNodes.length) {
    if (s.fit === false) {
      ink = inkNodes; // já em mm, relativo ao centro da placa
    } else {
      const maxW = s.plateWidth - 2 * s.padding;
      const maxH = s.plateHeight - 2 * s.padding;
      ink = fitTree(inkNodes, maxW, maxH, { rotDeg: s.logoRotation, scale: s.logoScale }).nodes;
    }
    if (s.simplifyTol > 0) for (const n of ink) n.pts = simplify(n.pts, s.simplifyTol);
    const gap = s.mode === 'hinge' ? t / 2 + 0.3 : 1;
    const cx = (machoSide === 'A' ? -1 : 1) * (gap + s.plateWidth / 2);
    ink = jitter(mapTree(ink, (p) => ({ x: p.x + cx, y: p.y + (s.fit === false ? 0 : s.logoOffsetY) })));
  }

  // --- placa macho ---
  parts.push(buildPlate({
    name: 'macho', color: COLORS.macho,
    outline: outlineOf(machoSide),
    thickness: t,
    nodes: ink,
    relief: s.relief,
    draft: s.draft,
    pockets: s.mode === 'magnets' ? magnetPockets(machoSide, s) : [],
  }));

  // --- placa fêmea: tinta espelhada no eixo da dobra e dilatada pela folga ---
  let inkF = mapTree(ink, (p) => ({ x: -p.x, y: p.y }));
  if (s.clearance > 0) {
    inkF = dilateTree(inkF, s.clearance, safeOffset);
    const before = inkF.length;
    inkF = pruneTree(inkF, 0.02);
    if (inkF.length < before) warn.push('Detalhes muito finos foram removidos da matriz fêmea — aumente a escala do logo ou reduza a folga.');
  }
  parts.push(buildPlate({
    name: 'femea', color: COLORS.femea,
    outline: outlineOf(femeaSide),
    thickness: t,
    nodes: inkF,
    relief: -(s.relief + s.zClearance),
    draft: s.draft,
    pockets: s.mode === 'magnets' ? magnetPockets(femeaSide, s) : [],
  }));

  // --- dobradiça ---
  if (s.mode === 'hinge') {
    const h = new Mesh('dobradica', COLORS.hinge);
    for (const sg of segs) h.merge(knuckle(s, sg.y0, sg.y1, sg.plate));
    parts.push(h);
    if (s.pin) {
      const R = t / 2;
      const boreR = Math.min(0.975, R - 0.8);
      const span = s.plateHeight * 0.92;
      const pin = new Mesh('pino', COLORS.pin);
      prism(pin, { outer: circle(0, 0, boreR - 0.12, 28), holes: [] }, 0, span);
      pin.transform((p) => ({ x: p.x + s.thickness / 2 + s.plateWidth + 8, y: p.z - span / 2, z: -p.y + boreR }));
      parts.push(pin);
    }
  }

  const bb = parts.reduce((acc, p) => {
    const b = p.bbox();
    return {
      x0: Math.min(acc.x0, b.x0), x1: Math.max(acc.x1, b.x1),
      y0: Math.min(acc.y0, b.y0), y1: Math.max(acc.y1, b.y1),
      z0: Math.min(acc.z0, b.z0), z1: Math.max(acc.z1, b.z1),
    };
  }, { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity, z0: Infinity, z1: -Infinity });

  return {
    parts, warnings: warn, bbox: bb,
    stats: {
      triangles: parts.reduce((n, p) => n + p.count, 0),
      size: [bb.x1 - bb.x0, bb.y1 - bb.y0, bb.z1 - bb.z0],
      relief: s.relief, clearance: s.clearance,
    },
  };
}
