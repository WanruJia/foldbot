// garments.js — 服装建模 (Three.js)。
// 一家四口: 爸爸 / 妈妈 / 大女儿 / 小儿子; 种类: T恤 / 长袖T恤 / 长裤 / 短裤。
// buildGarmentMesh(kindKey, ownerKey) 返回烘焙好摆放的网格, 调用方负责加进场景。
import * as THREE from 'three';

export const OWNERS = {
  dad: { label: '爸爸', binColor: 0x5b7fa6 },
  mom: { label: '妈妈', binColor: 0xc98a9b },
  daughter: { label: '女儿', binColor: 0x9b8ac9 },
  son: { label: '儿子', binColor: 0x7fb8a4 },
};
export const OWNER_KEYS = Object.keys(OWNERS);
export const isAdult = (owner) => owner === 'dad' || owner === 'mom';

export const KINDS = {
  'tee': { kind: 'shirt', sleeve: 'short', label: 'T恤' },
  'tee-long': { kind: 'shirt', sleeve: 'long', label: '长袖T恤' },
  'pants-long': { kind: 'pants', length: 'long', label: '长裤' },
  'pants-short': { kind: 'pants', length: 'short', label: '短裤' },
};
export const KIND_KEYS = Object.keys(KINDS);

// hsl -> rgb (0-255), 与 canvas 纹理 fillStyle 用的基色保持一致
function hslToRgb(h, s, l) {
  s /= 100; l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r, g, b;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return { r: Math.round((r + m) * 255), g: Math.round((g + m) * 255), b: Math.round((b + m) * 255) };
}

const PASTELS = [340, 150, 205, 270, 40, 210, 95]; // 色相环

// 每人身材 -> T恤缩放 (基准 1.24)
const SHIRT_SCALE = { dad: 1.06, mom: 0.92, daughter: 0.78, son: 0.64 };
// 每人身材 -> 裤子尺寸
const PANTS_DIMS = {
  dad: { waistHW: 0.28, waistH: 0.15, gap: 0.038, crotchDrop: 0.065, legLong: 0.95, legShort: 0.42 },
  mom: { waistHW: 0.24, waistH: 0.14, gap: 0.034, crotchDrop: 0.060, legLong: 0.88, legShort: 0.38 },
  daughter: { waistHW: 0.20, waistH: 0.12, gap: 0.030, crotchDrop: 0.055, legLong: 0.62, legShort: 0.28 },
  son: { waistHW: 0.16, waistH: 0.11, gap: 0.026, crotchDrop: 0.050, legLong: 0.55, legShort: 0.24 },
};

/** 裤子折叠方式: 大人长裤三折, 大人短裤/小孩长裤对折, 小孩短裤不折 */
export function pantsFoldMode(owner, length) {
  if (isAdult(owner)) return length === 'long' ? 'tri' : 'bi';
  return length === 'long' ? 'bi' : 'none';
}

