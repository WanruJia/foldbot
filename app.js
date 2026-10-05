// app.js — FoldBot: 叠衣 + 按家人分拣 (爸爸/妈妈/女儿/儿子)
// 流程: 感知(种类识别+关键点) -> 折叠 -> 抓取归位到衣箱
import * as THREE from 'three';
import { ik } from './kinematics.js';
import { sideOfLine, foldPointVert, easeInOutCubic } from './fold.js';
import { segmentShirt, findKeypoints, findKeypointsPants, detectKind } from './vision.js';
import { planFolds, planPantsFolds, classifyOwner, detectPantsLength } from './planner.js';
import { buildGarmentMesh, disposeGarmentMesh, OWNERS, OWNER_KEYS, KINDS, pantsFoldMode } from './garments.js';

const L1 = 0.72, L2 = 0.66, SHOULDER_H = 0.22;
const TOOL_DROP = 0.17;
const ARM_L_BASE = { x: -0.78, z: 0.62 }, ARM_R_BASE = { x: 0.78, z: 0.62 };
const HOME_L = { x: -0.45, y: 0.55, z: 0.35 }, HOME_R = { x: 0.45, y: 0.55, z: 0.35 };
const CAP = 320, CAP_S = 1.75;

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
  const wood = new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 0.75 });
  const top = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.1, 2.2), wood);
  top.position.y = -0.05; top.castShadow = top.receiveShadow = true; scene.add(top);
  const legG = new THREE.CylinderGeometry(0.05, 0.05, 0.52, 12);
  const legM = new THREE.MeshStandardMaterial({ color: 0x4e3520, roughness: 0.8 });
  for (const [lx, lz] of [[-1.25, -0.95], [1.25, -0.95], [-1.25, 0.95], [1.25, 0.95]]) {
    const leg = new THREE.Mesh(legG, legM);
    leg.position.set(lx, -0.36, lz); leg.castShadow = true; scene.add(leg);
  }
}

// ---------- 动态衣箱 (可配置 + 自动聚类) ----------
let binMode = 'auto'; // 'auto': 从衣服尺寸聚类推断人数; 'fixed': 爸爸/妈妈/女儿/儿子
const MAX_BINS = 6;
const BIN_COLORS = [0x5b7fa6, 0xc98a9b, 0x9b8ac9, 0x7fb8a4, 0xd9a441, 0x8ad9c9];
const CLUSTER_THRESH = 0.07; // 尺寸聚类阈值
let bins = []; // [{id, label, color, center, count, x, z}]
let binMeshes = {}; // id -> {group, label}
const placedMeshes = [];

function makeBinLabel(text, colorHex) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 96;
  const x = c.getContext('2d');
  x.fillStyle = 'rgba(255,255,255,0.94)';
  x.beginPath(); x.roundRect(6, 6, 244, 84, 22); x.fill();
  x.fillStyle = colorHex; x.font = 'bold 50px sans-serif';
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(text, 128, 52);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  sp.scale.set(0.42, 0.1575, 1); sp.renderOrder = 10;
  return sp;
}
function createBinVisual(bin) {
  const hex = '#' + new THREE.Color(bin.color).getHexString();
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: bin.color, roughness: 0.65 });
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.03, 0.42), mat);
  base.position.y = 0.015; g.add(base);
  const wallH = 0.14, t = 0.02;
  const mkWall = (w, d, px, pz) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, wallH, d), mat);
    m.position.set(px, 0.03 + wallH / 2, pz); g.add(m);
  };
  mkWall(0.5, t, 0, -0.21 + t / 2); mkWall(0.5, t, 0, 0.21 - t / 2);
  mkWall(t, 0.42, -0.25 + t / 2, 0); mkWall(t, 0.42, 0.25 - t / 2, 0);
  g.position.set(bin.x, 0, bin.z);
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  scene.add(g);
  const label = makeBinLabel(bin.label, hex);
  label.position.set(bin.x, 0.42, bin.z);
  scene.add(label);
  binMeshes[bin.id] = { group: g, label };
}
function layoutBins() {
  const n = bins.length;
  const spacing = 0.62;
  const startX = -(n - 1) * spacing / 2;
  bins.forEach((b, i) => {
    b.x = startX + i * spacing;
    b.z = 0.88;
    const m = binMeshes[b.id];
    if (m) { m.group.position.set(b.x, 0, b.z); m.label.position.set(b.x, 0.42, b.z); }
  });
}
function clearBins() {
  for (const id in binMeshes) {
    scene.remove(binMeshes[id].group);
    scene.remove(binMeshes[id].label);
  }
  bins = []; binMeshes = {};
  document.getElementById('bins').innerHTML = '';
}
function addBinCounter(bin) {
  const hex = '#' + new THREE.Color(bin.color).getHexString();
  const d = document.createElement('div');
  d.className = 'bincount';
  d.innerHTML = `<i style="background:${hex}"></i>${bin.label} <b id="c-${bin.id}">0</b>`;
  document.getElementById('bins').appendChild(d);
}
function initFixedBins() {
  clearBins();
  OWNER_KEYS.forEach((owner, i) => {
    const bin = { id: owner, label: OWNERS[owner].label, color: OWNERS[owner].binColor,
                  center: null, count: 0, x: 0, z: 0.88 };
    bins.push(bin); createBinVisual(bin); addBinCounter(bin);
  });
  layoutBins();
}
function assignBin(metric) {
  // 自动聚类：找最近的簇，距离 < 阈值则归入，否则新建
  let best = null, bestDist = 1e9;
  for (const b of bins) {
    if (b.center === null) continue;
    const d = Math.abs(metric - b.center);
    if (d < bestDist) { bestDist = d; best = b; }
  }
  if (best && bestDist < CLUSTER_THRESH) {
    best.center = (best.center * best.count + metric) / (best.count + 1);
    return best;
  }
  if (bins.length >= MAX_BINS) return best; // 满了，归入最近的
  const id = 'p' + (bins.length + 1);
  const bin = { id, label: `成员${bins.length + 1}`,
                color: BIN_COLORS[bins.length % BIN_COLORS.length],
                center: metric, count: 0, x: 0, z: 0.88 };
  bins.push(bin); createBinVisual(bin); addBinCounter(bin); layoutBins();
  return bin;
}
// 启动时用自动模式（空箱子，等衣服来了再聚类）
clearBins();

