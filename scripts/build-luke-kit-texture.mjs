// Repaints Luke's existing 512² atlas with the green kit. No geometry, UVs,
// skin or bones change: the script reads the canonical GLB, maps every atlas
// texel back to its bind-pose body position through the existing UVs, and
// recolours only jersey/shorts texels. Skin, hair and shoes keep their
// original pixels. Lettering is set in installed system fonts (Liberation
// Sans / DejaVu Sans) through SVG, never traced from an image.
//
//   node scripts/build-luke-kit-texture.mjs
import { readFile, writeFile } from 'node:fs/promises';
import sharp from 'sharp';

const GLB = 'public/assets/models/player/luke-player-v1.glb';
const OUT = 'public/assets/textures/player/luke-kit-green-v1.jpg';

const COLORS = {
  green: [16, 140, 62], // kelly green body
  white: [244, 244, 240],
  blue: [28, 70, 190], // royal blue accents
  red: [206, 32, 44],
  skin: [158, 104, 61], // fill for the V-neck opening, sampled from Luke's neck
};

// Body landmarks in Luke's bind pose (metres, +X = his right, -Z = front).
const KIT = {
  jerseyTop: 1.70, shortsBottom: 0.62, waist: 1.0, waistband: 0.045,
  armholeMaxX: 0.36, // jersey texels never extend past the shoulder
  vNeck: { apexY: 1.505, slope: 1.55, halfWidth: 0.13 },
  collar: { white: 0.022, blue: 0.033 }, // distance from skin edge
  hem: { white: 0.028, blue: 0.040 },
  // Side stripe measured front-to-back from the middle of the side seam.
  sidePanel: { white: 0.024, blue: 0.038, edge: 0.047, depth: 0.05, minY: 0.66, maxY: 1.47 },
};

async function loadLuke() {
  const buf = await readFile(GLB);
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString());
  const bin = buf.subarray(28 + jsonLen);
  const acc = i => {
    const a = json.accessors[i], v = json.bufferViews[a.bufferView];
    const n = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type];
    const C = a.componentType === 5126 ? Float32Array : a.componentType === 5125 ? Uint32Array : Uint16Array;
    const off = bin.byteOffset + (v.byteOffset || 0) + (a.byteOffset || 0);
    return new C(bin.buffer.slice(off, off + a.count * n * C.BYTES_PER_ELEMENT));
  };
  const prim = json.meshes[0].primitives[0];
  const iv = json.bufferViews[json.images[0].bufferView];
  const jpeg = bin.subarray(iv.byteOffset || 0, (iv.byteOffset || 0) + iv.byteLength);
  const { data, info } = await sharp(jpeg).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { pos: acc(prim.attributes.POSITION), nrm: acc(prim.attributes.NORMAL), uv: acc(prim.attributes.TEXCOORD_0),
    idx: acc(prim.indices), atlas: data, size: info.width, sourceBytes: jpeg.length };
}

// Interpolated bind position and normal per atlas texel (NaN = no triangle).
function rasterize({ pos, nrm, uv, idx, size }) {
  const P = new Float32Array(size * size * 3).fill(NaN), N = new Float32Array(size * size * 3);
  for (let t = 0; t < idx.length; t += 3) {
    const ids = [idx[t], idx[t + 1], idx[t + 2]];
    const q = ids.map(i => [uv[i * 2] * size, uv[i * 2 + 1] * size]);
    const x0 = Math.max(0, Math.floor(Math.min(...q.map(a => a[0])) - 1)), x1 = Math.min(size - 1, Math.ceil(Math.max(...q.map(a => a[0])) + 1));
    const y0 = Math.max(0, Math.floor(Math.min(...q.map(a => a[1])) - 1)), y1 = Math.min(size - 1, Math.ceil(Math.max(...q.map(a => a[1])) + 1));
    const d = (q[1][1] - q[2][1]) * (q[0][0] - q[2][0]) + (q[2][0] - q[1][0]) * (q[0][1] - q[2][1]);
    if (Math.abs(d) < 1e-12) continue;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const px = x + .5, py = y + .5;
      const a = ((q[1][1] - q[2][1]) * (px - q[2][0]) + (q[2][0] - q[1][0]) * (py - q[2][1])) / d;
      const b = ((q[2][1] - q[0][1]) * (px - q[2][0]) + (q[0][0] - q[2][0]) * (py - q[2][1])) / d;
      const c = 1 - a - b;
      if (a < -.02 || b < -.02 || c < -.02) continue;
      const o = (y * size + x) * 3;
      for (let k = 0; k < 3; k++) {
        P[o + k] = a * pos[ids[0] * 3 + k] + b * pos[ids[1] * 3 + k] + c * pos[ids[2] * 3 + k];
        N[o + k] = a * nrm[ids[0] * 3 + k] + b * nrm[ids[1] * 3 + k] + c * nrm[ids[2] * 3 + k];
      }
    }
  }
  return { P, N };
}

