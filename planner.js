// planner.js — 折叠规划纯数学 (无 THREE)。
// 输入世界坐标关键点, 输出统一格式的折叠计划:
// plan = { folds: [step...], markers: [{name,x,y,z,color,label}], up, right }
// step = { params:{px,pz,dx,dz,foldSign,axisH,duration}, label, status,
//          grab:{x,y,z}, grabArm:'L'|'R', press:{x,y,z}, pressArm:'L'|'R',
//          track?:{name, p} }  // track: 随布移动的标记
import { sideOfLine, foldPointVert } from './fold.js';

const norm2 = (v) => { const l = Math.hypot(v.x, v.z) || 1; return { x: v.x / l, z: v.z / l }; };
// 某折叠完成后一点的位置 (t=1)
const afterFold = (f, p) => sideOfLine(f.px, f.pz, f.dx, f.dz, p.x, p.z) * f.foldSign > 0
  ? foldPointVert(f.px, f.pz, f.dx, f.dz, f.axisH, f.foldSign, 1, p.x, p.y, p.z)
  : { ...p };

/** T恤: B步沿 ABC 线翻折左侧, C步下摆上翻对折 */
export function planFolds(k) {
  const hemMid = { x: (k.hemL.x + k.hemR.x) / 2, y: 0.002, z: (k.hemL.z + k.hemR.z) / 2 };
  const topMid = { x: (k.shoulderL.x + k.shoulderR.x) / 2, z: (k.shoulderL.z + k.shoulderR.z) / 2 };
  const up = norm2({ x: topMid.x - hemMid.x, z: topMid.z - hemMid.z });
  const right = norm2({ x: k.sleeveR.x - k.sleeveL.x, z: k.sleeveR.z - k.sleeveL.z });
  const s1 = sideOfLine(k.A.x, k.A.z, up.x, up.z, k.sleeveL.x, k.sleeveL.z);
  const fold1 = { px: k.A.x, pz: k.A.z, dx: up.x, dz: up.z, foldSign: s1 >= 0 ? 1 : -1, axisH: 0.008, duration: 1.6 };
  const grabTip = { x: k.sleeveL.x, y: 0.002, z: k.sleeveL.z };
  const hemLF = afterFold(fold1, k.hemL), hemRF = afterFold(fold1, k.hemR);
  const hemMidF = { x: (hemLF.x + hemRF.x) / 2, y: Math.max(hemLF.y, hemRF.y) + 0.015, z: (hemLF.z + hemRF.z) / 2 };
  const s2 = sideOfLine(k.B.x, k.B.z, right.x, right.z, hemMidF.x, hemMidF.z);
  const fold2 = { px: k.B.x, pz: k.B.z, dx: right.x, dz: right.z, foldSign: s2 >= 0 ? 1 : -1, axisH: 0.014, duration: 1.5 };
  const keep1 = norm2({ x: k.C.x - k.sleeveL.x, z: k.C.z - k.sleeveL.z });
  const pressC = { x: k.C.x + keep1.x * 0.05, y: 0.03, z: k.C.z + keep1.z * 0.05 };
  const keep2 = norm2({ x: k.B.x - hemMidF.x, z: k.B.z - hemMidF.z });
  const pressB = { x: k.B.x + keep2.x * 0.05, y: 0.04, z: k.B.z + keep2.z * 0.05 };
  const folds = [
    {
      params: fold1, label: '翻折', status: 'B·翻折 — 左臂抓袖口, 沿 ABC 线翻折',
      grab: grabTip, grabArm: 'L', press: pressC, pressArm: 'R',
    },
    {
      params: fold2, label: '对折', status: 'C·对折 — 右臂抓下摆, 上翻对折',
      grab: { ...hemMidF }, grabArm: 'R', press: pressB, pressArm: 'L',
      track: { name: 'C', p: { x: k.C.x, y: 0.002, z: k.C.z } },
    },
  ];
  const markers = [
    { name: 'A', x: k.A.x, y: k.A.y, z: k.A.z, color: '#ff5252', label: 'A' },
    { name: 'B', x: k.B.x, y: k.B.y, z: k.B.z, color: '#ff9f1c', label: 'B' },
    { name: 'C', x: k.C.x, y: k.C.y, z: k.C.z, color: '#3a86ff', label: 'C' },
  ];
  return { folds, markers, up, right };
}