// ---------- 待洗篮 (桌子对面, 机械臂前方) ----------
const BASKET = { x: 0, z: -0.48 };
function buildBasket() {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0xb8a88e, roughness: 0.8 });
  const W = 0.72, D = 0.5, H = 0.26, t = 0.025;
  const base = new THREE.Mesh(new THREE.BoxGeometry(W, 0.03, D), mat);
  base.position.y = 0.015; g.add(base);
  const mkWall = (w, d, px, pz) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, H, d), mat);
    m.position.set(px, 0.03 + H / 2, pz); g.add(m);
  };
  mkWall(W, t, 0, -D / 2 + t / 2); mkWall(W, t, 0, D / 2 - t / 2);
  mkWall(t, D, -W / 2 + t / 2, 0); mkWall(t, D, W / 2 - t / 2, 0);
  // 篮子里几件团起来的衣服 (装饰)
  const cols = [0xd9a7a7, 0xa7c4d9, 0xb8d9a7];
  for (let i = 0; i < 3; i++) {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(0.3 + Math.random() * 0.15, 0.07, 0.22 + Math.random() * 0.1),
      new THREE.MeshStandardMaterial({ color: cols[i], roughness: 0.95 })
    );
    m.position.set((Math.random() - 0.5) * 0.25, 0.06 + i * 0.065, (Math.random() - 0.5) * 0.15);
    m.rotation.y = (Math.random() - 0.5) * 0.9;
    m.castShadow = true; g.add(m);
  }
  g.position.set(BASKET.x, 0, BASKET.z);
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  scene.add(g);
}
buildBasket();

// ---------- 衣服 ----------
let garment = null; // {mesh, base, W, H, kind, kindKey, owner, rgb, yaw, ox, oz}
let currentKindKey = 'random';
let pickCount = 0;
function nextGarment() {
  if (garment) { scene.remove(garment.mesh); disposeGarmentMesh(garment); }
  garment = buildGarmentMesh(currentKindKey, 'random', BASKET); // 在待洗篮里生成
  // 衣服放在篮内衣物堆上
  garment.mesh.position.y = 0.20;
  scene.add(garment.mesh);
  foldEngine.reset(); hideMarkers(); plan = null;
  const x = inset.getContext('2d'); x.clearRect(0, 0, inset.width, inset.height);
}
// 取衣后把衣服落定在折叠区中央, 重新烘焙顶点
function settleGarmentAtCenter() {
  const pos = garment.mesh.geometry.attributes.position;
  const ox = garment.mesh.position.x, oz = garment.mesh.position.z;
  for (let i = 0; i < pos.count; i++) {
    pos.setXYZ(i, pos.getX(i) + ox, 0.002, pos.getZ(i) + oz);
  }
  pos.needsUpdate = true;
  garment.mesh.geometry.computeVertexNormals();
  garment.mesh.position.set(0, 0, 0);
  garment.ox = 0; garment.oz = 0;
  garment.base = new Float32Array(pos.array);
}