function isSkinColor(r, g, b) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), v = max / 255, s = max ? (max - min) / max : 0;
  if (max === min) return false;
  let h = max === r ? (g - b) / (max - min) : max === g ? 2 + (b - r) / (max - min) : 4 + (r - g) / (max - min);
  h = (h * 60 + 360) % 360;
  return h >= 12 && h <= 48 && s > .22 && v > .22;
}

// Distance from each point to the nearest skin sample, via a 1 cm hash grid.
function skinDistance(skinPoints, maxDist) {
  const cell = .01, grid = new Map(), key = (x, y, z) => `${x},${y},${z}`;
  for (const p of skinPoints) {
    const k = key(Math.floor(p[0] / cell), Math.floor(p[1] / cell), Math.floor(p[2] / cell));
    (grid.get(k) || grid.set(k, []).get(k)).push(p);
  }
  const r = Math.ceil(maxDist / cell);
  return (x, y, z) => {
    const cx = Math.floor(x / cell), cy = Math.floor(y / cell), cz = Math.floor(z / cell);
    let best = maxDist * maxDist;
    for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) for (let k = -r; k <= r; k++) {
      const list = grid.get(key(cx + i, cy + j, cz + k)); if (!list) continue;
      for (const p of list) { const d = (p[0] - x) ** 2 + (p[1] - y) ** 2 + (p[2] - z) ** 2; if (d < best) best = d; }
    }
    return Math.sqrt(best);
  };
}

function neighbourCounter(points, radius) {
  const grid = new Map(), key = (x, y, z) => `${x},${y},${z}`;
  for (const p of points) {
    const k = key(Math.floor(p[0] / radius), Math.floor(p[1] / radius), Math.floor(p[2] / radius));
    (grid.get(k) || grid.set(k, []).get(k)).push(p);
  }
  return ([x, y, z]) => {
    let skin = 0, total = 0;
    const cx = Math.floor(x / radius), cy = Math.floor(y / radius), cz = Math.floor(z / radius);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++)
      for (const p of grid.get(key(cx + i, cy + j, cz + k)) || [])
        if ((p[0] - x) ** 2 + (p[1] - y) ** 2 + (p[2] - z) ** 2 < radius * radius) { total++; skin += p[3]; }
    return [skin, total];
  };
}

