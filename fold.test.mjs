// Node 单测: 折叠几何
import { sideOfLine, foldPointVert } from './fold.js';

const approx = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

// 1. 侧别判定: 折痕 x=0(方向 +z),点(-1,0) 应在 cross>0 侧
const s = sideOfLine(0, 0, 0, 1, -1, 0);
if (!(s > 0)) throw new Error('sideOfLine sign wrong: ' + s);

// 2. 折过去: foldSign=+1 折 cross>0 侧, t=1 时点应镜像到对面并抬到 2*axisH 上方
const p = foldPointVert(0, 0, 0, 1, 0.01, +1, 1, -1, 0.002, 0.3);
if (!(approx(p.x, 1) && approx(p.y, 2 * 0.01 - 0.002) && approx(p.z, 0.3)))
  throw new Error('fold mirror wrong: ' + JSON.stringify(p));

// 3. 轴线上的点不动
const q = foldPointVert(0, 0, 0, 1, 0.01, +1, 0.7, 0, 0.01, 0.5);
if (!(approx(q.x, 0) && approx(q.y, 0.01) && approx(q.z, 0.5)))
  throw new Error('on-axis point moved: ' + JSON.stringify(q));

// 4. t=0 时恒等
const r = foldPointVert(0, 0, 0, 1, 0.01, +1, 0, -0.5, 0.002, -0.2);
if (!(approx(r.x, -0.5) && approx(r.y, 0.002) && approx(r.z, -0.2)))
  throw new Error('t=0 not identity');

// 5. 另一侧 foldSign=-1: 点(1,0.002,0.3) 应镜像到 x=-1
const m = foldPointVert(0, 0, 0, 1, 0.01, -1, 1, 1, 0.002, 0.3);
if (!(approx(m.x, -1) && approx(m.y, 2 * 0.01 - 0.002)))
  throw new Error('foldSign=-1 wrong: ' + JSON.stringify(m));

// 6. 中途应上扬 (t=0.5 时 y 应明显 > 初始)
const mid = foldPointVert(0, 0, 0, 1, 0.01, +1, 0.5, -1, 0.002, 0);
if (!(mid.y > 0.5)) throw new Error('mid-fold should lift high, got y=' + mid.y);

console.log('fold: PASS (6 checks)');
