// app.js — FoldBot 虚拟叠衣机器人 (Three.js)
// 流程: A·感知(俯视相机 + vision.js 关键点检测) -> B·翻折(沿 ABC 线) -> C·对折
import * as THREE from 'three';
import { ik } from './kinematics.js';
import { sideOfLine, foldPointVert, easeInOutCubic } from './fold.js';
import { segmentShirt, findKeypoints } from './vision.js';
import { planFolds } from './planner.js';

// ---------- 常量 ----------
const L1 = 0.72, L2 = 0.66, SHOULDER_H = 0.22;
const TOOL_DROP = 0.17; // 腕点到指尖的垂直距离 (夹爪竖直朝下)
const ARM_L_BASE = { x: -0.78, z: 0.62 }, ARM_R_BASE = { x: 0.78, z: 0.62 };
const HOME_L = { x: -0.45, y: 0.55, z: 0.35 }, HOME_R = { x: 0.45, y: 0.55, z: 0.35 };
const CAP = 320, CAP_S = 1.75; // 俯视相机分辨率 / 视野边长(世界单位)
const SHIRT_W = 1.24, SHIRT_H = 1.0;

// ---------- 渲染器 / 场景 ----------
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xf6f1ea);
scene.fog = new THREE.Fog(0xf6f1ea, 9, 18);

const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
camera.position.set(2.3, 2.5, 3.4);
camera.lookAt(0, -0.05, 0);

scene.add(new THREE.HemisphereLight(0xfff6ea, 0xd8c9b8, 0.85));
const key = new THREE.DirectionalLight(0xffffff, 1.5);
key.position.set(3, 5, 2);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.left = -2.5; key.shadow.camera.right = 2.5;
key.shadow.camera.top = 2.5; key.shadow.camera.bottom = -2.5;
key.shadow.bias = -0.0005;
scene.add(key);
const fill = new THREE.DirectionalLight(0xdfe8ff, 0.35);
fill.position.set(-3, 2.5, -2);
scene.add(fill);

// ---------- 地面 / 桌子 ----------
{
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(9, 48),
    new THREE.MeshStandardMaterial({ color: 0xece4d6, roughness: 1 })
  );
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.62; ground.receiveShadow = true;
  scene.add(ground);
  const wood = new THREE.MeshStandardMaterial({ color: 0xcfa878, roughness: 0.75 });
  const top = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.1, 2.2), wood);
  top.position.y = -0.05; top.castShadow = top.receiveShadow = true; scene.add(top);
  const legG = new THREE.CylinderGeometry(0.05, 0.05, 0.52, 12);
  const legM = new THREE.MeshStandardMaterial({ color: 0xb08d5f, roughness: 0.8 });
  for (const [lx, lz] of [[-1.25, -0.95], [1.25, -0.95], [-1.25, 0.95], [1.25, 0.95]]) {
    const leg = new THREE.Mesh(legG, legM);
    leg.position.set(lx, -0.36, lz); leg.castShadow = true; scene.add(leg);
  }
}

// ---------- T 恤纹理 ----------
const PASTELS = [
  { h: 340, rgb: { r: 255, g: 217, b: 232 } }, // 粉
  { h: 150, rgb: { r: 191, g: 232, b: 210 } }, // 薄荷
  { h: 205, rgb: { r: 191, g: 222, b: 245 } }, // 天空
  { h: 270, rgb: { r: 221, g: 207, b: 240 } }, // 薰衣草
  { h: 40, rgb: { r: 250, g: 235, b: 200 } },  // 奶油
];
const TEX_W = 1024, TEX_H = 832;
const TX = (sx) => ((sx + 0.62) / SHIRT_W) * TEX_W;
const TY = (sy) => (0.5 - sy) * TEX_H;

