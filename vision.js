// vision.js — 俯视相机图像的关键点检测,纯 JS,不依赖 DOM/THREE,可被 Node 单测
// 输入: {width, height, data} (RGBA, y 朝下)。输出像素坐标 (y 朝下)。

function colorDist2(data, i, r, g, b) {
  const dr = data[i] - r, dg = data[i + 1] - g, db = data[i + 2] - b;
  return dr * dr + dg * dg + db * db;
}

/** 按衣服主体色分割; 返回 Uint8 二值 mask(1=衣服) */
export function segmentShirt(img, rgb, thresh = 85) {
  const { width: w, height: h, data } = img;
  const t2 = thresh * thresh;
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    if (colorDist2(data, i * 4, rgb.r, rgb.g, rgb.b) < t2) mask[i] = 1;
  }
  // 3x3 闭运算,填掉领口/图案造成的小洞
  const closed = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      let any = 0;
      for (let dy = -1; dy <= 1 && !any; dy++)
        for (let dx = -1; dx <= 1; dx++)
          if (mask[(y + dy) * w + x + dx]) { any = 1; break; }
      closed[y * w + x] = any;
    }
  }
  const opened = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      let all = 1;
      for (let dy = -1; dy <= 1 && all; dy++)
        for (let dx = -1; dx <= 1; dx++)
          if (!closed[(y + dy) * w + x + dx]) { all = 0; break; }
      opened[y * w + x] = all;
    }
  }
  return opened;
}

/** 外轮廓: 从图像边界 flood fill 背景,只保留与外部连通背景相邻的前景像素 (排除衣物图案内洞) */
export function outerBoundary(mask, w, h) {
  const seen = new Uint8Array(w * h);
  const stack = [];
  for (let x = 0; x < w; x++) { stack.push(x, (h - 1) * w + x); }
  for (let y = 0; y < h; y++) { stack.push(y * w, y * w + w - 1); }
  while (stack.length) {
    const i = stack.pop();
    if (seen[i] || mask[i]) continue;
    seen[i] = 1;
    const x = i % w, y = (i / w) | 0;
    if (x > 0) stack.push(i - 1); if (x < w - 1) stack.push(i + 1);
    if (y > 0) stack.push(i - w); if (y < h - 1) stack.push(i + w);
  }
  const pts = [];
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (!mask[i]) continue;
      if (seen[i - 1] || seen[i + 1] || seen[i - w] || seen[i + w]) pts.push([x, y]);
    }
  return pts;
}

/** 边界像素: 前景且 4 邻域有背景 */
export function boundaryPixels(mask, w, h) {
  const pts = [];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      if (!mask[y * w + x]) continue;
      if (!mask[y * w + x - 1] || !mask[y * w + x + 1] ||
          !mask[(y - 1) * w + x] || !mask[(y + 1) * w + x]) pts.push([x, y]);
    }
  }
  return pts;
}

/** 凸包 (Andrew 单调链),返回顶点数组 */
export function convexHull(pts) {
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [], upper = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  lower.pop(); upper.pop();
  return lower.concat(upper);
}

/** 点到线段距离 */
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
  let t = L2 ? ((px - ax) * dx + (py - ay) * dy) / L2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/**
 * 凹点聚类: 边界点到凸包的距离,局部极大即腋下/领口凹陷。
 * 返回按深度降序的聚类中心 [{x, y, d}]
 */
export function concaveClusters(contour, hull) {
  const scored = [];
  for (const [x, y] of contour) {
    let m = 1e9;
    for (let i = 0; i < hull.length; i++) {
      const a = hull[i], b = hull[(i + 1) % hull.length];
      const d = segDist(x, y, a[0], a[1], b[0], b[1]);
      if (d < m) m = d;
    }
    if (m > 6) scored.push({ x, y, d: m });
  }
  // 贪心聚类: 按深度降序, 18px 内归入已有类
  scored.sort((a, b) => b.d - a.d);
  const clusters = [];
  for (const p of scored) {
    let c = clusters.find((c) => Math.hypot(c.x - p.x, c.y - p.y) < 18);
    if (!c) { c = { x: 0, y: 0, d: 0, n: 0 }; clusters.push(c); }
    c.x += p.x; c.y += p.y; c.n++; if (p.d > c.d) c.d = p.d;
  }
  return clusters.map((c) => ({ x: c.x / c.n, y: c.y / c.n, d: c.d }))
    .sort((a, b) => b.d - a.d);
}

/** 某列从下往上第一个前景像素的 y(下摆高度) */
export function columnBottomY(mask, w, h, x) {
  x = Math.max(0, Math.min(w - 1, Math.round(x)));
  for (let y = h - 1; y >= 0; y--) if (mask[y * w + x]) return y;
  return h - 1;
}