/**
 * 按关键点测量的尺寸判定衣服归属 (爸爸/妈妈/女儿/儿子)。
 * kind: 'shirt'|'pants'; k: 世界坐标关键点。
 * 返回 {owner, metric, metricName}
 */
export function classifyOwner(kind, k) {  let m, name;
  if (kind === 'shirt') {
    m = Math.hypot(k.shoulderR.x - k.shoulderL.x, k.shoulderR.z - k.shoulderL.z);
    name = '肩宽';
    if (m >= 0.69) return { owner: 'dad', metric: m, metricName: name };
    if (m >= 0.595) return { owner: 'mom', metric: m, metricName: name };
    if (m >= 0.50) return { owner: 'daughter', metric: m, metricName: name };
    return { owner: 'son', metric: m, metricName: name };
  }
  m = Math.hypot(k.waistR.x - k.waistL.x, k.waistR.z - k.waistL.z);
  name = '腰宽';
  if (m >= 0.52) return { owner: 'dad', metric: m, metricName: name };
  if (m >= 0.44) return { owner: 'mom', metric: m, metricName: name };
  if (m >= 0.36) return { owner: 'daughter', metric: m, metricName: name };
  return { owner: 'son', metric: m, metricName: name };
}

/**
 * 裤子: 先左右对折(左腿折向右), 再按长度折叠:
 *   tri  (成人长裤): 下三分之一上折, 上三分之一回折
 *   bi   (成人短裤/儿童长裤): 对折
 *   none (儿童短裤): 不折
 * k: {waistL, waistR, crotch, cuffL, cuffR} 世界坐标
 */