function drawShirt(hue) {
  const c = document.createElement('canvas'); c.width = TEX_W; c.height = TEX_H;
  const x = c.getContext('2d');
  const base = `hsl(${hue},65%,80%)`, dark = `hsl(${hue},55%,64%)`, deep = `hsl(${hue},50%,52%)`;
  x.fillStyle = base;
  const rect = (x0, x1, y0, y1) => { x.beginPath(); x.rect(TX(x0), TY(y1), TX(x1) - TX(x0), TY(y0) - TY(y1)); x.fill(); };
  rect(-0.42, 0.42, -0.31, 0.31);       // 身体
  rect(-0.62, -0.42, 0.03, 0.27);       // 左袖
  rect(0.42, 0.62, 0.03, 0.27);         // 右袖
  // 袖缝线
  x.strokeStyle = dark; x.lineWidth = 4;
  for (const sx of [-0.42, 0.42]) { x.beginPath(); x.moveTo(TX(sx), TY(0.27)); x.lineTo(TX(sx), TY(0.03)); x.stroke(); }
  // 领口罗纹 (带一点凹陷, 真实衣物既视感)
  x.strokeStyle = dark; x.lineWidth = 15; x.lineCap = 'round';
  x.beginPath(); x.moveTo(TX(-0.14), TY(0.305)); x.quadraticCurveTo(TX(0), TY(0.235), TX(0.14), TY(0.305)); x.stroke();
  x.strokeStyle = deep; x.lineWidth = 4;
  x.beginPath(); x.moveTo(TX(-0.14), TY(0.305)); x.quadraticCurveTo(TX(0), TY(0.235), TX(0.14), TY(0.305)); x.stroke();
  // 胸口小机器人图案
  const cx = TX(0), cyy = TY(0.03), s = TEX_W / SHIRT_W; // s: 每世界单位像素数
  x.fillStyle = dark;
  x.beginPath(); x.roundRect(cx - 0.085 * s, cyy - 0.065 * s, 0.17 * s, 0.13 * s, 0.04 * s); x.fill();
  x.strokeStyle = deep; x.lineWidth = 5;
  x.beginPath(); x.moveTo(cx, cyy - 0.065 * s); x.lineTo(cx, cyy - 0.10 * s); x.stroke();
  x.fillStyle = deep; x.beginPath(); x.arc(cx, cyy - 0.11 * s, 0.012 * s, 0, 7); x.fill();
  x.fillStyle = '#fff';
  x.beginPath(); x.arc(cx - 0.035 * s, cyy - 0.01 * s, 0.020 * s, 0, 7); x.fill();
  x.beginPath(); x.arc(cx + 0.035 * s, cyy - 0.01 * s, 0.020 * s, 0, 7); x.fill();
  x.fillStyle = '#334';
  x.beginPath(); x.arc(cx - 0.035 * s, cyy - 0.01 * s, 0.009 * s, 0, 7); x.fill();
  x.beginPath(); x.arc(cx + 0.035 * s, cyy - 0.01 * s, 0.009 * s, 0, 7); x.fill();
  x.strokeStyle = '#334'; x.lineWidth = 4;
  x.beginPath(); x.arc(cx, cyy + 0.015 * s, 0.025 * s, 0.3, Math.PI - 0.3); x.stroke();
  // 柔和明暗
  const grad = x.createLinearGradient(0, 0, 0, TEX_H);
  grad.addColorStop(0, 'rgba(255,255,255,0.10)'); grad.addColorStop(1, 'rgba(0,0,0,0.05)');
  x.fillStyle = grad; x.fillRect(0, 0, TEX_W, TEX_H);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// ---------- T 恤网格 (随机摆放, 烘焙到顶点) ----------
let shirt = null; // {mesh, base:Float32Array, cx, cz, rgb}
function buildShirt() {
  if (shirt) { scene.remove(shirt.mesh); shirt.mesh.geometry.dispose(); shirt.mesh.material.map.dispose(); shirt.mesh.material.dispose(); }
  const pastel = PASTELS[(Math.random() * PASTELS.length) | 0];
  const geo = new THREE.PlaneGeometry(SHIRT_W, SHIRT_H, 56, 44);
  const pos = geo.attributes.position;
  const yaw = (Math.random() - 0.5) * 0.7, ox = (Math.random() - 0.5) * 0.3, oz = (Math.random() - 0.5) * 0.2;
  const cy = Math.cos(yaw), sy2 = Math.sin(yaw);
  for (let i = 0; i < pos.count; i++) {
    const sx = pos.getX(i), syv = pos.getY(i); // syv: 衫上方向
    const px = sx, pz = -syv;
    pos.setXYZ(i, ox + px * cy + pz * sy2, 0.002, oz - px * sy2 + pz * cy);
  }
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({
    map: drawShirt(pastel.h), transparent: true, alphaTest: 0.45,
    side: THREE.DoubleSide, roughness: 0.9, metalness: 0,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = mesh.receiveShadow = true;
  scene.add(mesh);
  shirt = { mesh, base: new Float32Array(pos.array), cx: ox, cz: oz, rgb: pastel.rgb, yaw };
}

// ---------- 折叠引擎 ----------
const foldEngine = {
  active: null, // {px,pz,dx,dz,foldSign,axisH,duration,t,snapshot}
  index: 0,
  start(p) {
    this.active = { ...p, t: 0, snapshot: new Float32Array(shirt.mesh.geometry.attributes.position.array) };
  },
  update(dt) {
    const f = this.active; if (!f) return false;
    f.t += dt / f.duration;
    const e = easeInOutCubic(Math.min(f.t, 1));
    const pos = shirt.mesh.geometry.attributes.position, snap = f.snapshot;
    for (let i = 0; i < pos.count; i++) {
      const ix = i * 3;
      const x = snap[ix], y = snap[ix + 1], z = snap[ix + 2];
      if (sideOfLine(f.px, f.pz, f.dx, f.dz, x, z) * f.foldSign > 0) {
        const p = foldPointVert(f.px, f.pz, f.dx, f.dz, f.axisH, f.foldSign, e, x, y, z);
        pos.setXYZ(i, p.x, p.y, p.z);
      } else pos.setXYZ(i, x, y, z);
    }
    pos.needsUpdate = true;
    shirt.mesh.geometry.computeVertexNormals();
    if (f.t >= 1) { // 烘焙
      shirt.base = new Float32Array(pos.array);
      this.active = null; this.index++;
      return true; // 刚完成
    }
    return false;
  },
  /** 当前(未完成)折叠下某点的实时位置, 供机械臂跟踪抓取点 */
  pointNow(x, y, z) {
    const f = this.active; if (!f) return { x, y, z };
    const e = easeInOutCubic(Math.min(f.t, 1));
    if (sideOfLine(f.px, f.pz, f.dx, f.dz, x, z) * f.foldSign > 0)
      return foldPointVert(f.px, f.pz, f.dx, f.dz, f.axisH, f.foldSign, e, x, y, z);
    return { x, y, z };
  },
  reset() { this.active = null; this.index = 0; },
};

// ---------- 双臂机器人 ----------
const WHITE = new THREE.MeshStandardMaterial({ color: 0xf5f5f7, roughness: 0.5, metalness: 0.1 });
const DARK = new THREE.MeshStandardMaterial({ color: 0x2b2b33, roughness: 0.6 });

function shadowed(m) { m.castShadow = true; return m; }

function makeArm(bx, bz, accentColor) {
  const accent = new THREE.MeshStandardMaterial({ color: accentColor, roughness: 0.45, metalness: 0.15 });
  const g = new THREE.Group(); g.position.set(bx, 0, bz);
  const base = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.1, 24), WHITE));
  base.position.y = 0.05; g.add(base);
  const col = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.068, 0.14, 20), WHITE));
  col.position.y = 0.15; g.add(col);
  // 脸: 两只眼睛朝向桌子 (-z)
  for (const ex of [-0.024, 0.024]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.013, 12, 10), DARK);
    eye.position.set(ex, 0.17, -0.055); g.add(eye);
  }
  const yawG = new THREE.Group(); yawG.position.y = SHOULDER_H; g.add(yawG);
  yawG.add(shadowed(new THREE.Mesh(new THREE.SphereGeometry(0.056, 20, 16), accent)));
  const shG = new THREE.Group(); yawG.add(shG);
  const upper = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.05, L1, 18), WHITE));
  upper.position.y = L1 / 2; shG.add(upper);
  const elG = new THREE.Group(); elG.position.y = L1; shG.add(elG);
  elG.add(shadowed(new THREE.Mesh(new THREE.SphereGeometry(0.05, 20, 16), accent)));
  const fore = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.043, L2, 18), WHITE));
  fore.position.y = L2 / 2; elG.add(fore);
  const wrG = new THREE.Group(); wrG.position.y = L2; elG.add(wrG);
  wrG.add(shadowed(new THREE.Mesh(new THREE.SphereGeometry(0.034, 16, 12), accent)));
  const tool = new THREE.Group(); wrG.add(tool); // 保持竖直
  const palm = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.035, 0.075), accent));
  palm.position.y = -0.055; tool.add(palm);
  const fingerG = new THREE.BoxGeometry(0.022, 0.1, 0.035);
  const fingerL = new THREE.Group(), fingerR = new THREE.Group();
  fingerL.position.set(0.03, -0.07, 0); fingerR.position.set(-0.03, -0.07, 0);
  const fl = shadowed(new THREE.Mesh(fingerG, WHITE)); fl.position.y = -0.05; fingerL.add(fl);
  const fr = shadowed(new THREE.Mesh(fingerG, WHITE)); fr.position.y = -0.05; fingerR.add(fr);
  tool.add(fingerL, fingerR);
  scene.add(g);
  return { group: g, yawG, shG, elG, tool, fingerL, fingerR, bx, bz };
}