// ---------- 折叠引擎 ----------
const foldEngine = {
  active: null, mesh: null, garment: null, index: 0,
  start(p, g) {
    this.garment = g; this.mesh = g.mesh;
    this.active = { ...p, t: 0, snapshot: new Float32Array(this.mesh.geometry.attributes.position.array) };
  },
  update(dt) {
    const f = this.active; if (!f) return false;
    f.t += dt / f.duration;
    const e = easeInOutCubic(Math.min(f.t, 1));
    const pos = this.mesh.geometry.attributes.position, snap = f.snapshot;
    for (let i = 0; i < pos.count; i++) {
      const ix = i * 3;
      const x = snap[ix], y = snap[ix + 1], z = snap[ix + 2];
      if (sideOfLine(f.px, f.pz, f.dx, f.dz, x, z) * f.foldSign > 0) {
        const p = foldPointVert(f.px, f.pz, f.dx, f.dz, f.axisH, f.foldSign, e, x, y, z);
        pos.setXYZ(i, p.x, p.y, p.z);
      } else pos.setXYZ(i, x, y, z);
    }
    pos.needsUpdate = true;
    this.mesh.geometry.computeVertexNormals();
    if (f.t >= 1) {
      this.garment.base = new Float32Array(pos.array);
      this.active = null; this.index++;
      return true;
    }
    return false;
  },
  pointNow(x, y, z) {
    const f = this.active; if (!f) return { x, y, z };
    const e = easeInOutCubic(Math.min(f.t, 1));
    if (sideOfLine(f.px, f.pz, f.dx, f.dz, x, z) * f.foldSign > 0)
      return foldPointVert(f.px, f.pz, f.dx, f.dz, f.axisH, f.foldSign, e, x, y, z);
    return { x, y, z };
  },
  reset() { this.active = null; this.mesh = null; this.garment = null; this.index = 0; },
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
  const tool = new THREE.Group(); wrG.add(tool);
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
  arm.tool.rotation.x = -(a1 + a2);
  arm.fingerL.rotation.z = -open * 0.5;
  arm.fingerR.rotation.z = open * 0.5;
}
function armTo(arm, p, open) {
  const { yaw, a1, a2 } = ik(arm.bx, arm.bz, SHOULDER_H, L1, L2, p.x, p.y + TOOL_DROP, p.z);
  setArmPose(arm, yaw, a1, a2, open);
}
const armL = makeArm(ARM_L_BASE.x, ARM_L_BASE.z, 0xff8a5c);
const armR = makeArm(ARM_R_BASE.x, ARM_R_BASE.z, 0x4aa8ff);
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
function showMarkers() {
  hideMarkers();
  for (const m of plan.markers) {
    const sp = textSprite(m.label, m.color);
    sp.position.set(m.p.x, 0.06, m.p.z);
    scene.add(sp);
    if (markers[m.key]) scene.remove(markers[m.key]);
    markers[m.key] = sp;
  }
}
function hideMarkers() { for (const k in markers) markers[k].visible = false; }

// ---------- 俯视相机抓拍 ----------
const capCam = new THREE.OrthographicCamera(-CAP_S / 2, CAP_S / 2, CAP_S / 2, -CAP_S / 2, 0.1, 10);
capCam.up.set(0, 0, -1);
const capTarget = new THREE.WebGLRenderTarget(CAP, CAP);
capTarget.texture.colorSpace = THREE.SRGBColorSpace; // 让抓拍输出 sRGB, 与分割参考色一致
const px2w = (px, py) => ({
  x: garment.ox + (px / CAP - 0.5) * CAP_S,
  z: garment.oz + (py / CAP - 0.5) * CAP_S,
});
const w2px = (x, z) => ({
  x: (x - garment.ox) / CAP_S * CAP + CAP / 2,
  y: (z - garment.oz) / CAP_S * CAP + CAP / 2,
});
function captureTopDown() {
  armL.group.visible = armR.group.visible = false;
  hideMarkers();
  const hidden = [];
  scene.traverse((o) => { if (o.isSprite) { hidden.push(o); o.visible = false; } });
  capCam.position.set(garment.ox, 6, garment.oz);
  capCam.lookAt(garment.ox, 0, garment.oz);
  renderer.setRenderTarget(capTarget);
  renderer.render(scene, capCam);
  const buf = new Uint8Array(CAP * CAP * 4);
  renderer.readRenderTargetPixels(capTarget, 0, 0, CAP, CAP, buf);
  renderer.setRenderTarget(null);
  armL.group.visible = armR.group.visible = true;
  hidden.forEach((o) => { o.visible = true; });
  const data = new Uint8ClampedArray(CAP * CAP * 4);
  for (let y = 0; y < CAP; y++) data.set(buf.subarray((CAP - 1 - y) * CAP * 4, (CAP - y) * CAP * 4), y * CAP * 4);
  return { width: CAP, height: CAP, data };
}

