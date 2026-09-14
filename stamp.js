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

/* --- Dobradiça impressa junto (print-in-place) -----------------------------
   Eixo de giro na altura da face de cima da placa (z = t): ao fechar 180°, as
   duas faces gravadas encostam uma na outra. Cada nó é um barril de raio R
   apoiado por duas rampas de 45° tangentes ao barril — uma sobe até a parede
   interna da placa, a outra desce até a mesa, para imprimir sem suporte.
   Os nós de uma placa nascem maciços com um pino integral que avança para
   dentro do furo do nó vizinho; nada de peça solta nem filamento avulso. */
const HINGE = {
  R: 3.0,        // raio do barril
  pinR: 1.25,    // raio do pino integral
  play: 0.50,    // folga radial pino↔furo (não solda na impressão)
  pinLen: 2.2,   // quanto o pino avança no nó vizinho
  gap: 0.30,     // folga axial entre nós
  ear: 2.0,      // quanto o nó entra na placa, para soldar no corpo dela
  arcSeg: 36,
};

/** Raios efetivos: em placa fina o barril encolhe para não furar a mesa (z=0). */
function hingeDims(thickness) {
  const R = Math.min(HINGE.R, thickness - 0.2);
  const pinR = Math.min(HINGE.pinR, R - 1.35);
  return { R, pinR, boreR: pinR + HINGE.play, thin: R < HINGE.R };
}

/** Distância do eixo até a parede interna da placa: a rampa de 45° tem de caber. */
function hingeEdge(thickness) {
  return hingeDims(thickness).R * Math.SQRT2 + 0.16;
}

/** Nós ao longo de Y, alternando placa A e placa B na proporção 1 : 2,5.
    A folga axial sai toda dos nós de B, para o pino de A ficar com curso cheio. */
export function hingeSegments(plateHeight, hingeCount) {
  const n = 2 * Math.max(1, hingeCount) + 3;   // 5, 7 ou 9 nós
  const w = [];
  for (let i = 0; i < n; i++) w.push(i % 2 === 0 ? 1 : 2.5);
  const unit = plateHeight / w.reduce((a, b) => a + b, 0);
  const segs = [];
  let y = -plateHeight / 2;
  for (let i = 0; i < n; i++) {
    const len = w[i] * unit;
    const cut = i % 2 === 1 ? HINGE.gap : 0;
    segs.push({ y0: y + cut, y1: y + len - cut, plate: i % 2 === 0 ? 'A' : 'B', first: i === 0, last: i === n - 1 });
    y += len;
  }
  return segs;
}

/** Perfil do nó no plano (x, z): barril + duas rampas de 45° + bloco dentro da placa.
    Devolvido já no referencial local do `prism` (y local = −z do mundo). */
function knuckleProfile(sgn, thickness) {
  const t = thickness;
  const { R } = hingeDims(t);
  const E = hingeEdge(t);
  const d = R / Math.SQRT2;               // projeção do ponto de tangência
  const foot = R * Math.SQRT2 - t;        // onde a rampa de baixo encosta na mesa
  const ramp = t + R * Math.SQRT2 - E;    // altura em que a rampa de cima toca a parede
  const p = [];
  p.push({ x: E + HINGE.ear, y: 0 });
  p.push({ x: foot, y: 0 });
  p.push({ x: d, y: t - d });
  for (let i = 1; i < HINGE.arcSeg; i++) { // arco de 270°: −45° → −315°, contornando o lado oposto
    const a = -Math.PI / 4 - (i * 1.5 * Math.PI) / HINGE.arcSeg;
    p.push({ x: R * Math.cos(a), y: t + R * Math.sin(a) });
  }
  p.push({ x: d, y: t + d });
  p.push({ x: E, y: ramp });
  p.push({ x: E, y: t });
  p.push({ x: E + HINGE.ear, y: t });
  return clean(p.map((q) => ({ x: sgn * q.x, y: -q.y })));
}

/** Um nó: maciço com pinos (placa A) ou com furo cego nas duas pontas (placa B). */
function knuckle(s, sg) {
  const t = s.thickness;
  const { pinR, boreR } = hingeDims(t);
  const m = new Mesh('dobradica', COLORS.hinge);
  const outer = knuckleProfile(sg.plate === 'A' ? -1 : 1, t);
  const L = sg.y1 - sg.y0;
  const axis = (r, seg) => circle(0, -t, r, seg);

  if (sg.plate === 'A') {
    prism(m, { outer, holes: [] }, 0, L);
  } else {
    const depth = Math.min(HINGE.pinLen - HINGE.gap + 0.2, L / 2 - 0.2);
    prism(m, { outer, holes: [axis(boreR, 24)] }, 0, depth);
    prism(m, { outer, holes: [] }, depth, L - depth);
    prism(m, { outer, holes: [axis(boreR, 24)] }, L - depth, L);
  }
  m.transform((p) => ({ x: p.x, y: p.z + sg.y0, z: -p.y }));

  if (sg.plate === 'A') {
    for (const at of [sg.first ? null : sg.y0 - HINGE.pinLen, sg.last ? null : sg.y1]) {
      if (at === null) continue;
      const pin = new Mesh('dobradica', COLORS.hinge);
      prism(pin, { outer: axis(pinR, 20), holes: [] }, 0, HINGE.pinLen);
      pin.transform((p) => ({ x: p.x, y: p.z + at, z: -p.y }));
      m.merge(pin);
    }
  }
  return m;
}

/** Contorno da placa: cantos arredondados do lado externo, borda reta no lado da dobradiça. */
function plateOutline(side, s) {
  const { plateWidth: W, plateHeight: H, cornerRadius: r, thickness: t } = s;
  const near = hingeEdge(t);             // parede interna: onde a rampa do nó encosta
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
    const gap = s.mode === 'hinge' ? hingeEdge(t) : 1;
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
    for (const sg of segs) h.merge(knuckle(s, sg));
    parts.push(h);
    if (hingeDims(t).thin) warn.push('Placa fina: o barril da dobradiça foi reduzido para não passar por baixo da mesa. Acima de 3,2 mm de espessura a dobradiça sai no tamanho cheio.');
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