function setArmPose(arm, yaw, a1, a2, open) {
  arm.yawG.rotation.y = yaw;
  arm.shG.rotation.x = a1;
  arm.elG.rotation.x = a2;
  arm.tool.rotation.x = -(a1 + a2); // 夹爪始终竖直朝下
  arm.fingerL.rotation.z = -open * 0.5;
  arm.fingerR.rotation.z = open * 0.5;
}
function armTo(arm, p, open) {
  // p 为期望的指尖位置; IK 解的是腕点, 故上抬 TOOL_DROP
  const { yaw, a1, a2 } = ik(arm.bx, arm.bz, SHOULDER_H, L1, L2, p.x, p.y + TOOL_DROP, p.z);
  setArmPose(arm, yaw, a1, a2, open);
}
const armL = makeArm(ARM_L_BASE.x, ARM_L_BASE.z, 0xff8a5c); // 左臂·橙
const armR = makeArm(ARM_R_BASE.x, ARM_R_BASE.z, 0x4aa8ff); // 右臂·蓝
armTo(armL, HOME_L, 0.7); armTo(armR, HOME_R, 0.7);

// ---------- 关键点 3D 标记 ----------
function textSprite(text, color) {
  const c = document.createElement('canvas'); c.width = 128; c.height = 128;
  const x = c.getContext('2d');
  x.fillStyle = color; x.beginPath(); x.arc(64, 64, 44, 0, 7); x.fill();
  x.fillStyle = '#fff'; x.font = 'bold 56px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(text, 64, 66);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sp.scale.set(0.11, 0.11, 1); sp.renderOrder = 10;
  return sp;
}
const markers = {};
for (const [k, label, color] of [['A', 'A', '#ff5252'], ['B', 'B', '#ff9f1c'], ['C', 'C', '#3a86ff']]) {
  const sp = textSprite(label, color); sp.visible = false; scene.add(sp); markers[k] = sp;
}
function showMarker(k, p) { markers[k].position.set(p.x, 0.06, p.z); markers[k].visible = true; }
function hideMarkers() { for (const k in markers) markers[k].visible = false; }

