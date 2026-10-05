// planner.js — 折叠规划纯数学 (无 THREE), 输入世界坐标关键点, 输出两步折叠参数与手臂目标点
// k: {A,B,C,sleeveL,sleeveR,hemL,hemR,shoulderL,shoulderR} 每点 {x,y,z}
import { sideOfLine, foldPointVert } from './fold.js';

const norm2 = (v) => { const l = Math.hypot(v.x, v.z) || 1; return { x: v.x / l, z: v.z / l }; };

export function planFolds(k) {
  const hemMid = { x: (k.hemL.x + k.hemR.x) / 2, y: 0.002, z: (k.hemL.z + k.hemR.z) / 2 };
  const topMid = { x: (k.shoulderL.x + k.shoulderR.x) / 2, z: (k.shoulderL.z + k.shoulderR.z) / 2 };
  const up = norm2({ x: topMid.x - hemMid.x, z: topMid.z - hemMid.z });       // 衫朝向(摆->领)
  const right = norm2({ x: k.sleeveR.x - k.sleeveL.x, z: k.sleeveR.z - k.sleeveL.z }); // 衫横向
  // B步: 沿过 A、方向 up 的直线翻折左侧
  const s1 = sideOfLine(k.A.x, k.A.z, up.x, up.z, k.sleeveL.x, k.sleeveL.z);
  const fold1 = { px: k.A.x, pz: k.A.z, dx: up.x, dz: up.z, foldSign: s1 >= 0 ? 1 : -1, axisH: 0.008, duration: 1.6 };
  const grabTip = { x: k.sleeveL.x, y: 0.002, z: k.sleeveL.z };
  // C步: 下摆两角点的折后位置 -> 下摆中点折后位置 -> 沿过 B、方向 right 的直线翻折下摆侧
  const t1 = (p) => sideOfLine(fold1.px, fold1.pz, fold1.dx, fold1.dz, p.x, p.z) * fold1.foldSign > 0
    ? foldPointVert(fold1.px, fold1.pz, fold1.dx, fold1.dz, fold1.axisH, fold1.foldSign, 1, p.x, p.y, p.z)
    : { ...p };
  const hemLF = t1(k.hemL), hemRF = t1(k.hemR);
  const hemMidF = { x: (hemLF.x + hemRF.x) / 2, y: Math.max(hemLF.y, hemRF.y) + 0.015, z: (hemLF.z + hemRF.z) / 2 };
  const s2 = sideOfLine(k.B.x, k.B.z, right.x, right.z, hemMidF.x, hemMidF.z);
  const fold2 = { px: k.B.x, pz: k.B.z, dx: right.x, dz: right.z, foldSign: s2 >= 0 ? 1 : -1, axisH: 0.014, duration: 1.5 };
  // 按压点: 折痕上往保持侧偏移 (右臂按 C, 左臂按 B)
  const keep1 = norm2({ x: k.C.x - k.sleeveL.x, z: k.C.z - k.sleeveL.z });
  const pressC = { x: k.C.x + keep1.x * 0.05, y: 0.03, z: k.C.z + keep1.z * 0.05 };
  const keep2 = norm2({ x: k.B.x - hemMidF.x, z: k.B.z - hemMidF.z });
  const pressB = { x: k.B.x + keep2.x * 0.05, y: 0.04, z: k.B.z + keep2.z * 0.05 };
  return { fold1, fold2, pressC, pressB, grabTip, grabHem: { ...hemMidF }, hemMidF, up, right, hemMid };
}
