// Node 集成测试: 随机摆放 -> 折叠规划 -> 几何正确 + 手臂目标点全部可达
// 覆盖 T恤(2步) 与裤子(左右对折 + tri/bi/none)
import { planFolds, planPantsFolds } from './planner.js';
import { foldPointVert, sideOfLine } from './fold.js';

const L1 = 0.72, L2 = 0.66, SH = 0.22, TOOL_DROP = 0.17;
const BL = { x: -0.78, z: 0.62 }, BR = { x: 0.78, z: 0.62 };
const reach = (b, p, name) => {
  const D = Math.hypot(Math.hypot(p.x - b.x, p.z - b.z), p.y + TOOL_DROP - SH);
  if (D > L1 + L2 - 0.02) throw new Error(`${name} unreachable: D=${D.toFixed(3)}`);
  return D;
};
const ARM = { L: BL, R: BR };
// 折叠后点应越过折痕
const crossed = (f, before, after, name) => {
  const s0 = sideOfLine(f.px, f.pz, f.dx, f.dz, before.x, before.z);
  const s1 = sideOfLine(f.px, f.pz, f.dx, f.dz, after.x, after.z);
  if (s0 * s1 >= 0) throw new Error(`${name} did not cross crease`);
};
const endOf = (f, p) => foldPointVert(f.px, f.pz, f.dx, f.dz, f.axisH, f.foldSign, 1, p.x, p.y, p.z);
const atT = (f, p, t) => foldPointVert(f.px, f.pz, f.dx, f.dz, f.axisH, f.foldSign, t, p.x, p.y, p.z);
let maxD = 0;
const checkStep2 = (step, tag) => {
  const f = step.params;
  const e = endOf(f, step.grab);
  crossed(f, step.grab, e, `${tag}:grab`); // 几何: 折完必须越过折痕
  if (e.y < -0.01) throw new Error(`${tag}: grab buried y=${e.y}`);
  // 手臂只跟踪到 75% (提前松手), 故可达性只查到 0.75
  for (const t of [0, 0.25, 0.5, 0.75]) {
    const pt = atT(f, step.grab, t);
    maxD = Math.max(maxD, reach(ARM[step.grabArm], pt, `${tag}:track@${t}`));
  }
  maxD = Math.max(maxD, reach(ARM[step.pressArm], step.press, `${tag}:press`));
};

// ---------- T恤 ----------
const SHIRT_LOCAL = {
  sleeveL: [-0.55, -0.15], sleeveR: [0.55, -0.15],
  shoulderL: [-0.35, -0.31], shoulderR: [0.35, -0.31],
  hemL: [-0.42, 0.31], hemR: [0.42, 0.31],
  A: [-0.245, -0.31], C: [-0.245, 0.31], B: [-0.245, 0],
};
const place = (LOCAL) => {
  const yaw = (Math.random() - 0.5) * 0.7, ox = (Math.random() - 0.5) * 0.3, oz = (Math.random() - 0.5) * 0.2;
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const k = {};
  for (const key of Object.keys(LOCAL)) {
    const [lx, lz] = LOCAL[key];
    k[key] = { x: ox + lx * cy + lz * sy, y: 0.002, z: oz - lx * sy + lz * cy };
  }
  return k;
};
for (let i = 0; i < 100; i++) {
  const p = planFolds(place(SHIRT_LOCAL));
  if (p.folds.length !== 2) throw new Error('shirt folds != 2');
  checkStep2(p.folds[0], `shirt@${i}:f1`);
  checkStep2(p.folds[1], `shirt@${i}:f2`);
}
console.log('shirt: 100 placements ok');

// ---------- 裤子 ----------
const PANTS_DIMS = {
  'pants-adult-long': { waistHW: 0.26, waistH: 0.14, legLen: 0.92, gap: 0.035, crotchDrop: 0.06, mode: 'tri' },
  'pants-adult-short': { waistHW: 0.26, waistH: 0.14, legLen: 0.40, gap: 0.035, crotchDrop: 0.06, mode: 'bi' },
  'pants-kid-long': { waistHW: 0.18, waistH: 0.12, legLen: 0.60, gap: 0.028, crotchDrop: 0.05, mode: 'bi' },
  'pants-kid-short': { waistHW: 0.18, waistH: 0.12, legLen: 0.26, gap: 0.028, crotchDrop: 0.05, mode: 'none' },
};
const pantsLocal = (d) => {
  const H = d.waistH + d.legLen, top = H / 2, bot = -H / 2;
  const crotchY = top - d.waistH - d.crotchDrop;
  // garment (gx, gy) -> local (lx=gx, lz=-gy)
  const g = (gx, gy) => [gx, -gy];
  return {
    waistL: g(-d.waistHW, top), waistR: g(d.waistHW, top),
    crotch: g(0, crotchY),
    cuffL: g(-d.waistHW, bot), cuffR: g(d.waistHW, bot),
  };
};
const expectFolds = { tri: 3, bi: 2, none: 1 };
for (const [type, d] of Object.entries(PANTS_DIMS)) {
  for (let i = 0; i < 60; i++) {
    const k = place(pantsLocal(d));
    const p = planPantsFolds(k, d.mode);
    if (p.folds.length !== expectFolds[d.mode]) throw new Error(`${type} folds=${p.folds.length}`);
    p.folds.forEach((s, fi) => checkStep2(s, `${type}@${i}:f${fi + 1}`));
    // 语义检查: f1 左腿越过中线; tri 的 f3 把腰部折下来
    const f1e = endOf(p.folds[0].params, k.cuffL);
    if (f1e.y < 0.004) throw new Error(`${type}@${i}: leg not stacked y=${f1e.y}`);
    if (d.mode === 'tri') {
      const f3 = p.folds[2].params;
      const w0 = { x: (k.waistL.x + k.waistR.x) / 2, y: 0.002, z: (k.waistL.z + k.waistR.z) / 2 };
      crossed(f3, p.folds[2].grab, endOf(f3, p.folds[2].grab), `${type}@${i}:tri-foldback`);
    }
  }
  console.log(`${type}: 60 placements ok`);
}
console.log(`planner: PASS (max D=${maxD.toFixed(3)} < ${(L1 + L2).toFixed(2)})`);