// ---------- 俯视相机抓拍 + 关键点检测 ----------
const capCam = new THREE.OrthographicCamera(-CAP_S / 2, CAP_S / 2, CAP_S / 2, -CAP_S / 2, 0.1, 10);
capCam.up.set(0, 0, -1);
const capTarget = new THREE.WebGLRenderTarget(CAP, CAP);
const px2w = (px, py) => ({
  x: shirt.cx + (px / CAP - 0.5) * CAP_S,
  z: shirt.cz + (py / CAP - 0.5) * CAP_S,
});
const w2px = (x, z) => ({
  x: (x - shirt.cx) / CAP_S * CAP + CAP / 2,
  y: (z - shirt.cz) / CAP_S * CAP + CAP / 2,
});

function captureTopDown() {
  armL.group.visible = armR.group.visible = false;
  hideMarkers();
  capCam.position.set(shirt.cx, 6, shirt.cz);
  capCam.lookAt(shirt.cx, 0, shirt.cz);
  renderer.setRenderTarget(capTarget);
  renderer.render(scene, capCam);
  const buf = new Uint8Array(CAP * CAP * 4);
  renderer.readRenderTargetPixels(capTarget, 0, 0, CAP, CAP, buf);
  renderer.setRenderTarget(null);
  armL.group.visible = armR.group.visible = true;
  const data = new Uint8ClampedArray(CAP * CAP * 4); // WebGL 行 0 在底部 -> 翻转为 y 朝下
  for (let y = 0; y < CAP; y++) data.set(buf.subarray((CAP - 1 - y) * CAP * 4, (CAP - y) * CAP * 4), y * CAP * 4);
  return { width: CAP, height: CAP, data };
}

