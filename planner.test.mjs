// Node 集成测试: 随机摆放衣服 -> planFolds -> 折叠几何正确 + 手臂目标点全部可达
import { planFolds } from './planner.js';
import { foldPointVert, sideOfLine } from './fold.js';

const L1 = 0.72, L2 = 0.66, SH = 0.22, TOOL_DROP = 0.17;
const BL = { x: -0.78, z: 0.62 }, BR = { x: 0.78, z: 0.62 };
// 衫局部坐标 (lx, lz=-sy)
const LOCAL = {
  sleeveL: [-0.55, -0.15], sleeveR: [0.55, -0.15],
  shoulderL: [-0.35, -0.31], shoulderR: [0.35, -0.31],
  hemL: [-0.42, 0.31], hemR: [0.42, 0.31],
  A: [-0.245, -0.31], C: [-0.245, 0.31], B: [-0.245, 0],
};
const reach = (b, p, name) => {
  // armTo 把指尖目标上抬 TOOL_DROP 求腕点; 此处同样建模
  const D = Math.hypot(Math.hypot(p.x - b.x, p.z - b.z), p.y + TOOL_DROP - SH);
  if (D > L1 + L2 - 0.02) throw new Error(`${name} unreachable: D=${D.toFixed(3)}`);
  return D;
};
let maxD = 0;
for (let i = 0; i < 200; i++) {
  const yaw = (Math.random() - 0.5) * 0.7, ox = (Math.random() - 0.5) * 0.3, oz = (Math.random() - 0.5) * 0.2;
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const W = ([lx, lz]) => ({ x: ox + lx * cy + lz * sy, y: 0.002, z: oz - lx * sy + lz * cy });
  const k = {};
  for (const key of Object.keys(LOCAL)) k[key] = W(LOCAL[key]);
  const p = planFolds(k);
  // --- 几何正确性 ---
  const tipEnd = foldPointVert(p.fold1.px, p.fold1.pz, p.fold1.dx, p.fold1.dz, p.fold1.axisH, p.fold1.foldSign, 1, p.grabTip.x, p.grabTip.y, p.grabTip.z);
  const s0 = sideOfLine(p.fold1.px, p.fold1.pz, p.fold1.dx, p.fold1.dz, p.grabTip.x, p.grabTip.z);
  const s1 = sideOfLine(p.fold1.px, p.fold1.pz, p.fold1.dx, p.fold1.dz, tipEnd.x, tipEnd.z);
  if (s0 * s1 >= 0) throw new Error(`iter ${i}: tip did not cross crease`);
  if (tipEnd.y < 0.01) throw new Error(`iter ${i}: tip did not land on layer: y=${tipEnd.y}`);
  const hemEnd = foldPointVert(p.fold2.px, p.fold2.pz, p.fold2.dx, p.fold2.dz, p.fold2.axisH, p.fold2.foldSign, 1, p.grabHem.x, p.grabHem.y, p.grabHem.z);
  const h0 = sideOfLine(p.fold2.px, p.fold2.pz, p.fold2.dx, p.fold2.dz, p.grabHem.x, p.grabHem.z);
  const h1 = sideOfLine(p.fold2.px, p.fold2.pz, p.fold2.dx, p.fold2.dz, hemEnd.x, hemEnd.z);
  if (h0 * h1 >= 0) throw new Error(`iter ${i}: hem did not cross crease`);
  if (hemEnd.y < -0.01) throw new Error(`iter ${i}: hem buried under table: y=${hemEnd.y}`);
  // --- 可达性: 左臂(抓袖口/按B), 右臂(按C/抓下摆), 含中途跟踪点 ---
  const tipMid = foldPointVert(p.fold1.px, p.fold1.pz, p.fold1.dx, p.fold1.dz, p.fold1.axisH, p.fold1.foldSign, 0.5, p.grabTip.x, p.grabTip.y, p.grabTip.z);
  const hemMid = foldPointVert(p.fold2.px, p.fold2.pz, p.fold2.dx, p.fold2.dz, p.fold2.axisH, p.fold2.foldSign, 0.5, p.grabHem.x, p.grabHem.y, p.grabHem.z);
  for (const [pt, n] of [[p.grabTip, 'grabTip'], [tipMid, 'tipMid'], [tipEnd, 'tipEnd'], [p.pressB, 'pressB']])
    maxD = Math.max(maxD, reach(BL, pt, `L:${n}@${i}`));
  for (const [pt, n] of [[p.pressC, 'pressC'], [p.grabHem, 'grabHem'], [hemMid, 'hemMid'], [hemEnd, 'hemEnd']])
    maxD = Math.max(maxD, reach(BR, pt, `R:${n}@${i}`));
}
console.log(`planner: 200 random placements, all folds cross creases, all arm targets reachable (max D=${maxD.toFixed(3)} < ${(L1 + L2).toFixed(2)})`);
console.log('planner: PASS');
