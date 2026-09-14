/* exporters.js — STL binário e 3MF (zip "stored") multicolor. Sem dependências. */

export function toSTL(parts, header = 'gerado por Matriz de Relevo') {
  let n = 0;
  for (const p of parts) n += p.count;
  const buf = new ArrayBuffer(84 + n * 50);
  const dv = new DataView(buf);
  const head = new Uint8Array(buf, 0, 80);
  const txt = new TextEncoder().encode(header.slice(0, 79));
  head.set(txt);
  dv.setUint32(80, n, true);
  let off = 84;
  for (const p of parts) {
    const v = p.v;
    for (let i = 0; i < v.length; i += 9) {
      const ax = v[i], ay = v[i + 1], az = v[i + 2];
      const bx = v[i + 3], by = v[i + 4], bz = v[i + 5];
      const cx = v[i + 6], cy = v[i + 7], cz = v[i + 8];
      let nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay);
      let ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
      let nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
      const l = Math.hypot(nx, ny, nz) || 1;
      dv.setFloat32(off, nx / l, true); dv.setFloat32(off + 4, ny / l, true); dv.setFloat32(off + 8, nz / l, true);
      dv.setFloat32(off + 12, ax, true); dv.setFloat32(off + 16, ay, true); dv.setFloat32(off + 20, az, true);
      dv.setFloat32(off + 24, bx, true); dv.setFloat32(off + 28, by, true); dv.setFloat32(off + 32, bz, true);
      dv.setFloat32(off + 36, cx, true); dv.setFloat32(off + 40, cy, true); dv.setFloat32(off + 44, cz, true);
      dv.setUint16(off + 48, 0, true);
      off += 50;
    }
  }
  return new Uint8Array(buf);
}

/* ---------- zip mínimo (sem compressão) ---------- */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();
function crc32(u8) {
  let c = 0xffffffff;
  for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function zipStore(files) {
  const enc = new TextEncoder();
  const entries = files.map((f) => ({ name: enc.encode(f.name), data: typeof f.data === 'string' ? enc.encode(f.data) : f.data }));
  let total = 0, central = 0;
  for (const e of entries) { total += 30 + e.name.length + e.data.length; central += 46 + e.name.length; }
  const buf = new ArrayBuffer(total + central + 22);
  const dv = new DataView(buf);
  const u8 = new Uint8Array(buf);
  let off = 0;
  for (const e of entries) {
    e.crc = crc32(e.data);
    e.off = off;
    dv.setUint32(off, 0x04034b50, true);
    dv.setUint16(off + 4, 20, true); dv.setUint16(off + 6, 0, true); dv.setUint16(off + 8, 0, true);
    dv.setUint16(off + 10, 0, true); dv.setUint16(off + 12, 0x21, true);
    dv.setUint32(off + 14, e.crc, true);
    dv.setUint32(off + 18, e.data.length, true);
    dv.setUint32(off + 22, e.data.length, true);
    dv.setUint16(off + 26, e.name.length, true); dv.setUint16(off + 28, 0, true);
    u8.set(e.name, off + 30);
    u8.set(e.data, off + 30 + e.name.length);
    off += 30 + e.name.length + e.data.length;
  }
  const cstart = off;
  for (const e of entries) {
    dv.setUint32(off, 0x02014b50, true);
    dv.setUint16(off + 4, 20, true); dv.setUint16(off + 6, 20, true);
    dv.setUint16(off + 8, 0, true); dv.setUint16(off + 10, 0, true);
    dv.setUint16(off + 12, 0, true); dv.setUint16(off + 14, 0x21, true);
    dv.setUint32(off + 16, e.crc, true);
    dv.setUint32(off + 20, e.data.length, true);
    dv.setUint32(off + 24, e.data.length, true);
    dv.setUint16(off + 28, e.name.length, true);
    dv.setUint16(off + 30, 0, true); dv.setUint16(off + 32, 0, true);
    dv.setUint16(off + 34, 0, true); dv.setUint16(off + 36, 0, true);
    dv.setUint32(off + 38, 0, true);
    dv.setUint32(off + 42, e.off, true);
    u8.set(e.name, off + 46);
    off += 46 + e.name.length;
  }
  dv.setUint32(off, 0x06054b50, true);
  dv.setUint16(off + 8, entries.length, true);
  dv.setUint16(off + 10, entries.length, true);
  dv.setUint32(off + 12, off - cstart, true);
  dv.setUint32(off + 16, cstart, true);
  dv.setUint16(off + 20, 0, true);
  return u8;
}

const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

function meshXML(part, id, pid, pindex) {
  const map = new Map();
  const verts = [];
  const idx = [];
  const v = part.v;
  for (let i = 0; i < v.length; i += 3) {
    const k = v[i].toFixed(4) + ',' + v[i + 1].toFixed(4) + ',' + v[i + 2].toFixed(4);
    let j = map.get(k);
    if (j === undefined) { j = verts.length; map.set(k, j); verts.push([v[i], v[i + 1], v[i + 2]]); }
    idx.push(j);
  }
  const vs = verts.map((p) => `<vertex x="${p[0].toFixed(4)}" y="${p[1].toFixed(4)}" z="${p[2].toFixed(4)}"/>`).join('');
  let ts = '';
  for (let i = 0; i < idx.length; i += 3) ts += `<triangle v1="${idx[i]}" v2="${idx[i + 1]}" v3="${idx[i + 2]}"/>`;
  return `<object id="${id}" type="model" pid="${pid}" pindex="${pindex}" name="${esc(part.name)}"><mesh><vertices>${vs}</vertices><triangles>${ts}</triangles></mesh></object>`;
}

export function to3MF(parts) {
  const colors = parts.map((p) => (p.color || '#cccccc').replace('#', '').toUpperCase().padEnd(6, 'C') + 'FF');
  const cg = `<m:colorgroup id="1">${colors.map((c) => `<m:color color="#${c}"/>`).join('')}</m:colorgroup>`;
  const objs = parts.map((p, i) => meshXML(p, i + 2, 1, i)).join('');
  const items = parts.map((p, i) => `<item objectid="${i + 2}"/>`).join('');
  const model =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:m="http://schemas.microsoft.com/3dmanufacturing/material/2015/02">` +
    `<metadata name="Application">Matriz de Relevo</metadata>` +
    `<resources>${cg}${objs}</resources><build>${items}</build></model>`;
  const ct =
    `<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>`;
  const rels =
    `<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>`;
  return zipStore([
    { name: '[Content_Types].xml', data: ct },
    { name: '_rels/.rels', data: rels },
    { name: '3D/3dmodel.model', data: model },
  ]);
}
