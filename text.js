/* text.js — texto -> contornos, via rasterização + marching squares sub-pixel.
   Sem acesso aos arquivos de fonte: desenha no canvas e extrai as curvas de nível do alpha. */
import { traceField, simplify, clean } from './geom.js';

export const FONTS = [
  { id: 'Lobster', label: 'Lobster', css: 'Lobster' },
  { id: 'Pacifico', label: 'Pacifico', css: 'Pacifico' },
  { id: 'Permanent Marker', label: 'Permanent Marker', css: 'Permanent+Marker' },
  { id: 'Righteous', label: 'Righteous', css: 'Righteous' },
  { id: 'Abril Fatface', label: 'Abril Fatface', css: 'Abril+Fatface' },
  { id: 'Fredoka', label: 'Fredoka', css: 'Fredoka:wght@600' },
  { id: 'Playfair Display', label: 'Playfair Display', css: 'Playfair+Display:wght@700' },
  { id: 'Great Vibes', label: 'Great Vibes', css: 'Great+Vibes' },
  { id: 'IBM Plex Sans', label: 'Plex Sans', css: 'IBM+Plex+Sans:wght@600' },
  { id: 'IBM Plex Mono', label: 'Plex Mono', css: 'IBM+Plex+Mono:wght@600' },
];

const PPM = 26; // pixels por mm na rasterização

/**
 * @param {object} o {text, font, heightMm, arcDeg, tracking}
 * @returns {Array<Array<{x,y}>>} contornos em mm, centrados, Y para cima
 */
export function textToContours(o) {
  const text = (o.text || '').trim();
  if (!text) return [];
  const font = o.font || 'IBM Plex Sans';
  const px = Math.max(24, Math.round((o.heightMm || 8) * PPM));
  const tracking = (o.tracking || 0) * PPM;
  const arc = ((o.arcDeg || 0) * Math.PI) / 180;

  const probe = document.createElement('canvas').getContext('2d');
  probe.font = `${px}px "${font}", sans-serif`;
  const chars = [...text];
  const widths = chars.map((c) => probe.measureText(c).width + tracking);
  const total = widths.reduce((a, b) => a + b, 0);
  const m = probe.measureText(text);
  const asc = m.actualBoundingBoxAscent || px * 0.8;
  const desc = m.actualBoundingBoxDescent || px * 0.2;

  const pad = Math.ceil(px * 0.25) + 4;
  let W, H, draw;
  if (Math.abs(arc) > 0.01) {
    const R = total / Math.abs(arc);
    const bulge = R * (1 - Math.cos(arc / 2));
    W = Math.ceil(2 * R * Math.sin(Math.min(Math.abs(arc), Math.PI * 0.98) / 2) + asc * 2 + pad * 2);
    H = Math.ceil(bulge + asc + desc + pad * 2);
    draw = (ctx) => {
      ctx.translate(W / 2, arc > 0 ? pad + asc + R : H - pad - desc - R + 2 * R);
      let a = -arc / 2;
      chars.forEach((ch, i) => {
        const step = (widths[i] / total) * arc;
        ctx.save();
        ctx.rotate(a + step / 2);
        ctx.translate(0, arc > 0 ? -R : R);
        if (arc < 0) ctx.rotate(Math.PI);
        ctx.fillText(ch, 0, 0);
        ctx.restore();
        a += step;
      });
    };
  } else {
    W = Math.ceil(total + pad * 2);
    H = Math.ceil(asc + desc + pad * 2);
    draw = (ctx) => {
      ctx.translate(pad, pad + asc);
      let x = 0;
      chars.forEach((ch, i) => { ctx.fillText(ch, x, 0); x += widths[i]; });
    };
  }
  W = Math.min(W, 4096); H = Math.min(H, 2048);

  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.font = `${px}px "${font}", sans-serif`;
  if (Math.abs(arc) <= 0.01) ctx.textAlign = 'left';
  ctx.save();
  draw(ctx);
  ctx.restore();

  const img = ctx.getImageData(0, 0, W, H).data;
  const alpha = new Uint8Array(W * H);
  for (let i = 0, j = 3; i < alpha.length; i++, j += 4) alpha[i] = img[j];

  const raw = traceField(alpha, W, H, 128);
  const tolPx = 0.35;
  let out = raw.map((c) => simplify(clean(c), tolPx)).filter((c) => c.length >= 3);
  // px -> mm, Y para cima, centrado
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const c of out) for (const p of c) {
    x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x);
    y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
  }
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  return out.map((c) => c.map((p) => ({ x: (p.x - cx) / PPM, y: -(p.y - cy) / PPM })));
}

export function fontsHref() {
  return 'https://fonts.googleapis.com/css2?' + FONTS.map((f) => 'family=' + f.css).join('&') + '&display=swap';
}