// 检测结果 (世界坐标) + 规划
let plan = null;
function detectAndPlan() {
  const img = captureTopDown();
  const mask = segmentShirt(img, shirt.rgb, 70);
  let kp = findKeypoints(mask, CAP, CAP);
  if (!kp) { // 兜底: 几何默认 (不应发生)
    const d = 90;
    kp = {
      sleeveL: { x: CAP / 2 - d, y: CAP / 2 - 40 }, sleeveR: { x: CAP / 2 + d, y: CAP / 2 - 40 },
      shoulderL: { x: CAP / 2 - d, y: CAP / 2 - 60 }, shoulderR: { x: CAP / 2 + d, y: CAP / 2 - 60 },
      hemL: { x: CAP / 2 - d, y: CAP / 2 + 60 }, hemR: { x: CAP / 2 + d, y: CAP / 2 + 60 },
      A: { x: CAP / 2 - d / 2, y: CAP / 2 - 60 }, B: null, C: null, contour: [],
    };
    kp.C = { x: kp.A.x, y: kp.A.y + 120 }; kp.B = { x: kp.A.x, y: kp.A.y + 60 };
  }
  const W = (p) => ({ ...px2w(p.x, p.y), y: 0.002 }); // 布面高度
  const kw = {
    A: W(kp.A), B: W(kp.B), C: W(kp.C),
    sleeveL: W(kp.sleeveL), sleeveR: W(kp.sleeveR),
    hemL: W(kp.hemL), hemR: W(kp.hemR),
    shoulderL: W(kp.shoulderL), shoulderR: W(kp.shoulderR),
  };
  const pf = planFolds(kw);
  plan = { kp, img, ...kw, ...pf };
  return plan;
}

// ---------- 时间线 ----------
const TL = { state: 'idle', t: 0, running: false, timeScale: 1, foldStarted: false };
const DUR = { detecting: 1.8, flipB: 3.6, foldC: 3.4 };
const seg01 = (t, a, b) => { const s = Math.min(1, Math.max(0, (t - a) / (b - a))); return easeInOutCubic(s); };
const lerp = (a, b, s) => a + (b - a) * s;
const lerp3 = (a, b, s) => ({ x: lerp(a.x, b.x, s), y: lerp(a.y, b.y, s), z: lerp(a.z, b.z, s) });