// ---------- 感知 + 规划 ----------
let plan = null;
function detectAndPlan() {
  const img = captureTopDown();
  const mask = segmentShirt(img, garment.rgb, 85);
  const kind = detectKind(mask, CAP, CAP) || 'shirt';
  const W = (p) => ({ ...px2w(p.x, p.y), y: 0.002 });
  let kp, kw, folds, markers, cls, owner, up, right, kindLabel = KINDS[garment.kindKey].label;
  if (kind === 'shirt') {
    kp = findKeypoints(mask, CAP, CAP);
    if (!kp) { // 兜底
      const d = 90, c = CAP / 2;
      kp = {
        sleeveL: { x: c - d, y: c - 40 }, sleeveR: { x: c + d, y: c - 40 },
        shoulderL: { x: c - d, y: c - 60 }, shoulderR: { x: c + d, y: c - 60 },
        hemL: { x: c - d, y: c + 60 }, hemR: { x: c + d, y: c + 60 },
        A: { x: c - d / 2, y: c - 60 }, B: null, C: null, contour: [],
      };
      kp.C = { x: kp.A.x, y: kp.A.y + 120 }; kp.B = { x: kp.A.x, y: kp.A.y + 60 };
    }
    kw = {
      A: W(kp.A), B: W(kp.B), C: W(kp.C),
      sleeveL: W(kp.sleeveL), sleeveR: W(kp.sleeveR),
      hemL: W(kp.hemL), hemR: W(kp.hemR),
      shoulderL: W(kp.shoulderL), shoulderR: W(kp.shoulderR),
    };
    cls = classifyOwner('shirt', kw);
    owner = cls.owner;
    const pf = planFolds(kw);
    folds = pf.folds; up = pf.up; right = pf.right;
    markers = [
      { key: 'A', label: 'A', color: '#ff5252', p: kw.A },
      { key: 'B', label: 'B', color: '#ff9f1c', p: kw.B },
      { key: 'C', label: 'C', color: '#3a86ff', p: kw.C },
    ];
  } else {
    kp = findKeypointsPants(mask, CAP, CAP);
    if (!kp) {
      const d = 70, c = CAP / 2;
      kp = {
        waistL: { x: c - d, y: c - 80 }, waistR: { x: c + d, y: c - 80 },
        crotch: { x: c, y: c - 40 },
        cuffL: { x: c - d, y: c + 80 }, cuffR: { x: c + d, y: c + 80 },
        contour: [],
      };
    }
    kw = {
      waistL: W(kp.waistL), waistR: W(kp.waistR), crotch: W(kp.crotch),
      cuffL: W(kp.cuffL), cuffR: W(kp.cuffR),
    };
    cls = classifyOwner('pants', kw);
    owner = cls.owner;
    const length = detectPantsLength(kw);
    const mode = pantsFoldMode(owner, length);
    const pf = planPantsFolds(kw, mode);
    folds = pf.folds; up = pf.up; right = pf.right;
    kindLabel = length === 'long' ? '长裤' : '短裤';
    const waistC = { x: (kw.waistL.x + kw.waistR.x) / 2, y: 0.002, z: (kw.waistL.z + kw.waistR.z) / 2 };
    const cuffC = { x: (kw.cuffL.x + kw.cuffR.x) / 2, y: 0.002, z: (kw.cuffL.z + kw.cuffR.z) / 2 };
    markers = [
      { key: 'crotch', label: '裆', color: '#ff5252', p: kw.crotch },
      { key: 'waist', label: '腰', color: '#3a86ff', p: waistC },
      { key: 'cuff', label: '脚', color: '#ff9f1c', p: cuffC },
    ];
  }
  plan = { kind, kindLabel, owner, cls, folds, markers, up, right, kp, img, kw };
  // 分配衣箱：固定模式按家人，自动模式按尺寸聚类
  if (binMode === 'fixed') {
    plan.bin = bins.find(b => b.id === owner) || bins[0];
  } else {
    plan.bin = assignBin(cls.metric);
  }
  return plan;
}

// ---------- 时间线 ----------
const TL = { state: 'idle', t: 0, running: false, timeScale: 1, foldStarted: false, sortMode: false, foldIdx: 0 };
const DUR = { detecting: 1.8 };
const seg01 = (t, a, b) => { const s = Math.min(1, Math.max(0, (t - a) / (b - a))); return easeInOutCubic(s); };
const lerp = (a, b, s) => a + (b - a) * s;
const lerp3 = (a, b, s) => ({ x: lerp(a.x, b.x, s), y: lerp(a.y, b.y, s), z: lerp(a.z, b.z, s) });

const statusEl = document.getElementById('status');
const stepsEl = document.getElementById('steps');
let pillEls = [];
function buildPills() {
  stepsEl.innerHTML = ''; pillEls = [];
  const labels = ['取衣', 'A·感知', ...plan.folds.map((f) => f.label), '归位'];
  labels.forEach((lb, i) => {
    const d = document.createElement('div');
    d.className = 'pill'; d.innerHTML = `<b>${'ABCDEFGH'[i] || '·'}</b>${lb.replace(/^[A-Z]·/, '')}`;
    stepsEl.appendChild(d); pillEls.push(d);
  });
}
function setPills(idx) {
  pillEls.forEach((el, i) => {
    el.classList.remove('active', 'done');
    if (idx === 'done' || i < idx) el.classList.add('done');
    else if (i === idx) el.classList.add('active');
  });
}
function setStatus(t) { statusEl.textContent = t; }