/** 凸包顶点中靠近某 x 阈值一侧的质心 (袖口外缘中点) */
function centroidNear(hull, bound, fromLeft = true) {
  const qs = hull.filter((q) => (fromLeft ? q[0] <= bound : q[0] >= bound));
  if (!qs.length) return null;
  const sx = qs.reduce((s, q) => s + q[0], 0), sy = qs.reduce((s, q) => s + q[1], 0);
  return [sx / qs.length, sy / qs.length];
}

/**
 * 关键点检测。T 恤凸包顶点 ~= {左右袖口, 左右肩, 左右下摆角}。
 * 返回像素坐标 {sleeveL, sleeveR, shoulderL, shoulderR, hemL, hemR, A, B, C, contour, w, h}
 * A = 肩线中点(领口与肩头之间) —— ABC 叠衣法的 A 点
 * C = A 正下方的下摆点; B = A/C 中点
 */
export function findKeypoints(mask, w, h) {
  const contour = outerBoundary(mask, w, h);
  if (contour.length < 20) return null;
  const hull = convexHull(contour);
  let minX = 1e9, maxX = -1e9, sumX = 0, n = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (mask[y * w + x]) { sumX += x; n++; if (x < minX) minX = x; if (x > maxX) maxX = x; }
  const cx = sumX / Math.max(1, n);
  const span = Math.max(1, maxX - minX);
  const cy = (() => { let s = 0, m = 0; for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (mask[y * w + x]) { s += y; m++; } return s / Math.max(1, m); })();
  const by = (fn, pred) => { let best = null; for (const q of hull) { if (!pred(q)) continue; if (!best || fn(q, best)) best = q; } return best; };
  const sleeveL = centroidNear(hull, Math.min(...hull.map((q) => q[0])) + 6);
  const sleeveR = centroidNear(hull, Math.max(...hull.map((q) => q[0])) - 6, false);
  // 腋下凹点 -> 肩: 肩是腋下内侧(靠近中心)最高的凸包顶点, 天然避开袖子
  const clusters = concaveClusters(contour, hull);
  const pitL = clusters.find((c) => c.x < cx);
  const pitR = clusters.find((c) => c.x > cx);
  const neckDip = clusters.find((c) => Math.abs(c.x - cx) < span * 0.25 && c.y < cy - span * 0.15 && c !== pitL && c !== pitR) || null;
  const shoulderL = pitL ? by((q, b) => q[1] < b[1], (q) => q[0] < cx && q[0] > pitL.x - 8 && q[1] < cy) : null;
  const shoulderR = pitR ? by((q, b) => q[1] < b[1], (q) => q[0] > cx && q[0] < pitR.x + 8 && q[1] < cy) : null;
  const hemL = by((q, b) => q[1] > b[1], (q) => q[0] < cx);
  const hemR = by((q, b) => q[1] > b[1], (q) => q[0] > cx);
  if (!sleeveL || !shoulderL || !shoulderR || !hemL || !hemR) return null;
  // ABC 三点: A 在肩线上(领口与肩头之间),C 为 A 正下方下摆, B 为中点
  const neckX = neckDip ? neckDip.x : cx;
  const A = { x: (shoulderL[0] + neckX) / 2, y: shoulderL[1] };
  const C = { x: A.x, y: columnBottomY(mask, w, h, A.x) };
  const B = { x: (A.x + C.x) / 2, y: (A.y + C.y) / 2 };
  const P = (q) => ({ x: q[0], y: q[1] });
  return {
    sleeveL: P(sleeveL), sleeveR: P(sleeveR),
    shoulderL: P(shoulderL), shoulderR: P(shoulderR),
    hemL: P(hemL), hemR: P(hemR),
    armpitL: pitL ? { x: pitL.x, y: pitL.y } : null,
    armpitR: pitR ? { x: pitR.x, y: pitR.y } : null,
    neckDip: neckDip ? { x: neckDip.x, y: neckDip.y } : null,
    A, B, C, contour, w, h,
  };
}

/**
 * 裤子关键点检测。裤子凸包 ~= {左右腰角, 左右裤脚}, 裆部是中央最深的凹点。
 * 返回像素坐标 {waistL, waistR, crotch, cuffL, cuffR, contour, w, h}
 */
