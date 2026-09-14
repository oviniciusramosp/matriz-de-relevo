/* app.js — interface, cena 3D e exportação. */
import { parseSVG } from './svgpoly.js';
import { nestTree, bbox } from './geom.js';
import { setTriangulator } from './mesh.js';
import { buildStamp, DEFAULTS, PRESETS } from './stamp.js';
import { toSTL, to3MF, zipStore } from './exporters.js';
import { textToContours, FONTS } from './text.js';

const THREE = window.THREE;
setTriangulator((c, h) => THREE.ShapeUtils.triangulateShape(c, h));
const $ = (id) => document.getElementById(id);
const nf = (v, d = 1) => v.toFixed(d).replace('.', ',');

/* ---------------- arte de exemplo ---------------- */
const SAMPLE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">
<path d="M60 3 A57 57 0 1 0 60.01 3 Z M60 14 A46 46 0 1 1 59.99 14 Z"/>
<path d="M30 86 L52 46 L64 68 L72 55 L90 86 Z"/>
<circle cx="80" cy="36" r="9"/>
</svg>`;

/* ---------------- estado ---------------- */
const S = {
  ...DEFAULTS,
  preset: 'papel',
  text: '', txtFont: 'IBM Plex Sans', txtSize: 7, txtArc: 0, txtGap: 3,
  fmt: 'stl', projectName: 'matriz-relevo',
};
let logoContours = [];
let textContours = [];
let last = null;

/* ---------------- composição da arte ---------------- */
function xf(cs, k, dx, dy, rotDeg) {
  const a = (rotDeg * Math.PI) / 180, co = Math.cos(a), si = Math.sin(a);
  return cs.map((c) => c.map((p) => {
    const x = rotDeg ? p.x * co - p.y * si : p.x;
    const y = rotDeg ? p.x * si + p.y * co : p.y;
    return { x: x * k + dx, y: y * k + dy };
  }));
}
function composeInk() {
  const out = [];
  const innerW = S.plateWidth - 2 * S.padding;
  const innerH = S.plateHeight - 2 * S.padding;
  const hasText = textContours.length > 0;
  const th = hasText ? S.txtSize : 0;
  const gap = hasText ? S.txtGap : 0;

  if (hasText) {
    const bb = bbox(textContours);
    if (bb.h > 0) {
      const k = Math.min(th / bb.h, innerW / bb.w);
      const cy = -innerH / 2 + (bb.h * k) / 2;
      out.push(...xf(textContours.map((c) => c.map((p) => ({ x: p.x - bb.cx, y: p.y - bb.cy }))), k, 0, cy, 0));
    }
  }
  if (logoContours.length) {
    const boxH = Math.max(2, innerH - th - gap);
    const bb = bbox(logoContours);
    const rot = S.logoRotation % 360;
    const swapped = Math.abs(rot % 180) === 90;
    const w = swapped ? bb.h : bb.w, h = swapped ? bb.w : bb.h;
    if (w > 0 && h > 0) {
      const k = Math.min(innerW / w, boxH / h) * S.logoScale;
      const cy = (th + gap) / 2 + S.logoOffsetY;
      out.push(...xf(logoContours.map((c) => c.map((p) => ({ x: p.x - bb.cx, y: p.y - bb.cy }))), k, 0, cy, rot));
    }
  }
  return out;
}

/* ---------------- cena ---------------- */
const canvas = $('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
if (THREE.sRGBEncoding !== undefined) renderer.outputEncoding = THREE.sRGBEncoding;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(35, 1, 1, 2000);
const group = new THREE.Group();
scene.add(group);
const bedGroup = new THREE.Group();
scene.add(bedGroup);

scene.add(new THREE.HemisphereLight(0xffffff, 0x5d5748, 0.62));
const key = new THREE.DirectionalLight(0xffffff, 1.25); key.position.set(-60, -110, 90); scene.add(key);
const fill = new THREE.DirectionalLight(0xffffff, 0.32); fill.position.set(120, 70, 30); scene.add(fill);

const orbit = { r: 200, theta: -0.7, phi: 0.95, tx: 0, ty: 0, tz: 2 };
function applyCam() {
  const { r, theta, phi } = orbit;
  camera.position.set(
    orbit.tx + r * Math.sin(phi) * Math.sin(theta),
    orbit.ty - r * Math.sin(phi) * Math.cos(theta),
    orbit.tz + r * Math.cos(phi),
  );
  camera.up.set(0, 0, 1);
  camera.lookAt(orbit.tx, orbit.ty, orbit.tz);
}
let drag = null;
canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  drag = { x: e.clientX, y: e.clientY, pan: e.button === 2 || e.shiftKey || e.button === 1 };
});
canvas.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  drag.x = e.clientX; drag.y = e.clientY;
  if (drag.pan) {
    const s = orbit.r / 900;
    orbit.tx -= dx * s * Math.cos(orbit.theta);
    orbit.ty -= dx * s * Math.sin(orbit.theta);
    orbit.tz += dy * s;
  } else {
    orbit.theta -= dx * 0.008;
    orbit.phi = Math.min(Math.PI - 0.02, Math.max(0.02, orbit.phi - dy * 0.008));
  }
  applyCam();
});
addEventListener('pointerup', () => { drag = null; });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  orbit.r = Math.min(900, Math.max(30, orbit.r * (1 + Math.sign(e.deltaY) * 0.1)));
  applyCam();
}, { passive: false });

function bedLines() {
  bedGroup.clear();
  const col = new THREE.Color(getCSS('--line-strong'));
  const pts = [];
  const ext = 130, step = 10;
  for (let i = -ext; i <= ext; i += step) {
    pts.push(-ext, i, 0, ext, i, 0);
    pts.push(i, -ext, 0, i, ext, 0);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  bedGroup.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: 0.55 })));
}
function getCSS(v) { return getComputedStyle(document.documentElement).getPropertyValue(v).trim() || '#888'; }

function resize() {
  const r = canvas.getBoundingClientRect();
  if (!r.width || !r.height) return;
  renderer.setSize(r.width, r.height, false);
  camera.aspect = r.width / r.height;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(canvas.parentElement);

function tick() { renderer.render(scene, camera); requestAnimationFrame(tick); }

function updateScene(res) {
  group.clear();
  const colors = { macho: getCSS('--male'), femea: getCSS('--female'), dobradica: getCSS('--line-strong'), pino: getCSS('--brass') };
  const artColor = new THREE.Color(getCSS('--art'));
  const mk = (hex, offset) => new THREE.MeshStandardMaterial({
    color: hex instanceof THREE.Color ? hex : new THREE.Color(hex),
    roughness: 0.6, metalness: 0.1, flatShading: true,
    polygonOffset: offset, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  for (const part of res.parts) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(part.toFloat32(), 3));
    g.computeVertexNormals();
    const body = mk(colors[part.name] || '#999', part.name === 'dobradica');
    let m;
    if (part.ink && part.ink.length) {
      // separa as faces do relevo/cavidade para destacar a arte na pré-visualização
      let cur = 0;
      for (const [a, b] of part.ink) {
        if (a > cur) g.addGroup(cur * 3, (a - cur) * 3, 0);
        g.addGroup(a * 3, (b - a) * 3, 1);
        cur = b;
      }
      if (part.count > cur) g.addGroup(cur * 3, (part.count - cur) * 3, 0);
      m = new THREE.Mesh(g, [body, mk(artColor, false)]);
    } else {
      m = new THREE.Mesh(g, body);
    }
    group.add(m);
  }
}
function frame() {
  if (!last) return;
  const b = last.bbox;
  const w = Math.max(b.x1 - b.x0, (b.y1 - b.y0) * 1.4, 40);
  orbit.tx = (b.x0 + b.x1) / 2; orbit.ty = (b.y0 + b.y1) / 2; orbit.tz = 2;
  orbit.r = w * 1.9;
  applyCam();
}

/* ---------------- corte esquemático ---------------- */
function drawSection() {
  const K = 30;                       // px por mm na vertical (relevo exagerado)
  const rel = Math.min(30, S.relief * K);
  const cav = Math.min(32, (S.relief + S.zClearance) * K);
  const cl = Math.min(10, S.clearance * K);
  const L = 64, R = 282, b0 = 150, b1 = 214;
  const yF = 10, yM = 98, tPx = 19;
  const fFace = yF + tPx, mFace = yM - tPx;
  const ink = getCSS('--ink'), male = getCSS('--male'), female = getCSS('--female');
  const muted = getCSS('--muted'), line = getCSS('--line-strong');
  $('xsec').setAttribute('viewBox', '0 0 300 128');
  $('xsec').innerHTML = `
  <g font-family="IBM Plex Mono, monospace" font-size="8.5" fill="${muted}">
    <path fill="${female}" d="M${L} ${yF} H${R} V${fFace} H${b1 + cl} V${fFace - cav} H${b0 - cl} V${fFace} H${L} Z"/>
    <path fill="${male}" d="M${L} ${yM} H${R} V${mFace} H${b1} V${mFace - rel} H${b0} V${mFace} H${L} Z"/>
    <path fill="none" stroke="${ink}" stroke-width="1.6" stroke-linejoin="round"
      d="M${L} ${mFace - 5} H${b0 - 3} L${b0 + 2} ${mFace - rel - 5} H${b1 - 2} L${b1 + 3} ${mFace - 5} H${R}"/>
    <text x="58" y="${yF + tPx / 2 + 3}" text-anchor="end">fêmea</text>
    <text x="58" y="${mFace - rel - 8}" text-anchor="end">papel</text>
    <text x="58" y="${yM - tPx / 2 + 3}" text-anchor="end">macho</text>
    <line x1="${b1}" y1="${fFace + 5}" x2="${b1 + cl}" y2="${fFace + 5}" stroke="${ink}" stroke-width="1.6"/>
    <line x1="${b0 - cl}" y1="${fFace + 5}" x2="${b0}" y2="${fFace + 5}" stroke="${ink}" stroke-width="1.6"/>
    <text x="0" y="122" fill="${muted}">relevo ${nf(S.relief, 2)} · cavidade ${nf(S.relief + S.zClearance, 2)} · folga ${nf(S.clearance, 2)} mm</text>
    <line x1="0" y1="110" x2="300" y2="110" stroke="${line}" stroke-width="0.6"/>
  </g>`;
}

/* ---------------- reconstrução ---------------- */
let timer = null;
function schedule() { clearTimeout(timer); timer = setTimeout(rebuild, 90); }
function rebuild() {
  const t0 = performance.now();
  try {
    const nodes = nestTree(composeInk());
    last = buildStamp(nodes, { ...S, fit: false });
    updateScene(last);
    const s = last.stats;
    $('readout').innerHTML =
      `<span>peça <b>${nf(s.size[0])} × ${nf(s.size[1])} × ${nf(s.size[2], 2)} mm</b></span>` +
      `<span>relevo <b>${nf(S.relief, 2)}</b></span>` +
      `<span>folga <b>${nf(S.clearance, 2)}</b></span>` +
      `<span>${s.triangles.toLocaleString('pt-BR')} triângulos</span>` +
      `<span>${Math.round(performance.now() - t0)} ms</span>`;
    showWarn(last.warnings);
  } catch (err) {
    showWarn(['Não foi possível gerar a geometria: ' + err.message]);
  }
  drawSection();
}
function showWarn(list) {
  const box = $('warn');
  const all = [...(list || []), ...(window.__svgWarn || [])];
  box.className = 'warnbox' + (all.length ? ' on' : '');
  box.innerHTML = all.map((w) => '• ' + w).join('<br>');
}

/* ---------------- ligações da interface ---------------- */
function slider(id, key, fmtId, fmt) {
  const el = $(id);
  el.value = S[key];
  const paint = () => { $(fmtId).textContent = fmt(+el.value); };
  el.addEventListener('input', () => { S[key] = +el.value; paint(); schedule(); });
  paint();
}
function segment(id, attr, apply, cast = String) {
  const wrap = $(id);
  wrap.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-' + attr + ']');
    if (!b) return;
    [...wrap.querySelectorAll('button')].forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    apply(cast(b.dataset[attr]));
    schedule();
  });
}

slider('logoScale', 'logoScale', 'vScale', (v) => nf(v, 2) + '×');
slider('logoY', 'logoOffsetY', 'vOffset', (v) => nf(v) + ' mm');
slider('plateWidth', 'plateWidth', 'vW', (v) => nf(v) + ' mm');
slider('plateHeight', 'plateHeight', 'vH', (v) => nf(v) + ' mm');
slider('thickness', 'thickness', 'vT', (v) => nf(v) + ' mm');
slider('cornerRadius', 'cornerRadius', 'vR', (v) => nf(v) + ' mm');
slider('padding', 'padding', 'vP', (v) => nf(v) + ' mm');
slider('magnetD', 'magnetD', 'vMD', (v) => nf(v) + ' mm');
slider('magnetH', 'magnetH', 'vMH', (v) => nf(v) + ' mm');
slider('relief', 'relief', 'vRel', (v) => nf(v, 2) + ' mm');
slider('clearance', 'clearance', 'vCl', (v) => nf(v, 2) + ' mm');
slider('zClearance', 'zClearance', 'vZ', (v) => nf(v, 2) + ' mm');
slider('draft', 'draft', 'vD', (v) => nf(v, 2) + ' mm');
slider('simplifyTol', 'simplifyTol', 'vS', (v) => nf(v, 3) + ' mm');
slider('txtSize', 'txtSize', 'vTS', (v) => nf(v) + ' mm');
slider('txtGap', 'txtGap', 'vTG', (v) => nf(v) + ' mm');

$('txtArc').addEventListener('input', (e) => {
  S.txtArc = +e.target.value;
  $('vTA').textContent = Math.round(S.txtArc) + '°';
  renderText();
});

segment('presets', 'preset', (p) => {
  const pr = PRESETS[p];
  S.preset = p; S.relief = pr.relief; S.clearance = pr.clearance;
  $('relief').value = pr.relief; $('vRel').textContent = nf(pr.relief, 2) + ' mm';
  $('clearance').value = pr.clearance; $('vCl').textContent = nf(pr.clearance, 2) + ' mm';
  $('presetHint').textContent = pr.hint;
});
segment('modes', 'mode', (m) => {
  S.mode = m;
  $('hingeOpts').style.display = m === 'hinge' ? 'flex' : 'none';
  $('magnetOpts').style.display = m === 'magnets' ? 'flex' : 'none';
});
segment('hingeCount', 'hinge', (v) => { S.hingeCount = +v; });
segment('magnetCount', 'mag', (v) => { S.magnetCount = +v; });
segment('fmt', 'fmt', (v) => { S.fmt = v; });

$('pin').addEventListener('change', (e) => { S.pin = e.target.checked; schedule(); });
$('btnRot').addEventListener('click', () => { S.logoRotation = (S.logoRotation + 90) % 360; schedule(); });
$('btnSwap').addEventListener('click', () => { S.swap = !S.swap; schedule(); });

/* fontes */
const sel = $('txtFont');
FONTS.forEach((f) => {
  const o = document.createElement('option');
  o.value = f.id; o.textContent = f.label; o.style.fontFamily = `"${f.id}"`;
  sel.appendChild(o);
});
sel.value = S.txtFont;
sel.addEventListener('change', () => { S.txtFont = sel.value; renderText(); });
let textTimer = null;
$('txt').addEventListener('input', (e) => { S.text = e.target.value; clearTimeout(textTimer); textTimer = setTimeout(renderText, 220); });

async function renderText() {
  S.txtSize = +$('txtSize').value;
  S.txtArc = +$('txtArc').value;
  if (!S.text.trim()) { textContours = []; schedule(); return; }
  try {
    if (document.fonts && document.fonts.load) await document.fonts.load(`600 40px "${S.txtFont}"`, S.text);
  } catch (e) { /* fonte não carregou: cai no fallback */ }
  textContours = textToContours({ text: S.text, font: S.txtFont, heightMm: 10, arcDeg: S.txtArc });
  schedule();
}

/* SVG */
function loadSVG(text, name) {
  try {
    const r = parseSVG(text);
    if (!r.contours.length) { window.__svgWarn = r.warnings.length ? r.warnings : ['Nenhuma forma preenchida encontrada.']; showWarn([]); return; }
    logoContours = r.contours.map((c) => c.pts);
    window.__svgWarn = r.warnings;
    $('fileName').textContent = name;
    $('artState').textContent = 'importado';
    S.logoRotation = 0;
    schedule();
  } catch (err) {
    window.__svgWarn = ['Não consegui ler o SVG: ' + err.message];
    showWarn([]);
  }
}
const drop = $('drop');
drop.addEventListener('click', () => $('svgFile').click());
drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('svgFile').click(); } });
$('svgFile').addEventListener('change', (e) => {
  const f = e.target.files[0];
  if (f) f.text().then((t) => loadSVG(t, f.name));
});
['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', (e) => {
  const f = e.dataTransfer.files[0];
  if (f) f.text().then((t) => loadSVG(t, f.name));
});

/* vistas */
document.querySelector('.views').addEventListener('click', (e) => {
  const v = e.target.dataset.view;
  if (!v) return;
  if (v === 'top') { orbit.theta = 0; orbit.phi = 0.02; }
  if (v === 'front') { orbit.theta = 0; orbit.phi = Math.PI / 2; }
  if (v === 'iso') { orbit.theta = -0.7; orbit.phi = 0.95; }
  if (v === 'fit') return frame();
  applyCam();
});

/* ---------------- exportação ---------------- */
function readme() {
  const s = last.stats;
  return [
    'MATRIZ DE RELEVO — pacote de impressão',
    '',
    `peça: ${nf(s.size[0])} × ${nf(s.size[1])} × ${nf(s.size[2], 2)} mm`,
    `material a gravar: ${PRESETS[S.preset] ? PRESETS[S.preset].label : '—'}`,
    `altura do relevo: ${nf(S.relief, 2)} mm | cavidade: ${nf(S.relief + S.zClearance, 2)} mm | folga lateral: ${nf(S.clearance, 2)} mm`,
    `placa: ${nf(S.plateWidth)} × ${nf(S.plateHeight)} × ${nf(S.thickness)} mm | canto ${nf(S.cornerRadius)} mm`,
    `fechamento: ${S.mode === 'hinge' ? `dobradiça com ${2 * S.hingeCount + 1} nós (pino de 1,75 mm)` : `${S.magnetCount} ímãs de ${nf(S.magnetD)} × ${nf(S.magnetH)} mm`}`,
    '',
    'COMO IMPRIMIR',
    '1. A peça já vem deitada: imprima como está, sem suportes.',
    '2. Camada de 0,10–0,12 mm e bico de 0,4 mm (0,2 mm dá muito mais detalhe no relevo).',
    '3. 3 paredes e 25% de preenchimento bastam; PLA ou PETG.',
    '4. Dobradiça: passe um pedaço de filamento de 1,75 mm pelos nós como pino.',
    S.mode === 'magnets' ? '5. Ímãs: cole na face de baixo, respeitando a polaridade entre as duas placas.' : '5. Feche a matriz com o papel no meio e pressione com firmeza.',
    '',
    'ARQUIVOS',
    'selo-completo.stl — tudo em uma peça, pronto para fatiar',
    'macho.stl / femea.stl — placas separadas',
    S.mode === 'hinge' ? 'dobradica.stl — os nós da dobradiça' : '',
    S.fmt !== 'stl' ? 'selo.3mf — versão multicolor, com as partes separadas por cor' : '',
    'projeto.json — parâmetros para recarregar no gerador',
  ].filter(Boolean).join('\n');
}
function projectJSON() {
  return JSON.stringify({ app: 'matriz-relevo', v: 1, state: S, svg: logoContours.length ? undefined : null, contours: logoContours }, null, 1);
}
async function doExport() {
  if (!last) return;
  const btn = $('btnExport');
  btn.disabled = true;
  const note = $('exportNote');
  try {
    const files = [];
    if (S.fmt !== '3mf') {
      files.push({ name: 'selo-completo.stl', data: toSTL(last.parts) });
      for (const p of last.parts) files.push({ name: p.name + '.stl', data: toSTL([p]) });
    }
    if (S.fmt !== 'stl') files.push({ name: 'selo.3mf', data: to3MF(last.parts) });
    files.push({ name: 'LEIA-ME.txt', data: readme() });
    files.push({ name: 'projeto.json', data: projectJSON() });
    const zip = zipStore(files);
    const filename = (S.projectName || 'matriz-relevo') + '.zip';
    const dl = window.claude && window.claude.use ? await window.claude.use('downloads') : null;
    if (dl) {
      await dl.save({ filename, data: new Blob([zip], { type: 'application/zip' }) });
      note.textContent = 'Pacote entregue: ' + filename;
    } else {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([zip], { type: 'application/zip' }));
      a.download = filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      note.textContent = 'Pacote gerado: ' + filename;
    }
  } catch (err) {
    const code = err && err.code;
    note.textContent = code === 'declined' ? 'Download cancelado.'
      : code === 'rate_limited' ? 'Muitos downloads seguidos — espere alguns segundos.'
      : 'Não foi possível entregar o arquivo' + (err && err.message ? ': ' + err.message : '.');
  } finally {
    btn.disabled = false;
  }
}
$('btnExport').addEventListener('click', doExport);

$('btnSaveProj').addEventListener('click', async () => {
  const data = projectJSON();
  const filename = (S.projectName || 'matriz-relevo') + '.json';
  const dl = window.claude && window.claude.use ? await window.claude.use('downloads') : null;
  if (dl) { try { await dl.save({ filename, data }); } catch (e) { /* recusado */ } return; }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
  a.download = filename; a.click();
});
$('btnLoadProj').addEventListener('click', () => $('projFile').click());
$('projFile').addEventListener('change', (e) => {
  const f = e.target.files[0];
  if (!f) return;
  f.text().then((t) => {
    try {
      const j = JSON.parse(t);
      Object.assign(S, j.state || {});
      if (Array.isArray(j.contours) && j.contours.length) logoContours = j.contours;
      syncInputs();
      renderText();
      $('artState').textContent = 'projeto';
      $('fileName').textContent = f.name;
    } catch (err) { window.__svgWarn = ['Projeto inválido.']; showWarn([]); }
  });
});
function syncInputs() {
  const map = {
    logoScale: 'logoScale', logoY: 'logoOffsetY', plateWidth: 'plateWidth', plateHeight: 'plateHeight',
    thickness: 'thickness', cornerRadius: 'cornerRadius', padding: 'padding', magnetD: 'magnetD',
    magnetH: 'magnetH', relief: 'relief', clearance: 'clearance', zClearance: 'zClearance',
    draft: 'draft', simplifyTol: 'simplifyTol', txtSize: 'txtSize', txtGap: 'txtGap', txtArc: 'txtArc',
  };
  for (const [id, key] of Object.entries(map)) {
    const el = $(id);
    if (el) { el.value = S[key]; el.dispatchEvent(new Event('input')); }
  }
  $('txt').value = S.text || '';
  $('pin').checked = !!S.pin;
  $('hingeOpts').style.display = S.mode === 'hinge' ? 'flex' : 'none';
  $('magnetOpts').style.display = S.mode === 'magnets' ? 'flex' : 'none';
}

/* ---------------- tema ---------------- */
const repaint = () => { bedLines(); if (last) updateScene(last); drawSection(); };
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', repaint);
new MutationObserver(repaint).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

/* ---------------- início ---------------- */
loadSVG(SAMPLE, 'exemplo-emblema.svg');
$('artState').textContent = 'exemplo';
bedLines();
resize();
rebuild();
frame();
tick();
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (S.text.trim()) renderText(); });

window.__orbit = orbit; window.__applyCam = applyCam;