export function planPantsFolds(k, mode) {
  const waistC = { x: (k.waistL.x + k.waistR.x) / 2, y: 0.002, z: (k.waistL.z + k.waistR.z) / 2 };
  const cuffC = { x: (k.cuffL.x + k.cuffR.x) / 2, y: 0.002, z: (k.cuffL.z + k.cuffR.z) / 2 };
  const up = norm2({ x: waistC.x - cuffC.x, z: waistC.z - cuffC.z }); // 指向腰
  const right = norm2({ x: k.cuffR.x - k.cuffL.x, z: k.cuffR.z - k.cuffL.z });
  const folds = [];
  // B步: 左右对折
  const s1 = sideOfLine(waistC.x, waistC.z, up.x, up.z, k.cuffL.x, k.cuffL.z);
  const f1 = { px: waistC.x, pz: waistC.z, dx: up.x, dz: up.z, foldSign: s1 >= 0 ? 1 : -1, axisH: 0.006, duration: 1.6 };
  const keepSide1 = norm2({ x: k.cuffR.x - k.cuffL.x, z: k.cuffR.z - k.cuffL.z });
  const cuffL0 = { x: k.cuffL.x, y: 0.002, z: k.cuffL.z };
  // 按压点: 折痕中部偏裤脚处, 往保持侧偏移 (右臂按压, 恒可达)
  const midC = {
    x: waistC.x + (cuffC.x - waistC.x) * 0.55, y: 0.03,
    z: waistC.z + (cuffC.z - waistC.z) * 0.55,
  };
  folds.push({
    params: f1, label: '对折', status: 'B·对折 — 左臂抓裤脚, 右臂按住中部, 左右对折',
    grab: { ...cuffL0 }, grabArm: 'L',
    press: { x: midC.x + keepSide1.x * 0.045, y: 0.03, z: midC.z + keepSide1.z * 0.045 }, pressArm: 'R',
    track: { name: 'cuff', p: { ...cuffL0 } },
  });
  const cuffLF = afterFold(f1, k.cuffL);
  const waistLF = afterFold(f1, k.waistL);
  const waistMidF = { x: (waistLF.x + k.waistR.x) / 2, y: 0.002, z: (waistLF.z + k.waistR.z) / 2 };
  const cuffMidF = { x: (cuffLF.x + k.cuffR.x) / 2, y: Math.max(cuffLF.y, k.cuffR.y) + 0.012, z: (cuffLF.z + k.cuffR.z) / 2 };
  const markers = [
    { name: 'waist', x: waistC.x, y: waistC.y, z: waistC.z, color: '#ff5252', label: '腰' },
    { name: 'crotch', x: k.crotch.x, y: 0.002, z: k.crotch.z, color: '#ff9f1c', label: '裆' },
    { name: 'cuff', x: k.cuffL.x, y: 0.002, z: k.cuffL.z, color: '#3a86ff', label: '裤脚' },
  ];
  if (mode !== 'none') {
    // C步: 裤脚上翻 (bi: 对折; tri: 下三分之一上折)
    const frac = mode === 'tri' ? 1 / 3 : 1 / 2;
    const cp = {
      x: cuffMidF.x + (waistMidF.x - cuffMidF.x) * frac, y: 0.012,
      z: cuffMidF.z + (waistMidF.z - cuffMidF.z) * frac,
    };
    const s2 = sideOfLine(cp.x, cp.z, right.x, right.z, cuffMidF.x, cuffMidF.z);
    const f2 = { px: cp.x, pz: cp.z, dx: right.x, dz: right.z, foldSign: s2 >= 0 ? 1 : -1, axisH: 0.012, duration: 1.5 };
    const keep2 = norm2({ x: waistMidF.x - cp.x, z: waistMidF.z - cp.z });
    // 按压点: 折痕上往保持侧偏移, 再往左臂方向移半个半宽, 保证左臂够得着
    const foldedHW = Math.abs(k.waistR.x - k.waistL.x) / 2;
    const press2 = {
      x: cp.x - right.x * foldedHW * 0.5 + keep2.x * 0.04, y: 0.035,
      z: cp.z - right.z * foldedHW * 0.5 + keep2.z * 0.04,
    };
    folds.push({
      params: f2, label: mode === 'tri' ? '三折①' : '折叠',
      status: mode === 'tri' ? 'C·三折 — 右臂抓裤脚, 下三分之一上折' : 'C·折叠 — 右臂抓裤脚, 上翻对折',
      grab: { ...cuffMidF }, grabArm: 'R', press: press2, pressArm: 'L',
      track: { name: 'cuff', p: { ...cuffLF } },
    });
    if (mode === 'tri') {
      // D步: 上三分之一回折 (抓腰身中部, 避免手臂过伸)
      const cpB = {
        x: cuffMidF.x + (waistMidF.x - cuffMidF.x) * (2 / 3), y: 0.018,
        z: cuffMidF.z + (waistMidF.z - cuffMidF.z) * (2 / 3),
      };
      const s3 = sideOfLine(cpB.x, cpB.z, right.x, right.z, waistMidF.x, waistMidF.z);
      const f3 = { px: cpB.x, pz: cpB.z, dx: right.x, dz: right.z, foldSign: s3 >= 0 ? 1 : -1, axisH: 0.018, duration: 1.5 };
      const grabB = {
        x: waistMidF.x + (cpB.x - waistMidF.x) * 0.5, y: 0.002,
        z: waistMidF.z + (cpB.z - waistMidF.z) * 0.5,
      };
      const keep3 = norm2({ x: cpB.x - waistMidF.x, z: cpB.z - waistMidF.z }); // 指向中部(保持侧)
      // 按压点取折痕偏左一段, 让左臂够得着
      const press3 = {
        x: cpB.x - right.x * 0.18 + keep3.x * 0.04, y: 0.04,
        z: cpB.z - right.z * 0.18 + keep3.z * 0.04,
      };
      folds.push({
        params: f3, label: '三折②', status: 'D·三折 — 右臂抓腰身, 上三分之一回折',
        grab: grabB, grabArm: 'R', press: press3, pressArm: 'L',
      });
    }
  }
  return { folds, markers, up, right };
}

/**
 * 从裤子关键点判断长/短裤: 腰到脚的长度 vs 腰宽。
 * k: {waistL, waistR, crotch, cuffL, cuffR} 世界坐标。返回 'long'|'short'
 */
export function detectPantsLength(k) {
  const waistC = { x: (k.waistL.x + k.waistR.x) / 2, z: (k.waistL.z + k.waistR.z) / 2 };
  const cuffC = { x: (k.cuffL.x + k.cuffR.x) / 2, z: (k.cuffL.z + k.cuffR.z) / 2 };
  const H = Math.hypot(cuffC.x - waistC.x, cuffC.z - waistC.z);
  const Wd = Math.hypot(k.waistR.x - k.waistL.x, k.waistR.z - k.waistL.z);
  return (H / Math.max(1e-6, Wd) > 1.4) ? 'long' : 'short';
}