// White artwork rasterised from SVG; sample(u, v) returns RGBA in 0..1 for
// decal-local coordinates in metres (origin at decal centre, +v up).
async function decal(svg, width, height, px = 400) {
  const w = Math.round(px * width / Math.max(width, height)), h = Math.round(px * height / Math.max(width, height));
  const { data } = await sharp(Buffer.from(svg)).resize(w, h, { fit: 'fill' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return (u, v) => {
    const fx = (u / width + .5) * w - .5, fy = (.5 - v / height) * h - .5;
    if (fx < -1 || fy < -1 || fx > w || fy > h) return null;
    const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0, out = [0, 0, 0, 0];
    for (const [dx, dy, wt] of [[0, 0, (1 - tx) * (1 - ty)], [1, 0, tx * (1 - ty)], [0, 1, (1 - tx) * ty], [1, 1, tx * ty]]) {
      const x = Math.min(w - 1, Math.max(0, x0 + dx)), y = Math.min(h - 1, Math.max(0, y0 + dy)), o = (y * w + x) * 4;
      for (let c = 0; c < 4; c++) out[c] += data[o + c] / 255 * wt;
    }
    return out[3] > .01 ? out : null;
  };
}

const svgWrap = (w, h, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;
// Solid block "3": heavy sans set in DejaVu Sans Bold with a matching stroke
// to square up the strokes into a jersey-number weight.
const numberSvg = svgWrap(100, 130,
  `<text x="50" y="118" font-family="DejaVu Sans" font-weight="bold" font-size="150" text-anchor="middle" textLength="88" lengthAdjust="spacingAndGlyphs" fill="#fff" stroke="#fff" stroke-width="7" stroke-linejoin="miter">3</text>`);
const sponsorSvg = svgWrap(240, 112,
  // Stylised W mark: two overlapping chevrons above the wordmark.
  `<path d="M52 4 L80 4 L104 44 L120 16 L136 44 L160 4 L188 4 L150 62 L124 62 L120 54 L116 62 L90 62 Z" fill="#fff"/>` +
  `<text x="120" y="104" font-family="Liberation Sans" font-weight="bold" font-size="46" text-anchor="middle" textLength="220" lengthAdjust="spacingAndGlyphs" fill="#fff">Actavis</text>`);
const makerSvg = svgWrap(120, 100,
  // Small abstract icon over the lowercase maker wordmark.
  `<path d="M60 4 L78 22 L60 40 L42 22 Z" fill="none" stroke="#fff" stroke-width="7"/><circle cx="60" cy="22" r="5" fill="#fff"/>` +
  `<text x="60" y="92" font-family="Liberation Sans" font-weight="bold" font-size="48" text-anchor="middle" textLength="112" lengthAdjust="spacingAndGlyphs" fill="#fff">errea</text>`);
const shieldSvg = svgWrap(100, 120,
  `<path d="M6 6 H94 V58 C94 90 70 108 50 116 C30 108 6 90 6 58 Z" fill="#fff"/>` +
  `<path d="M14 14 H86 V58 C86 84 66 99 50 106 C34 99 14 84 14 58 Z" fill="#ce202c"/>` +
  `<path d="M14 14 H50 V106 C34 99 14 84 14 58 Z" fill="#1c46be"/>` +
  `<rect x="10" y="40" width="80" height="28" fill="#fff"/>` +
  `<text x="50" y="62" font-family="Liberation Sans" font-weight="bold" font-size="24" text-anchor="middle" textLength="72" lengthAdjust="spacingAndGlyphs" fill="#1c46be">HABAS</text>`);

const tint = (base, layer, a) => base.map((c, i) => c + (layer[i] - c) * a);

async function main() {
  const L = await loadLuke(), { size, atlas } = L, { P, N } = rasterize(L);
  const decals = {
    frontNumber: { sample: await decal(numberSvg, .1, .13), cx: 0, cy: 1.395, face: 'front' },
    sponsor: { sample: await decal(sponsorSvg, .235, .108), cx: 0, cy: 1.235, face: 'front' },
    maker: { sample: await decal(makerSvg, .08, .066), cx: .115, cy: 1.47, face: 'front' },
    shield: { sample: await decal(shieldSvg, .07, .084), cx: -.115, cy: 1.465, face: 'front' },
    backNumber: { sample: await decal(numberSvg, .17, .22), cx: 0, cy: 1.30, face: 'back' },
    legNumber: { sample: await decal(numberSvg, .065, .084), cx: -.16, cy: .84, face: 'front', minX: -.4, maxX: -.06 },
  };

  // Pass 1: classify kit texels; the V-neck opening joins the skin set so the
  // collar trim follows it.
  const kind = new Uint8Array(size * size); // 0 none, 1 kit, 2 skin
  const skinPts = [];
  for (let i = 0; i < size * size; i++) {
    const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
    if (Number.isNaN(x) || y < KIT.shortsBottom - .08 || y > KIT.jerseyTop + .06) continue;
    const skin = isSkinColor(atlas[i * 3], atlas[i * 3 + 1], atlas[i * 3 + 2]);
    const v = KIT.vNeck, inV = z < 0 && Math.abs(x) < v.halfWidth && y > v.apexY + Math.abs(x) * v.slope;
    if (skin || (inV && y < KIT.jerseyTop) || y >= KIT.jerseyTop || (y > 1.3 && Math.abs(x) > KIT.armholeMaxX)) {
      kind[i] = 2; skinPts.push([x, y, z]);
      if (!skin && inV) kind[i] = 3; // repainted opening
    } else if (y >= KIT.shortsBottom) kind[i] = 1;
  }
  // Baked highlights in the old black kit can read as skin. Keep only skin
  // samples that sit in a mostly-skin 2 cm neighbourhood.
  const all = [];
  for (let i = 0; i < size * size; i++) if (kind[i]) all.push([P[i * 3], P[i * 3 + 1], P[i * 3 + 2], kind[i] !== 1 ? 1 : 0, i]);
  const near = neighbourCounter(all, .02);
  const solidSkin = [];
  for (const q of all) if (q[3]) {
    const [skin, total] = near(q);
    if (skin / total > .6) solidSkin.push(q); else if (kind[q[4]] === 2 && q[1] < KIT.jerseyTop && !(q[1] > 1.3 && Math.abs(q[0]) > KIT.armholeMaxX)) kind[q[4]] = 1;
  }
  const dist = skinDistance(solidSkin, .06);

  // Torso/shorts outer edge per 1 cm band for the side panels.
  const outer = new Map(), seam = new Map();
  const bandOf = (x, y) => Math.round(y * 100) * (x < 0 ? -1 : 1) + (x < 0 ? -1000 : 1000);
  for (let i = 0; i < size * size; i++) if (kind[i] === 1) {
    const b = bandOf(P[i * 3], P[i * 3 + 1]); outer.set(b, Math.max(outer.get(b) ?? 0, Math.abs(P[i * 3])));
  }
  for (let i = 0; i < size * size; i++) if (kind[i] === 1) {
    const b = bandOf(P[i * 3], P[i * 3 + 1]);
    if (outer.get(b) - Math.abs(P[i * 3]) > .03) continue;
    const z = P[i * 3 + 2], r = seam.get(b) || seam.set(b, [z, z]).get(b);
    r[0] = Math.min(r[0], z); r[1] = Math.max(r[1], z);
  }

  const out = Buffer.from(atlas), changed = new Uint8Array(size * size);
  for (let i = 0; i < size * size; i++) {
    if (kind[i] === 3) { out.set(COLORS.skin, i * 3); changed[i] = 1; continue; }
    if (kind[i] !== 1) continue;
    const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2], nz = N[i * 3 + 2] / Math.hypot(N[i * 3], N[i * 3 + 1], N[i * 3 + 2]);
    const shorts = y < KIT.waist, d = dist(x, y, z);
    let c = COLORS.green;
    const sp = KIT.sidePanel, b = bandOf(x, y), r = seam.get(b);
    if (r && y > sp.minY && y < sp.maxY && (outer.get(b) - Math.abs(x)) < sp.depth) {
      const s = Math.abs(z - (r[0] + r[1]) / 2);
      if (s < sp.edge) c = s < sp.white ? COLORS.white : s < sp.blue ? COLORS.blue : COLORS.white;
    }
    if (shorts && y > KIT.waist - KIT.waistband) c = COLORS.white;
    const trim = shorts ? KIT.hem : KIT.collar;
    if (d < trim.white) c = COLORS.white; else if (d < trim.blue) c = COLORS.blue;
    for (const dc of Object.values(decals)) {
      if (dc.face === 'front' ? nz > -.25 || z > 0 : nz < .25 || z < 0) continue;
      if (dc.minX !== undefined && (x < dc.minX || x > dc.maxX)) continue;
      // Front art reads from a viewer facing +Z (their right = -X); back art
      // from behind (their right = +X).
      const s = dc.sample(dc.face === 'front' ? -(x - dc.cx) : x - dc.cx, y - dc.cy);
      if (s) c = tint(c, [s[0] * 255, s[1] * 255, s[2] * 255], s[3]);
    }
    out.set(c.map(Math.round), i * 3); changed[i] = 1;
  }

  // Bleed repainted colour 3 px into empty gutter texels so mip filtering at
  // island seams never picks up the old black kit.
  for (let pass = 0; pass < 3; pass++) {
    const next = changed.slice();
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const i = y * size + x; if (changed[i] || !Number.isNaN(P[i * 3])) continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const j = (y + dy) * size + x + dx;
        if (x + dx < 0 || y + dy < 0 || x + dx >= size || y + dy >= size || !changed[j]) continue;
        out.copyWithin(i * 3, j * 3, j * 3 + 3); next[i] = 1; break;
      }
    }
    changed.set(next);
  }

  // Same file-size budget as the embedded atlas: highest quality that fits.
  let jpeg;
  for (let quality = 90; quality >= 40; quality -= 2) {
    jpeg = await sharp(out, { raw: { width: size, height: size, channels: 3 } }).jpeg({ quality, chromaSubsampling: '4:2:0', mozjpeg: true }).toBuffer();
    if (jpeg.length <= L.sourceBytes) break;
  }
  if (jpeg.length > L.sourceBytes) throw new Error('Kit repaint exceeds the original atlas budget');
  await writeFile(OUT, jpeg);
  console.log(`${OUT}: ${jpeg.length} bytes (source atlas ${L.sourceBytes} bytes)`);
}

await main();