export function findKeypointsPants(mask, w, h) {
  const contour = outerBoundary(mask, w, h);
  if (contour.length < 20) return null;
  const hull = convexHull(contour);
  // 四角: 对角极值
  const waistL = argExtreme(contour, (x, y) => x + y, true);
  const waistR = argExtreme(contour, (x, y) => (w - 1 - x) + y, true);
  const cuffL = argExtreme(contour, (x, y) => x + (h - 1 - y), true);
  const cuffR = argExtreme(contour, (x, y) => (w - 1 - x) + (h - 1 - y), true);
  if (!waistL || !waistR || !cuffL || !cuffR) return null;
  const cx = (waistL[0] + waistR[0]) / 2;
  const waistW = Math.abs(waistR[0] - waistL[0]);
  const waistTopY = Math.min(waistL[1], waistR[1]);
  // 裆顶: 中央区域、腰线下方, y 最小 (最高) 的深凹点 = 裤腿槽的顶端
  let crotchPt = null;
  for (const [x, y] of contour) {
    if (Math.abs(x - cx) > waistW * 0.3 || y < waistTopY + 8) continue;
    let m = 1e9;
    for (let i = 0; i < hull.length; i++) {
      const a = hull[i], b = hull[(i + 1) % hull.length];
      const d = segDist(x, y, a[0], a[1], b[0], b[1]);
      if (d < m) m = d;
    }
    if (m > 10 && (!crotchPt || y < crotchPt[1])) crotchPt = [x, y];
  }
  if (!crotchPt) return null;
  const crotch = { x: crotchPt[0], y: crotchPt[1] };
  const P = (q) => ({ x: q[0], y: q[1] });
  return {
    waistL: P(waistL), waistR: P(waistR),
    crotch,
    cuffL: P(cuffL), cuffR: P(cuffR),
    contour, w, h,
  };
}

/** 輪廓点中使 fn 最小(或最大)的点 */
function argExtreme(contour, fn, findMin = true) {
  let best = null, bestV = findMin ? 1e18 : -1e18;
  for (const [x, y] of contour) {
    const v = fn(x, y);
    if ((findMin && v < bestV) || (!findMin && v > bestV)) { bestV = v; best = [x, y]; }
  }
  return best;
}

/** 填充内部空洞 (与边界不连通的背景)；裆槽开口朝外，不会被填 */
function fillHoles(mask, w, h) {
  const seen = new Uint8Array(w * h);
  const stack = [];
  for (let x = 0; x < w; x++) { stack.push(x, (h - 1) * w + x); }
  for (let y = 0; y < h; y++) { stack.push(y * w, y * w + w - 1); }
  while (stack.length) {
    const i = stack.pop();
    if (seen[i] || mask[i]) continue;
    seen[i] = 1;
    const x = i % w, y = (i / w) | 0;
    if (x > 0) stack.push(i - 1); if (x < w - 1) stack.push(i + 1);
    if (y > 0) stack.push(i - w); if (y < h - 1) stack.push(i + w);
  }
  const out = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) out[i] = mask[i] || !seen[i] ? 1 : 0;
  return out;
}

/**
 * 衣服种类识别: 在衣服下半部逐行扫, 裤子的裆槽是深而连续的纵向缺口
 * (多条水平线都被分成左右两段), T 恤下摆连续。返回 'pants' | 'shirt' | null
 */
export function detectKind(mask, w, h) {
  const fm = fillHoles(mask, w, h); // 填掉衣服图案造成的内洞; 裆槽开口朝外, 不受影响
  let minY = h, maxY = 0, sumY = 0, n = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (fm[y * w + x]) { sumY += y; n++; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  if (n < 100) return null;
  const cy = sumY / n, spanY = Math.max(1, maxY - minY);
  let gapLines = 0;
  // 从上往下扫中部和下半部 (短裤的裆槽在中上部, 长裤的槽深达下半部)
  for (let y = Math.round(minY + spanY * 0.25); y <= maxY; y += 3) {
    let gx0 = w, gx1 = 0;
    for (let x = 0; x < w; x++) if (fm[y * w + x]) { if (x < gx0) gx0 = x; if (x > gx1) gx1 = x; }
    if (gx1 <= gx0) continue;
    const gcx = (gx0 + gx1) / 2, gw = gx1 - gx0;
    const runs = [];
    let start = -1;
    for (let x = 0; x < w; x++) {
      if (fm[y * w + x]) { if (start < 0) start = x; }
      else if (start >= 0) { if (x - start > 4) runs.push([start, x]); start = -1; }
    }
    if (start >= 0 && w - start > 4) runs.push([start, w]);
    for (let i = 1; i < runs.length; i++) {
      const gapC = (runs[i][0] + runs[i - 1][1]) / 2;
      if (runs[i][0] - runs[i - 1][1] > 5 && Math.abs(gapC - gcx) < gw * 0.25) { gapLines++; break; }
    }
  }
  // 裆槽纵深超过衣服高度 20% -> 裤子 (袖子旋转伪影只有几个像素深)
  return (gapLines * 3 > spanY * 0.20) ? 'pants' : 'shirt';
}
