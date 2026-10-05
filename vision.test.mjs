// Node 单测: 合成 T 恤(旋转 15°)上的关键点检测
import { segmentShirt, findKeypoints, findKeypointsPants, detectKind } from './vision.js';

const W = 320, H = 320, CX = 160, CY = 160;
// T 恤多边形 (y 朝下,未旋转时)
const poly = [
  [-42, 129], [42, 129], [42, 133], [62, 133], [62, 157], [42, 157],
  [42, 191], [-42, 191], [-42, 157], [-62, 157], [-62, 133], [-42, 133],
].map(([x, y]) => [x + CX, y]);
const ANG = 15 * Math.PI / 180;
const rot = ([x, y]) => {
  const dx = x - CX, dy = y - CY;
  return [CX + dx * Math.cos(ANG) - dy * Math.sin(ANG), CY + dx * Math.sin(ANG) + dy * Math.cos(ANG)];
};
const rpoly = poly.map(rot);

function inPoly(x, y, p) {
  let inside = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, yi] = p[i], [xj, yj] = p[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const SHIRT = { r: 255, g: 217, b: 232 };   // 与 app 中 pastel 粉一致
const TABLE = { r: 207, g: 168, b: 120 };
const data = new Uint8ClampedArray(W * H * 4);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const c = inPoly(x + 0.5, y + 0.5, rpoly) ? SHIRT : TABLE;
    const i = (y * W + x) * 4;
    data[i] = c.r; data[i + 1] = c.g; data[i + 2] = c.b; data[i + 3] = 255;
  }
}
const mask = segmentShirt({ width: W, height: H, data }, SHIRT);
const kp = findKeypoints(mask, W, H);
if (!kp) throw new Error('findKeypoints returned null');

// 期望值 (未旋转 -> 旋转)。注意 A/C/B 在旋转帧内按检测算法的定义计算
// (旋转与"取中点"不可交换,故不能直接 rot 未旋转的 A/C)
const exp = {};
{
  const e = {
    shoulderL: [CX - 42, 129], sleeveL: [CX - 62, 145], hemL: [CX - 42, 191],
  };
  for (const k of Object.keys(e)) exp[k] = rot(e[k]);
  const SA = exp.shoulderL;
  exp.A = [(SA[0] + CX) / 2, SA[1]];                       // 肩角与中心的中点
  const H0 = rot([CX - 42, 191]), H1 = rot([CX + 42, 191]); // 下摆边线段
  const t = (exp.A[0] - H0[0]) / (H1[0] - H0[0]);
  exp.C = [exp.A[0], H0[1] + t * (H1[1] - H0[1])];          // A.x 列的下摆点
  exp.B = [(exp.A[0] + exp.C[0]) / 2, (exp.A[1] + exp.C[1]) / 2];
}
const close = (got, want, tol, name) => {
  const d = Math.hypot(got.x - want[0], got.y - want[1]);
  if (d > tol) throw new Error(`${name} off by ${d.toFixed(1)}px (got ${got.x.toFixed(1)},${got.y.toFixed(1)} want ${want[0].toFixed(1)},${want[1].toFixed(1)})`);
  console.log(`  ${name}: err ${d.toFixed(1)}px ok`);
};
console.log('vision: 15° rotated shirt');
close(kp.shoulderL, exp.shoulderL, 7, 'shoulderL');
close(kp.sleeveL, exp.sleeveL, 7, 'sleeveL');
// 下摆: 旋转后"角点"概念模糊,改为断言落在下摆边线段上(点到线段距离)
{
  const seg = [rot([CX - 42, 191]), rot([CX + 42, 191])];
  const segDist = (p) => {
    const [ax, ay] = seg[0], [bx, by] = seg[1];
    const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
    let t = ((p.x - ax) * dx + (p.y - ay) * dy) / L2; t = Math.max(0, Math.min(1, t));
    return Math.hypot(p.x - (ax + t * dx), p.y - (ay + t * dy));
  };
  for (const [name, p] of [['hemL', kp.hemL], ['hemR', kp.hemR]]) {
    const d = segDist(p);
    if (d > 8) throw new Error(`${name} not on hem edge: ${d.toFixed(1)}px`);
    console.log(`  ${name}: on hem edge (dist ${d.toFixed(1)}px) ok`);
  }
}
close(kp.A, exp.A, 7, 'A');
close(kp.C, exp.C, 9, 'C');
close(kp.B, exp.B, 8, 'B');
// 对称性: T 恤是左右镜像对称,旋转 15° 后对称轴为过中心方向 u 的直线
// (注意是镜像对称,不是中心点对称)
const sym = (L, R, name) => {
  const ux = Math.sin(ANG), uy = -Math.cos(ANG); // 旋转后的"上"方向
  const project = (p) => {
    const dx = p.x - CX, dy = p.y - CY, t = dx * ux + dy * uy;
    return { x: CX + t * ux, y: CY + t * uy };
  };
  const pl = project(L), pr = project(R);
  const d = Math.hypot(pl.x - pr.x, pl.y - pr.y); // 镜像点在对称轴上的投影应重合
  if (d > 7) throw new Error(`${name} not mirror-symmetric: ${d.toFixed(1)}px`);
  console.log(`  ${name}: mirror-symmetric ok`);
};
sym(kp.sleeveL, kp.sleeveR, 'sleeves'); sym(kp.hemL, kp.hemR, 'hem');
console.log('vision: shirt PASS');

