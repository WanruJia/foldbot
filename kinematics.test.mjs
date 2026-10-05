// Node 单测: IK/FK 往返 (+ 不可达目标的优雅钳制)
import { ik, fk } from './kinematics.js';

const L1 = 0.62, L2 = 0.55, SH = 0.17, BX = 1.05, BZ = 0.35;
let maxErr = 0;
for (let i = 0; i < 500; i++) {
  const yawT = (Math.random() - 0.5) * Math.PI;
  const r = 0.15 + Math.random() * 0.6;          // D <= hypot(.75,.55)=0.93 < L1+L2
  const dy = -0.55 + Math.random() * 0.95;
  const tx = BX + r * Math.sin(yawT), tz = BZ + r * Math.cos(yawT), ty = SH + dy;
  const { yaw, a1, a2 } = ik(BX, BZ, SH, L1, L2, tx, ty, tz);
  const p = fk(BX, BZ, SH, L1, L2, yaw, a1, a2);
  const err = Math.hypot(p.x - tx, p.y - ty, p.z - tz);
  if (err > maxErr) maxErr = err;
  if (!(a2 >= -1e-9 && a2 <= Math.PI + 1e-9)) throw new Error('a2 out of range: ' + a2);
}
console.log('kinematics: 500 round-trips, max err =', maxErr.toExponential(2));
if (maxErr > 1e-9) throw new Error('IK/FK round-trip FAILED');

// 不可达目标: 腕点应落在肩到目标方向的最远可达处
{
  const tx = BX + 3, ty = SH, tz = BZ; // 3 米外,够不着
  const { yaw, a1, a2 } = ik(BX, BZ, SH, L1, L2, tx, ty, tz);
  const p = fk(BX, BZ, SH, L1, L2, yaw, a1, a2);
  const reach = Math.hypot(p.x - BX, p.y - SH, p.z - BZ);
  if (Math.abs(reach - (L1 + L2)) > 1e-3) throw new Error('unreachable clamp wrong: ' + reach);
  console.log('kinematics: unreachable-target clamp ok, reach =', reach.toFixed(4));
}
console.log('kinematics: PASS');