const statusEl = document.getElementById('status');
const pills = { A: document.getElementById('stepA'), B: document.getElementById('stepB'), C: document.getElementById('stepC') };
function setPills(active) {
  const order = ['A', 'B', 'C'];
  for (const k of order) {
    pills[k].classList.remove('active', 'done');
    if (k === active) pills[k].classList.add('active');
    else if (order.indexOf(k) < order.indexOf(active)) pills[k].classList.add('done');
  }
  if (active === 'done') order.forEach((k) => pills[k].classList.add('done'));
}
function setStatus(t) { statusEl.textContent = t; }

function setState(s) {
  TL.state = s; TL.t = 0; TL.foldStarted = false; TL.entered = false;
  if (s === 'detecting') { setPills('A'); setStatus('A·感知 — 俯视相机检测关键点…'); }
  if (s === 'flipB') { setPills('B'); setStatus('B·翻折 — 左臂抓袖口, 沿 ABC 线翻折'); }
  if (s === 'foldC') { setPills('C'); setStatus('C·对折 — 右臂抓下摆, 上翻对折'); }
  if (s === 'done') { setPills('done'); setStatus('叠好啦! ✨'); burstConfetti(); }
  if (s === 'idle') { setPills(null); setStatus('点击「播放」开始叠衣'); }
}

// B步每帧摆臂 (左臂抓袖口翻折, 右臂按住 C 点固定折痕)
function poseFlipB(t) {
  const tip = plan.grabTip, press = plan.pressC;
  const aboveTip = { ...tip, y: tip.y + 0.16 }, abovePress = { ...press, y: press.y + 0.16 };
  const grabPos = { ...tip, y: tip.y + 0.03 };
  let lPos, lOpen, rPos, rOpen;
  if (t < 1.0) { const s = seg01(t, 0, 1.0); lPos = lerp3(HOME_L, aboveTip, s); lOpen = 0.7; rPos = lerp3(HOME_R, abovePress, s); rOpen = 0.7; }
  else if (t < 1.3) { const s = seg01(t, 1.0, 1.3); lPos = lerp3(aboveTip, grabPos, s); lOpen = lerp(0.7, 0.12, s); rPos = lerp3(abovePress, press, s); rOpen = lerp(0.7, 0.3, s); }
  else {
    if (!TL.foldStarted) { foldEngine.start(plan.fold1); TL.foldStarted = true; }
    const tracked = foldEngine.pointNow(tip.x, tip.y, tip.z);
    lPos = { x: tracked.x, y: tracked.y + 0.03, z: tracked.z }; lOpen = 0.12;
    rPos = press; rOpen = 0.3;
    if (t > 2.9) { const s = seg01(t, 2.9, 3.6); const up = { x: tracked.x, y: tracked.y + 0.35, z: tracked.z }; lPos = lerp3(lPos, up, s); lOpen = lerp(0.12, 0.7, s); rPos = lerp3(press, abovePress, s); }
  }
  armTo(armL, lPos, lOpen); armTo(armR, rPos, rOpen);
}