// ---------- 裤子 ----------
console.log('vision: 15° rotated pants');
const P = { waistHW: 48, waistH: 26, legLen: 170, gap: 7, crotchDrop: 12 };
const pTop = CY - (P.waistH + P.legLen) / 2, pWaistBot = pTop + P.waistH;
const pCrotchY = pWaistBot + P.crotchDrop, pBot = CY + (P.waistH + P.legLen) / 2;
const pantsPoly = [
  [-P.waistHW, pTop], [P.waistHW, pTop], [P.waistHW, pWaistBot], [P.waistHW, pBot],
  [P.gap, pBot], [P.gap, pCrotchY], [-P.gap, pCrotchY], [-P.gap, pBot],
  [-P.waistHW, pBot], [-P.waistHW, pWaistBot],
].map(([x, y]) => [x + CX, y]);
const rpantsPoly = pantsPoly.map(rot);
const pdata = new Uint8ClampedArray(W * H * 4);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const c = inPoly(x + 0.5, y + 0.5, rpantsPoly) ? SHIRT : TABLE;
    const i = (y * W + x) * 4;
    pdata[i] = c.r; pdata[i + 1] = c.g; pdata[i + 2] = c.b; pdata[i + 3] = 255;
  }
}
const pmask = segmentShirt({ width: W, height: H, data: pdata }, SHIRT);
if (detectKind(pmask, W, H) !== 'pants') throw new Error('detectKind(pants) != pants');
console.log('  detectKind: pants ok');
if (detectKind(mask, W, H) !== 'shirt') throw new Error('detectKind(shirt) != shirt');
console.log('  detectKind: shirt ok');
const pkp = findKeypointsPants(pmask, W, H);
if (!pkp) throw new Error('findKeypointsPants returned null');
close(pkp.waistL, rot([CX - P.waistHW, pTop]), 7, 'waistL');
close(pkp.waistR, rot([CX + P.waistHW, pTop]), 7, 'waistR');
close(pkp.cuffL, rot([CX - P.waistHW, pBot]), 8, 'cuffL');
close(pkp.cuffR, rot([CX + P.waistHW, pBot]), 8, 'cuffR');
close(pkp.crotch, rot([CX, pCrotchY]), 10, 'crotch');
console.log('vision: pants PASS');
console.log('vision: PASS');