function setState(s) {
  TL.state = s; TL.t = 0; TL.foldStarted = false; TL.entered = false; TL.released = false;
  if (s === 'picking') { setPills(0); setStatus('取衣 — 机械臂从待洗篮拿一件到折叠区…'); setupPicking(); }
  else if (s === 'detecting') { setPills(1); setStatus('A·感知 — 俯视相机识别种类、检测关键点…'); }
  else if (s === 'fold') {
    const i = TL.foldIdx, step = plan.folds[i];
    setPills(2 + i); setStatus(`${'BCD'[i] || '·'}·${step.label}`); hideMarkers();
  }
  else if (s === 'placing') {
    setPills(2 + plan.folds.length);
    setStatus(`归位 — ${plan.kindLabel}·${plan.cls.metricName}${plan.cls.metric.toFixed(2)}，放入「${plan.bin.label}」`);
    setupPlacing();
  }
  else if (s === 'done') {
    setPills('done');
    if (TL.sortMode) setStatus(`✓ 放入「${plan.bin.label}」的箱子`);
    else { setStatus('叠好并分拣完成! ✨'); burstConfetti(); }
  }
  else if (s === 'idle') { setPills(-1); setStatus('选择衣服种类，点击「播放」开始'); }
}

// 通用折叠摆臂: 抓臂跟踪布料到 75% 提前松手, 按臂固定折痕
function poseFoldStep(t, step) {
  const gArm = step.grabArm === 'L' ? armL : armR, pArm = step.pressArm === 'L' ? armL : armR;
  const gHome = step.grabArm === 'L' ? HOME_L : HOME_R, pHome = step.pressArm === 'L' ? HOME_L : HOME_R;
  const { grab, press, params } = step;
  const dur = params.duration, relT = 1.3 + dur * 0.75, endT = 1.3 + dur + 0.8;
  const aboveGrab = { ...grab, y: grab.y + 0.16 }, abovePress = { ...press, y: press.y + 0.16 };
  const grabPos = { ...grab, y: grab.y + 0.03 };
  let gPos, gOpen, pPos, pOpen;
  if (t < 1.0) {
    const s = seg01(t, 0, 1.0);
    gPos = lerp3(gHome, aboveGrab, s); gOpen = 0.7;
    pPos = lerp3(pHome, abovePress, s); pOpen = 0.7;
  } else if (t < 1.3) {
    const s = seg01(t, 1.0, 1.3);
    gPos = lerp3(aboveGrab, grabPos, s); gOpen = lerp(0.7, 0.12, s);
    pPos = lerp3(abovePress, press, s); pOpen = lerp(0.7, 0.3, s);
  } else {
    if (!TL.foldStarted) { foldEngine.start(params, garment); TL.foldStarted = true; TL.released = false; }
    const ft = (t - 1.3) / dur;
    if (ft < 0.75) {
      const tr = foldEngine.pointNow(grab.x, grab.y, grab.z);
      gPos = { x: tr.x, y: tr.y + 0.03, z: tr.z }; gOpen = 0.12;
    } else {
      if (!TL.released) { TL.released = true; TL.relPt = foldEngine.pointNow(grab.x, grab.y, grab.z); }
      const s = seg01(t, relT, relT + 0.6);
      gPos = lerp3(
        { x: TL.relPt.x, y: TL.relPt.y + 0.03, z: TL.relPt.z },
        { x: TL.relPt.x, y: TL.relPt.y + 0.45, z: TL.relPt.z }, s);
      gOpen = lerp(0.12, 0.7, s);
    }
    pPos = press; pOpen = 0.3;
    if (t > relT + 0.6) {
      const s2 = seg01(t, relT + 0.6, endT);
      pPos = lerp3(press, abovePress, s2); pOpen = lerp(0.3, 0.7, s2);
      gPos = lerp3(gPos, gHome, s2); gOpen = lerp(gOpen, 0.7, s2);
    }
  }
  armTo(gArm, gPos, gOpen); armTo(pArm, pPos, pOpen);
  return endT;
}