// C步每帧摆臂
function poseFoldC(t) {
  const grab = plan.grabHem, press = plan.pressB;
  const aboveGrab = { ...grab, y: grab.y + 0.16 }, abovePress = { ...press, y: press.y + 0.16 };
  const grabPos = { ...grab, y: grab.y + 0.03 };
  let lPos, lOpen, rPos, rOpen;
  if (t < 1.0) { const s = seg01(t, 0, 1.0); rPos = lerp3(HOME_R, aboveGrab, s); rOpen = 0.7; lPos = lerp3(HOME_L, abovePress, s); lOpen = 0.7; }
  else if (t < 1.3) { const s = seg01(t, 1.0, 1.3); rPos = lerp3(aboveGrab, grabPos, s); rOpen = lerp(0.7, 0.12, s); lPos = lerp3(abovePress, press, s); lOpen = lerp(0.7, 0.3, s); }
  else {
    if (!TL.foldStarted) { foldEngine.start(plan.fold2); TL.foldStarted = true; }
    const tracked = foldEngine.pointNow(grab.x, grab.y, grab.z);
    rPos = { x: tracked.x, y: tracked.y + 0.03, z: tracked.z }; rOpen = 0.12;
    lPos = press; lOpen = 0.3;
    // C 点被布带着走, 标记跟随 (烘焙后停在最终位置)
    if (foldEngine.active) {
      const cp = foldEngine.pointNow(plan.C.x, 0.02, plan.C.z);
      markers.C.position.set(cp.x, cp.y + 0.045, cp.z);
    }
    if (t > 2.8) { const s = seg01(t, 2.8, 3.4); rPos = lerp3(rPos, { x: 0.5, y: 0.75, z: 0.25 }, s); rOpen = lerp(0.12, 0.7, s); lPos = lerp3(lPos, { x: -0.5, y: 0.75, z: 0.25 }, s); }
  }
  armTo(armL, lPos, lOpen); armTo(armR, rPos, rOpen);
}

// ---------- 五彩纸屑 ----------
let confetti = null;
function burstConfetti() {
  const N = 160;
  const pos = new Float32Array(N * 3), col = new Float32Array(N * 3), vel = [];
  const c = new THREE.Color();
  for (let i = 0; i < N; i++) {
    pos[i * 3] = (Math.random() - 0.5) * 1.4; pos[i * 3 + 1] = 0.5 + Math.random() * 0.5; pos[i * 3 + 2] = (Math.random() - 0.5) * 1.4;
    c.setHSL(Math.random(), 0.85, 0.6);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    vel.push((Math.random() - 0.5) * 1.4, 1.2 + Math.random() * 1.6, (Math.random() - 0.5) * 1.4);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const pts = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.035, vertexColors: true }));
  scene.add(pts);
  confetti = { pts, vel, life: 0 };
}
function updateConfetti(dt) {
  if (!confetti) return;
  confetti.life += dt;
  const pos = confetti.pts.geometry.attributes.position;
  for (let i = 0; i < confetti.vel.length / 3; i++) {
    confetti.vel[i * 3 + 1] -= 3.2 * dt;
    pos.array[i * 3] += confetti.vel[i * 3] * dt;
    pos.array[i * 3 + 1] = Math.max(0.01, pos.array[i * 3 + 1] + confetti.vel[i * 3 + 1] * dt);
    pos.array[i * 3 + 2] += confetti.vel[i * 3 + 2] * dt;
  }
  pos.needsUpdate = true;
  if (confetti.life > 2.6) { scene.remove(confetti.pts); confetti.pts.geometry.dispose(); confetti = null; }
}

// ---------- 机器人视角小窗 ----------
const inset = document.getElementById('inset');
function drawInset() {
  const { img, kp } = plan;
  const x = inset.getContext('2d');
  x.putImageData(new ImageData(img.data, img.width, img.height), 0, 0);
  x.strokeStyle = 'rgba(46,160,90,0.9)'; x.lineWidth = 2;
  x.beginPath();
  kp.contour.forEach(([px, py], i) => (i ? x.lineTo(px, py) : x.moveTo(px, py)));
  x.stroke();
  // B步折痕线 (过 A, 沿衣服朝向)
  const aPx = w2px(plan.A.x, plan.A.z);
  x.strokeStyle = 'rgba(255,255,255,0.95)'; x.lineWidth = 2.5; x.setLineDash([9, 7]);
  x.beginPath();
  x.moveTo(aPx.x - plan.up.x * 150, aPx.y - plan.up.z * 150);
  x.lineTo(aPx.x + plan.up.x * 150, aPx.y + plan.up.z * 150);
  x.stroke(); x.setLineDash([]);
  const dot = (p, color, label, r = 5) => {
    x.fillStyle = color; x.beginPath(); x.arc(p.x, p.y, r, 0, 7); x.fill();
    x.font = 'bold 12px sans-serif'; x.textAlign = 'center';
    x.lineWidth = 3; x.strokeStyle = 'rgba(0,0,0,0.55)';
    x.strokeText(label, p.x, p.y - 10); x.fillStyle = '#fff'; x.fillText(label, p.x, p.y - 10);
  };
  dot(kp.sleeveL, '#9aa0a6', '袖'); dot(kp.sleeveR, '#9aa0a6', '袖');
  dot(kp.shoulderL, '#9aa0a6', '肩'); dot(kp.shoulderR, '#9aa0a6', '肩');
  dot(kp.hemL, '#9aa0a6', '摆'); dot(kp.hemR, '#9aa0a6', '摆');
  if (kp.armpitL) dot(kp.armpitL, '#b39ddb', '腋', 4);
  if (kp.armpitR) dot(kp.armpitR, '#b39ddb', '腋', 4);
  dot(kp.A, '#ff5252', 'A', 7); dot(kp.B, '#ff9f1c', 'B', 7); dot(kp.C, '#3a86ff', 'C', 7);
}