// ---------- T 恤纹理 (scale 缩放版型) ----------
const TEX_W = 1024, TEX_H = 832;
function drawShirt(hue, sleeve, scale) {
  const W = 1.24 * scale, H = 1.0 * scale, S = scale;
  const c = document.createElement('canvas'); c.width = TEX_W; c.height = TEX_H;
  const x = c.getContext('2d');
  const TX = (sx) => ((sx + W / 2) / W) * TEX_W;
  const TY = (sy) => (0.5 - sy / H) * TEX_H;
  const base = `hsl(${hue},65%,80%)`, dark = `hsl(${hue},55%,64%)`, deep = `hsl(${hue},50%,52%)`;
  x.fillStyle = base;
  const rect = (x0, x1, y0, y1) => { x.beginPath(); x.rect(TX(x0), TY(y1), TX(x1) - TX(x0), TY(y0) - TY(y1)); x.fill(); };
  const sleeveOut = (sleeve === 'long' ? 0.82 : 0.62) * S;
  const sh = 0.42 * S; // 肩半宽
  rect(-sh, sh, -0.31 * S, 0.31 * S);
  rect(-sleeveOut, -sh, 0.03 * S, 0.27 * S);
  rect(sh, sleeveOut, 0.03 * S, 0.27 * S);
  if (sleeve === 'long') {
    x.fillStyle = dark;
    rect(-sleeveOut, -sleeveOut + 0.07 * S, 0.03 * S, 0.27 * S);
    rect(sleeveOut - 0.07 * S, sleeveOut, 0.03 * S, 0.27 * S);
    x.fillStyle = base;
  }
  x.strokeStyle = dark; x.lineWidth = 4;
  for (const sx of [-sh, sh]) { x.beginPath(); x.moveTo(TX(sx), TY(0.27 * S)); x.lineTo(TX(sx), TY(0.03 * S)); x.stroke(); }
  x.strokeStyle = dark; x.lineWidth = 15; x.lineCap = 'round';
  x.beginPath(); x.moveTo(TX(-0.14 * S), TY(0.305 * S)); x.quadraticCurveTo(TX(0), TY(0.235 * S), TX(0.14 * S), TY(0.305 * S)); x.stroke();
  x.strokeStyle = deep; x.lineWidth = 4;
  x.beginPath(); x.moveTo(TX(-0.14 * S), TY(0.305 * S)); x.quadraticCurveTo(TX(0), TY(0.235 * S), TX(0.14 * S), TY(0.305 * S)); x.stroke();
  const cx = TX(0), cyy = TY(0.03 * S), s = TEX_W / W;
  x.fillStyle = dark;
  x.beginPath(); x.roundRect(cx - 0.085 * s, cyy - 0.065 * s, 0.17 * s, 0.13 * s, 0.04 * s); x.fill();
  x.strokeStyle = deep; x.lineWidth = 5;
  x.beginPath(); x.moveTo(cx, cyy - 0.065 * s); x.lineTo(cx, cyy - 0.10 * s); x.stroke();
  x.fillStyle = deep; x.beginPath(); x.arc(cx, cyy - 0.11 * s, 0.012 * s, 0, 7); x.fill();
  x.fillStyle = '#fff';
  x.beginPath(); x.arc(cx - 0.035 * s, cyy - 0.01 * s, 0.020 * s, 0, 7); x.fill();
  x.beginPath(); x.arc(cx + 0.035 * s, cyy - 0.01 * s, 0.020 * s, 0, 7); x.fill();
  x.fillStyle = '#334';
  x.beginPath(); x.arc(cx - 0.035 * s, cyy - 0.01 * s, 0.009 * s, 0, 7); x.fill();
  x.beginPath(); x.arc(cx + 0.035 * s, cyy - 0.01 * s, 0.009 * s, 0, 7); x.fill();
  x.strokeStyle = '#334'; x.lineWidth = 4;
  x.beginPath(); x.arc(cx, cyy + 0.015 * s, 0.025 * s, 0.3, Math.PI - 0.3); x.stroke();
  const grad = x.createLinearGradient(0, 0, 0, TEX_H);
  grad.addColorStop(0, 'rgba(255,255,255,0.10)'); grad.addColorStop(1, 'rgba(0,0,0,0.05)');
  x.fillStyle = grad; x.fillRect(0, 0, TEX_W, TEX_H);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  return { tex, W, H };
}

// ---------- 裤子 ----------
export function pantsDims(owner, length) {
  const d = PANTS_DIMS[owner];
  return { ...d, legLen: length === 'long' ? d.legLong : d.legShort };
}
export function pantsPolygon(owner, length) {
  const dims = pantsDims(owner, length);
  const { waistHW, waistH, legLen, gap, crotchDrop } = dims;
  const H = waistH + legLen, top = H / 2, waistBot = top - waistH;
  const crotchY = waistBot - crotchDrop, bot = -H / 2;
  return {
    W: waistHW * 2, H, dims,
    pts: [
      [-waistHW, top], [waistHW, top], [waistHW, waistBot], [waistHW, bot],
      [gap, bot], [gap, crotchY], [-gap, crotchY], [-gap, bot],
      [-waistHW, bot], [-waistHW, waistBot],
    ],
  };
}
function drawPants(hue, owner, length) {
  const { W, H, pts, dims } = pantsPolygon(owner, length);
  const TW = 512, TH = Math.round(512 * H / W);
  const c = document.createElement('canvas'); c.width = TW; c.height = TH;
  const x = c.getContext('2d');
  const TX = (gx) => ((gx + W / 2) / W) * TW;
  const TY = (gy) => (0.5 - gy / H) * TH;
  const base = `hsl(${hue},60%,78%)`, dark = `hsl(${hue},50%,62%)`, deep = `hsl(${hue},45%,50%)`;
  x.fillStyle = base;
  x.beginPath();
  pts.forEach(([gx, gy], i) => (i ? x.lineTo(TX(gx), TY(gy)) : x.moveTo(TX(gx), TY(gy))));
  x.closePath(); x.fill();
  const top = H / 2, waistBot = top - dims.waistH, bot = -H / 2;
  x.fillStyle = dark;
  x.beginPath();
  x.moveTo(TX(-dims.waistHW), TY(top)); x.lineTo(TX(dims.waistHW), TY(top));
  x.lineTo(TX(dims.waistHW), TY(waistBot)); x.lineTo(TX(-dims.waistHW), TY(waistBot));
  x.closePath(); x.fill();
  x.strokeStyle = deep; x.lineWidth = 3;
  x.beginPath(); x.moveTo(TX(-dims.waistHW), TY(waistBot)); x.lineTo(TX(dims.waistHW), TY(waistBot)); x.stroke();
  x.strokeStyle = deep; x.lineWidth = 4; x.lineCap = 'round';
  for (const dx of [-0.03, 0.03]) {
    x.beginPath(); x.moveTo(TX(dx), TY(top - 0.02)); x.lineTo(TX(dx * 1.6), TY(top - 0.075)); x.stroke();
  }
  x.strokeStyle = dark; x.lineWidth = 3;
  for (const sgn of [-1, 1]) {
    x.beginPath();
    x.moveTo(TX(sgn * dims.waistHW), TY(waistBot - 0.01));
    x.quadraticCurveTo(TX(sgn * (dims.waistHW - 0.09)), TY(waistBot - 0.02), TX(sgn * (dims.waistHW - 0.10)), TY(waistBot - 0.12));
    x.stroke();
  }
  x.strokeStyle = 'rgba(255,255,255,0.35)'; x.lineWidth = 3;
  for (const sgn of [-1, 1]) {
    const lx = sgn * (dims.gap + dims.waistHW) / 2;
    x.beginPath(); x.moveTo(TX(lx), TY(waistBot - 0.05)); x.lineTo(TX(lx), TY(bot + 0.06)); x.stroke();
  }
  x.fillStyle = dark;
  for (const sgn of [-1, 1]) {
    x.beginPath();
    x.moveTo(TX(sgn * dims.waistHW), TY(bot)); x.lineTo(TX(sgn * dims.gap), TY(bot));
    x.lineTo(TX(sgn * dims.gap), TY(bot + 0.045)); x.lineTo(TX(sgn * dims.waistHW), TY(bot + 0.045));
    x.closePath(); x.fill();
  }
  const grad = x.createLinearGradient(0, 0, 0, TH);
  grad.addColorStop(0, 'rgba(255,255,255,0.10)'); grad.addColorStop(1, 'rgba(0,0,0,0.06)');
  x.fillStyle = grad; x.fillRect(0, 0, TW, TH);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  return { tex, W, H };
}