// ---------- 取衣 (从待洗篮拿到折叠区) ----------
function setupPicking() {
  const pos = garment.mesh.geometry.attributes.position;
  let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9, maxY = -1e9;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    if (y > maxY) maxY = y;
  }
  // mesh.position.y=0.20 (在衣堆上), 实际世界坐标要加上
  const cx = (minX + maxX) / 2 + garment.mesh.position.x;
  const cz = (minZ + maxZ) / 2 + garment.mesh.position.z;
  const topY = maxY + garment.mesh.position.y;
  const arm = (pickCount++ % 2 === 0) ? 'L' : 'R'; // 双臂轮流取衣
  TL.pick = { arm, cx, cz, topY };
}
function posePicking(t) {
  const P = TL.pick;
  const arm = P.arm === 'L' ? armL : armR, home = P.arm === 'L' ? HOME_L : HOME_R;
  const other = P.arm === 'L' ? armR : armL, otherHome = P.arm === 'L' ? HOME_R : HOME_L;
  const aboveB = { x: P.cx, y: 0.55, z: P.cz };
  const grab = { x: P.cx, y: P.topY + 0.03, z: P.cz };
  const liftB = { x: P.cx, y: 0.62, z: P.cz };
  const aboveC = { x: 0, y: 0.62, z: 0 };
  const drop = { x: 0, y: 0.06, z: 0 };
  const T1 = 0.7, T2 = 1.2, T3 = 1.7, T4 = 2.7, T5 = 3.2, T6 = 3.8;
  let p, open;
  if (t < T1) { const s = seg01(t, 0, T1); p = lerp3(home, aboveB, s); open = 0.7; }
  else if (t < T2) { const s = seg01(t, T1, T2); p = lerp3(aboveB, grab, s); open = lerp(0.7, 0.12, s); }
  else if (t < T3) { const s = seg01(t, T2, T3); p = lerp3(grab, liftB, s); open = 0.12; }
  else if (t < T4) { const s = seg01(t, T3, T4); p = lerp3(liftB, aboveC, s); open = 0.12; }
  else if (t < T5) { const s = seg01(t, T4, T5); p = lerp3(aboveC, drop, s); open = 0.12; }
  else { const s = seg01(t, T5, T6); p = lerp3(drop, aboveC, s); open = lerp(0.12, 0.7, s); }
  armTo(arm, p, open);
  armTo(other, otherHome, 0.7);
  if (t >= T2 && t < T5 && garment) {
    garment.mesh.position.set(p.x - P.cx, p.y - 0.03 - P.topY, p.z - P.cz);
  }
  return T6;
}
// ---------- 归位 (抓取叠好的衣服放入衣箱) ----------
function setupPlacing() {
  const pos = garment.mesh.geometry.attributes.position;
  let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9, maxY = -1e9;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    if (y > maxY) maxY = y;
  }
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
  const bin = plan.bin;
  // 按箱子左右位置分配手臂：左半用左臂，右半用右臂
  const arm = bin.x < 0 ? 'L' : 'R';
  TL.place = { arm, bin, cx, cz, topY: maxY, dropY: 0.06 + bin.count * 0.035 };
}
function posePlacing(t) {
  const P = TL.place;
  const arm = P.arm === 'L' ? armL : armR, home = P.arm === 'L' ? HOME_L : HOME_R;
  const other = P.arm === 'L' ? armR : armL, otherHome = P.arm === 'L' ? HOME_R : HOME_L;
  const aboveG = { x: P.cx, y: 0.55, z: P.cz };
  const grab = { x: P.cx, y: P.topY + 0.03, z: P.cz };
  const liftG = { x: P.cx, y: 0.6, z: P.cz };
  const aboveB = { x: P.bin.x, y: 0.6, z: P.bin.z };
  const drop = { x: P.bin.x, y: P.dropY + 0.03, z: P.bin.z };
  const T1 = 0.6, T2 = 1.1, T3 = 1.6, T4 = 2.6, T5 = 3.1, T6 = 3.7;
  let p, open;
  if (t < T1) { const s = seg01(t, 0, T1); p = lerp3(home, aboveG, s); open = 0.7; }
  else if (t < T2) { const s = seg01(t, T1, T2); p = lerp3(aboveG, grab, s); open = lerp(0.7, 0.12, s); }
  else if (t < T3) { const s = seg01(t, T2, T3); p = lerp3(grab, liftG, s); open = 0.12; }
  else if (t < T4) { const s = seg01(t, T3, T4); p = lerp3(liftG, aboveB, s); open = 0.12; }
  else if (t < T5) { const s = seg01(t, T4, T5); p = lerp3(aboveB, drop, s); open = 0.12; }
  else { const s = seg01(t, T5, T6); p = lerp3(drop, aboveB, s); open = lerp(0.12, 0.7, s); }
  armTo(arm, p, open);
  armTo(other, otherHome, 0.7);
  if (t >= T2 && t < T5 && garment) {
    garment.mesh.position.set(p.x - P.cx, p.y - 0.03 - P.topY, p.z - P.cz);
  }
  return T6;
}
function finishPlacing() {
  const bin = plan.bin;
  const pos = garment.mesh.geometry.attributes.position;
  const ox = garment.mesh.position.x, oy = garment.mesh.position.y, oz = garment.mesh.position.z;
  // 世界坐标包围盒
  let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9, minY = 1e9;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + ox, y = pos.getY(i) + oy, z = pos.getZ(i) + oz;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    if (y < minY) minY = y;
  }
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
  // 烘焙时是 R(-yaw), 这里用 R(+yaw) 转回摆正
  const cy = Math.cos(garment.yaw), sy = Math.sin(garment.yaw);
  const dropY = 0.055 + bin.count * 0.035;
  const dy = dropY - minY;
  for (let i = 0; i < pos.count; i++) {
    const lx = pos.getX(i) + ox - cx, lz = pos.getZ(i) + oz - cz;
    const rx = lx * cy - lz * sy, rz = lx * sy + lz * cy;
    pos.setXYZ(i, bin.x + rx, pos.getY(i) + oy + dy, bin.z + rz);
  }
  pos.needsUpdate = true;
  garment.mesh.geometry.computeVertexNormals();
  garment.mesh.position.set(0, 0, 0);
  bin.count++;
  document.getElementById('c-' + bin.id).textContent = bin.count;
  placedMeshes.push(garment.mesh);
  garment = null;
  foldEngine.reset();
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
  const { img, kp, kind } = plan;
  const x = inset.getContext('2d');
  x.putImageData(new ImageData(img.data, img.width, img.height), 0, 0);
  x.strokeStyle = 'rgba(46,160,90,0.9)'; x.lineWidth = 2;
  if (kp.contour && kp.contour.length) {
    x.beginPath();
    kp.contour.forEach(([px, py], i) => (i ? x.lineTo(px, py) : x.moveTo(px, py)));
    x.stroke();
  }
  const dot = (p, color, label, r = 5) => {
    if (!p) return;
    x.fillStyle = color; x.beginPath(); x.arc(p.x, p.y, r, 0, 7); x.fill();
    x.font = 'bold 12px sans-serif'; x.textAlign = 'center';
    x.lineWidth = 3; x.strokeStyle = 'rgba(0,0,0,0.55)';
    x.strokeText(label, p.x, p.y - 10); x.fillStyle = '#fff'; x.fillText(label, p.x, p.y - 10);
  };
  x.font = 'bold 15px sans-serif'; x.textAlign = 'left';
  x.lineWidth = 4; x.strokeStyle = 'rgba(0,0,0,0.55)'; x.fillStyle = '#fff';
  const info = `${plan.kindLabel} · ${plan.cls.metricName}${plan.cls.metric.toFixed(2)} → ${plan.bin.label}`;
  x.strokeText(info, 10, 24); x.fillText(info, 10, 24);
  if (kind === 'shirt') {
    const aPx = w2px(plan.kw.A.x, plan.kw.A.z);
    x.strokeStyle = 'rgba(255,255,255,0.95)'; x.lineWidth = 2.5; x.setLineDash([9, 7]);
    x.beginPath();
    x.moveTo(aPx.x - plan.up.x * 150, aPx.y - plan.up.z * 150);
    x.lineTo(aPx.x + plan.up.x * 150, aPx.y + plan.up.z * 150);
    x.stroke(); x.setLineDash([]);
    dot(kp.sleeveL, '#9aa0a6', '袖'); dot(kp.sleeveR, '#9aa0a6', '袖');
    dot(kp.shoulderL, '#9aa0a6', '肩'); dot(kp.shoulderR, '#9aa0a6', '肩');
    dot(kp.hemL, '#9aa0a6', '摆'); dot(kp.hemR, '#9aa0a6', '摆');
    dot(kp.A, '#ff5252', 'A', 7); dot(kp.B, '#ff9f1c', 'B', 7); dot(kp.C, '#3a86ff', 'C', 7);
  } else {
    const cPx = w2px(plan.kw.crotch.x, plan.kw.crotch.z);
    const wC = { x: (plan.kw.waistL.x + plan.kw.waistR.x) / 2, z: (plan.kw.waistL.z + plan.kw.waistR.z) / 2 };
    const wPx = w2px(wC.x, wC.z);
    x.strokeStyle = 'rgba(255,255,255,0.95)'; x.lineWidth = 2.5; x.setLineDash([9, 7]);
    x.beginPath(); x.moveTo(cPx.x, cPx.y); x.lineTo(wPx.x, wPx.y); x.stroke(); x.setLineDash([]);
    dot(kp.waistL, '#9aa0a6', '腰'); dot(kp.waistR, '#9aa0a6', '腰');
    dot(kp.crotch, '#ff5252', '裆', 7);
    dot(kp.cuffL, '#9aa0a6', '脚'); dot(kp.cuffR, '#9aa0a6', '脚');
  }
}