// ---------- 主循环 ----------
const clock = new THREE.Clock();
function tick() {
  requestAnimationFrame(tick);
  const rawDt = Math.min(clock.getDelta(), 0.05);
  const dt = TL.running ? rawDt * TL.timeScale : 0;
  if (dt > 0) {
    TL.t += dt;
    if (TL.state === 'detecting') {
      if (!TL.entered) { // 进入瞬间执行一次
        TL.entered = true;
        detectAndPlan(); drawInset();
        showMarker('A', plan.A); showMarker('B', plan.B); showMarker('C', plan.C);
      }
      if (TL.t >= DUR.detecting) setState('flipB');
    } else if (TL.state === 'flipB') {
      poseFlipB(TL.t);
      foldEngine.update(dt);
      if (TL.t >= DUR.flipB) setState('foldC');
    } else if (TL.state === 'foldC') {
      poseFoldC(TL.t);
      foldEngine.update(dt);
      if (TL.t >= DUR.foldC) setState('done');
    }
  }
  updateConfetti(rawDt);
  renderer.render(scene, camera);
}

function resize() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);

// ---------- UI ----------
const btnPlay = document.getElementById('btnPlay');
btnPlay.addEventListener('click', () => {
  if (TL.state === 'idle' || TL.state === 'done') {
    if (TL.state === 'done') resetAll();
    TL.running = true; setState('detecting'); btnPlay.textContent = '⏸ 暂停';
  } else {
    TL.running = !TL.running;
    btnPlay.textContent = TL.running ? '⏸ 暂停' : '▶ 播放';
  }
});
document.getElementById('btnAgain').addEventListener('click', () => { resetAll(); TL.running = true; setState('detecting'); btnPlay.textContent = '⏸ 暂停'; });
document.querySelectorAll('[data-speed]').forEach((b) =>
  b.addEventListener('click', () => {
    TL.timeScale = parseFloat(b.dataset.speed);
    document.querySelectorAll('[data-speed]').forEach((o) => o.classList.remove('on'));
    b.classList.add('on');
  })
);

function resetAll() {
  buildShirt(); foldEngine.reset(); hideMarkers();
  if (confetti) { scene.remove(confetti.pts); confetti = null; }
  armTo(armL, HOME_L, 0.7); armTo(armR, HOME_R, 0.7);
  plan = null;
  const x = inset.getContext('2d'); x.clearRect(0, 0, inset.width, inset.height);
  setState('idle');
}

// ---------- 启动 ----------
buildShirt();
resize();
setState('idle');
window.__fb = { TL, get plan() { return plan; }, foldEngine }; // 调试图: 快进验证用
window.addEventListener('error', (e) => { document.title = 'ERR: ' + (e.message || e.error); });
if (new URLSearchParams(location.search).has('autostart')) btnPlay.click();
tick();
