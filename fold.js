// fold.js — 折叠几何,纯数学(Rodrigues 旋转公式),不依赖 THREE,可被 Node 单测
// 世界坐标: Y 朝上。折痕是水平直线: 过点 P=(px, axisH, pz),方向为水平单位向量 (dx, dz)。

/**
 * 点 (x,z) 在折痕线(含方向 dx,dz,过 px,pz)的哪一侧
 * @returns cross = dx*(z-pz) - dz*(x-px) 的符号
 */
export function sideOfLine(px, pz, dx, dz, x, z) {
  return dx * (z - pz) - dz * (x - px);
}

/**
 * 点 q 绕过 p、方向为单位向量 a 的轴旋转 theta (右手定则)
 */
export function rotPoint(px, py, pz, ax, ay, az, qx, qy, qz, theta) {
  const c = Math.cos(theta), s = Math.sin(theta);
  const vx = qx - px, vy = qy - py, vz = qz - pz;
  // Rodrigues: v' = v c + (a x v) s + a (a.v)(1-c)
  const dot = ax * vx + ay * vy + az * vz;
  const cx = ay * vz - az * vy, cy = az * vx - ax * vz, cz = ax * vy - ay * vx;
  const k = 1 - c;
  return {
    x: px + vx * c + cx * s + ax * dot * k,
    y: py + vy * c + cy * s + ay * dot * k,
    z: pz + vz * c + cz * s + az * dot * k,
  };
}

/**
 * 折叠一步中某顶点的目标位置
 * @param foldSign +1 折叠 cross>0 一侧, -1 折叠 cross<0 一侧
 * @param t 0..1 进度(已做 easing)
 * 推导: 对 cross>0 侧用 theta=-PI*t 可使其上翻并盖过去(见 fold.test.mjs)
 */
export function foldPointVert(px, pz, dx, dz, axisH, foldSign, t, x, y, z) {
  const theta = -foldSign * Math.PI * t;
  const len = Math.hypot(dx, dz) || 1;
  return rotPoint(px, axisH, pz, dx / len, 0, dz / len, x, y, z, theta);
}

export const easeInOutCubic = (t) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
