// kinematics.js — 双臂机器人解析 IK / FK，纯数学，不依赖 THREE，可被 Node 单测
// 坐标约定: Y 朝上。yawGroup 绕 Y 旋转; shoulder/elbow 绕 X 旋转。
// rotation.x = a 时, 本地 (0,L,0) -> (0, L*cos a, L*sin a)。

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * 解析 IK: 求让腕点到达世界目标 (tx,ty,tz) 的关节角
 * @returns {yaw, a1, a2}  (a1: 肩绕X, a2: 肘绕X 相对角)
 */
export function ik(bx, bz, shoulderH, L1, L2, tx, ty, tz) {
  const yaw = Math.atan2(tx - bx, tz - bz);
  const r = Math.hypot(tx - bx, tz - bz);
  const dy = ty - shoulderH;
  const D = clamp(Math.hypot(r, dy), Math.abs(L1 - L2) + 1e-6, L1 + L2 - 1e-6);
  const gamma = Math.atan2(r, dy); // 目标方向与 +Y 的夹角(往 +Z 偏)
  const S = Math.acos(clamp((L1 * L1 + D * D - L2 * L2) / (2 * L1 * D), -1, 1));
  const E = Math.acos(clamp((L1 * L1 + L2 * L2 - D * D) / (2 * L1 * L2), -1, 1));
  const a1 = gamma - S;   // 肘外张分支(适合桌面按压)
  const a2 = Math.PI - E; // 相对角
  return { yaw, a1, a2 };
}

/**
 * 正运动学: 关节角 -> 腕点世界坐标
 */
export function fk(bx, bz, shoulderH, L1, L2, yaw, a1, a2) {
  const a12 = a1 + a2;
  const wy = L1 * Math.cos(a1) + L2 * Math.cos(a12);
  const wz = L1 * Math.sin(a1) + L2 * Math.sin(a12);
  return {
    x: bx + wz * Math.sin(yaw),
    y: shoulderH + wy,
    z: bz + wz * Math.cos(yaw),
  };
}