function bakePlacement(geo, ox, oz, yaw) {
  const pos = geo.attributes.position;
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  for (let i = 0; i < pos.count; i++) {
    const px = pos.getX(i), pz = -pos.getY(i);
    pos.setXYZ(i, ox + px * cy + pz * sy, 0.002, oz - px * sy + pz * cy);
  }
  geo.computeVertexNormals();
  return new Float32Array(pos.array);
}

/**
 * 建一件衣服。kindKey: 'tee'|'tee-long'|'pants-long'|'pants-short'|'random';
 * ownerKey: 'dad'|'mom'|'daughter'|'son'|'random'。
 * at: 可选 {x, z} 生成位置 (默认随机)。
 * 返回 {mesh, base, W, H, kind, kindKey, owner, rgb, yaw, ox, oz}
 */
export function buildGarmentMesh(kindKey, ownerKey, at = null) {
  const kind = kindKey === 'random' ? KIND_KEYS[(Math.random() * KIND_KEYS.length) | 0] : kindKey;
  const owner = ownerKey === 'random' ? OWNER_KEYS[(Math.random() * OWNER_KEYS.length) | 0] : ownerKey;
  const kd = KINDS[kind];
  const hue = PASTELS[(Math.random() * PASTELS.length) | 0];
  // 分割参考色 = 纹理真实基色 (T恤 hsl(65%,80%), 裤子 hsl(60%,78%))
  const rgb = kd.kind === 'shirt' ? hslToRgb(hue, 65, 80) : hslToRgb(hue, 60, 78);
  let drawn, seg;
  if (kd.kind === 'shirt') {
    drawn = drawShirt(hue, kd.sleeve, SHIRT_SCALE[owner]);
    seg = [Math.round(46 * drawn.W / 1.24), 44];
  } else {
    drawn = drawPants(hue, owner, kd.length);
    seg = [Math.max(20, Math.round(56 * drawn.W)), Math.max(24, Math.round(56 * drawn.H))];
  }
  const geo = new THREE.PlaneGeometry(drawn.W, drawn.H, seg[0], seg[1]);
  const yaw = (Math.random() - 0.5) * 0.7;
  const ox = at ? at.x + (Math.random() - 0.5) * 0.12 : (Math.random() - 0.5) * 0.3;
  const oz = at ? at.z + (Math.random() - 0.5) * 0.1 : (Math.random() - 0.5) * 0.2;
  const base = bakePlacement(geo, ox, oz, yaw);
  const mat = new THREE.MeshStandardMaterial({
    map: drawn.tex, transparent: true, alphaTest: 0.45,
    side: THREE.DoubleSide, roughness: 0.9, metalness: 0,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.frustumCulled = false; // 顶点烘焙到世界坐标后, 包围球可能过期, 直接禁用剔除
  return { mesh, base, W: drawn.W, H: drawn.H, kind: kd.kind, kindKey: kind, owner, rgb, yaw, ox, oz };
}

export function disposeGarmentMesh(g) {
  if (!g) return;
  g.mesh.geometry.dispose();
  g.mesh.material.map.dispose();
  g.mesh.material.dispose();
}