// ---------- 主循环 ----------
const clock = new THREE.Clock();
function tick() {
  requestAnimationFrame(tick);
  const rawDt = Math.min(clock.getDelta(), 0.05);
  const dt = TL.running ? rawDt * TL.timeScale : 0;
  if (dt > 0) {
    TL.t += dt;
    if (TL.state === 'picking') {
      const endT = posePicking(TL.t);
      if (TL.t >= endT) { settleGarmentAtCenter(); setState('detecting'); }
    } else if (TL.state === 'detecting') {
      if (!TL.entered) {
        TL.entered = true;
        detectAndPlan(); drawInset(); showMarkers(); buildPills(); setPills(0);
      }
      if (TL.t >= DUR.detecting) { TL.foldIdx = 0; setState('fold'); }
    } else if (TL.state === 'fold') {
      const endT = poseFoldStep(TL.t, plan.folds[TL.foldIdx]);
      foldEngine.update(dt);
      if (TL.t >= endT) {
        TL.foldIdx++;
        if (TL.foldIdx >= plan.folds.length) setState('placing');
        else setState('fold');
      }
    } else if (TL.state === 'placing') {
      const endT = posePlacing(TL.t);
      if (TL.t >= endT) { finishPlacing(); setState('done'); }
    } else if (TL.state === 'done') {
      if (TL.sortMode && TL.t > 1.2) {
        currentKindKey = 'random';
        nextGarment(); setState('picking');
      } else if (!TL.sortMode) {
        TL.running = false;
        document.getElementById('btnPlay').textContent = '▶ 播放';
      }
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
const btnSort = document.getElementById('btnSort');
const btnBinAuto = document.getElementById('btnBinAuto');
const btnBinFixed = document.getElementById('btnBinFixed');
function setBinMode(mode) {
  if (binMode === mode) return;
  binMode = mode;
  btnBinAuto.classList.toggle('on', mode === 'auto');
  btnBinFixed.classList.toggle('on', mode === 'fixed');
  // 清掉已放的衣服，重置衣箱
  for (const m of placedMeshes) scene.remove(m);
  placedMeshes.length = 0;
  if (mode === 'fixed') initFixedBins();
  else clearBins();
  updateBinCounts();
  setStatus(mode === 'auto' ? '自动模式 — 按衣服尺寸聚类识别人数' : '固定模式 — 爸爸/妈妈/女儿/儿子');
}
btnBinAuto.addEventListener('click', () => setBinMode('auto'));
btnBinFixed.addEventListener('click', () => setBinMode('fixed'));
function updateSortBtn() {
  btnSort.textContent = TL.sortMode ? '⏹ 停止分拣' : '🔁 连续分拣';
  btnSort.classList.toggle('on', TL.sortMode);
}
function updateBinCounts() {
  for (const b of bins) {
    const el = document.getElementById('c-' + b.id);
    if (el) el.textContent = b.count;
  }
}
btnPlay.addEventListener('click', () => {
  if (TL.sortMode) { // 分拣中: 暂停/继续
    TL.running = !TL.running;
    btnPlay.textContent = TL.running ? '⏸ 暂停' : '▶ 播放';
    return;
  }
  if (TL.state === 'idle' || TL.state === 'done') {
    if (TL.state === 'done' || !garment) nextGarment();
    TL.running = true; setState('picking'); btnPlay.textContent = '⏸ 暂停';
  } else {
    TL.running = !TL.running;
    btnPlay.textContent = TL.running ? '⏸ 暂停' : '▶ 播放';
  }
});
document.getElementById('btnAgain').addEventListener('click', () => {
  TL.sortMode = false; updateSortBtn();
  nextGarment(); TL.running = true; setState('picking'); btnPlay.textContent = '⏸ 暂停';
});
btnSort.addEventListener('click', () => {
  TL.sortMode = !TL.sortMode; updateSortBtn();
  if (TL.sortMode) {
    currentKindKey = 'random';
    document.querySelectorAll('[data-kind]').forEach((b) => b.classList.toggle('on', b.dataset.kind === 'random'));
    if (TL.state === 'idle' || TL.state === 'done') nextGarment();
    TL.running = true; setState('picking'); btnPlay.textContent = '⏸ 暂停';
  }
  // 关闭分拣: 当前这件完成后回到 idle (done 状态处理)
});
document.querySelectorAll('[data-kind]').forEach((b) =>
  b.addEventListener('click', () => {
    currentKindKey = b.dataset.kind;
    document.querySelectorAll('[data-kind]').forEach((o) => o.classList.remove('on'));
    b.classList.add('on');
    if (TL.state === 'idle' || TL.state === 'done') { nextGarment(); }
  })
);
document.querySelectorAll('[data-speed]').forEach((b) =>
  b.addEventListener('click', () => {
    TL.timeScale = parseFloat(b.dataset.speed);
    document.querySelectorAll('[data-speed]').forEach((o) => o.classList.remove('on'));
    b.classList.add('on');
  })
);

// ---------- 启动 ----------
nextGarment();
resize();
setState('idle');
updateBinCounts();
window.__fb = { TL, get plan() { return plan; }, get garment() { return garment; }, foldEngine, get bins() { return bins; }, placedMeshes };
window.addEventListener('error', (e) => { document.title = 'ERR: ' + (e.message || e.error); });
if (new URLSearchParams(location.search).has('autostart')) btnPlay.click();
tick();
