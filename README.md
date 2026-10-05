# FoldBot · 叠衣分拣机器人

一个会叠衣服、还会**按家人分拣**的虚拟双臂机器人。它的折叠线和分拣依据都**不是写死的**，而是来自俯视相机的实时**关键点检测**：先识别是 T 恤还是裤子，再检测关键点、量出尺寸，判断是爸爸 / 妈妈 / 女儿 / 儿子的衣服，叠好后放入对应的衣箱。

A dual-arm robot that folds laundry **and sorts it by family member**. Nothing is hardcoded: an overhead camera detects the garment type (tee vs. pants), finds keypoints, measures the size to tell whose it is (dad / mom / daughter / son), folds it, and places it into the right bin.

---

## 功能 Features

- **多种衣服 Garment variety**：T 恤、长袖 T 恤、长裤、短裤，每件随机颜色、位置、角度
  Tees, long-sleeve tees, long pants, short pants — each with random color, position and rotation
- **ABC 叠衣法 ABC folding**（T 恤）：A=肩点、 B=中点、 C=下摆点，全部来自实时检测
  (tees): points A (shoulder), B (middle), C (hem) all come from live detection
- **裤子折叠规则 Pants folding**：先左右对折，再按"大人/小孩 × 长/短"处理——
  Fold legs together first, then by adult/kid × long/short —
  - 大人长裤 adult long pants → 三折 tri-fold
  - 大人短裤 / 小孩长裤 adult shorts / kid long pants → 对折 bi-fold
  - 小孩短裤 kid shorts → 不再折 no further fold
- **视觉分拣 Vision-based sorting**：量肩宽 / 腰宽判断归属，叠好后机械臂抓取放入四个衣箱（爸爸 / 妈妈 / 女儿 / 儿子）
  Measures shoulder / waist width to classify the owner, then a arm places the folded garment into one of four bins (dad / mom / daughter / son)
- **连续分拣 Continuous mode**：一件接一件自动处理，像真的家务机器人
  Keeps processing garments one after another, like a real housework robot

## 工作流程 How it works

1. **取衣 Pick**：机械臂从对面的待洗篮拿一件衣服到中央折叠区
   An arm picks a garment from the laundry basket across the table to the folding area
2. **感知 Perception**：俯视相机抓拍 → 颜色分割 → 轮廓 → 凸包 + 凹点分析
   Overhead snapshot → color segmentation → contour → convex hull + concavity analysis
   - 先识别种类：下半部有多条水平线被分成左右两段 → 裤子（裆槽），否则 T 恤
     Classify first: pants if scanlines in the lower half split into two runs (crotch slot), else tee
   - T 恤：检出肩 / 袖 / 下摆 / 腋下 → 算出 A / B / C；裤子：检出腰 / 裆 / 裤脚
     Tee: detect shoulders / sleeves / hem / armpits → A / B / C; Pants: detect waist / crotch / cuffs
   - 量尺寸定归属：T 恤看肩宽，裤子看腰宽 → 爸爸 / 妈妈 / 女儿 / 儿子
     Measure to classify: shoulder width for tees, waist width for pants → dad / mom / daughter / son
2. **折叠 Fold**：双臂按规划执行（抓臂跟踪布料到 75% 提前松手，另一臂按住折痕）
   Dual arms execute the plan (grasp arm tracks the cloth to 75% then releases early, the other holds the crease)
3. **归位 Sort**：机械臂抓起叠好的衣服，放入臂后方对应家人的衣箱，计数 +1
   An arm picks up the folded garment and drops it into the owner's bin behind the arms

### 衣箱模式 Bin modes
- **自动识别人数 Auto**（默认）：按衣服尺寸（肩宽/腰宽）聚类，动态推断有几个人，衣箱自动生成（成员1、成员2…，最多6个）
  Clusters garments by size to infer household members; bins are created dynamically
- **固定四人 Fixed**：爸爸 / 妈妈 / 女儿 / 儿子
  Fixed four bins: dad / mom / daughter / son

机器人视角小窗实时显示检测结果（轮廓、关键点、折痕线、种类与归属判定）。
The robot-view inset shows live detection: contour, keypoints, crease lines, and the type/owner verdict.

## 运行 Run

**直接双击打开 `foldbot-standalone.html`** 即可（单文件，内嵌 Three.js，离线可用）。
**Just double-click `foldbot-standalone.html`** (single file, Three.js embedded, works offline).

开发版（多文件，改代码刷新即看）: `index.html`，Three.js 从 `vendor/` 本地加载，需用本地服务打开：
Dev version (multi-file): `index.html`, Three.js loads from local `vendor/`, serve it locally:
```bash
python3 -m http.server 8000
# 访问 http://localhost:8000 / visit http://localhost:8000
```

改完源文件后重新打包单文件：
Rebuild the single file after changing sources:
```bash
node build-standalone.mjs
```

## 文件 Files

| 文件 File | 说明 Description |
|---|---|
| `foldbot-standalone.html` | **交付物 Deliverable**：单文件版，双击即开 single-file build |
| `index.html` / `style.css` | 页面与 UI (开发版) page & UI (dev) |
| `app.js` | 场景、衣箱、折叠引擎、双臂、归位动画、时间线 scene, bins, fold engine, arms, placing, timeline |
| `garments.js` | 服装建模：4 位家人 × 4 种衣服 garment models: 4 owners × 4 kinds |
| `kinematics.js` | 机械臂解析 IK/FK（纯数学） analytic arm IK/FK (pure math) |
| `fold.js` | 折叠几何 Rodrigues 旋转（纯数学） fold geometry via Rodrigues rotation (pure math) |
| `vision.js` | 种类识别 + 关键点检测（纯 JS） type classification + keypoint detection (pure JS) |
| `planner.js` | 折叠规划 + 尺寸归属判定（纯数学） fold planning + size-based owner classification (pure math) |
| `build-standalone.mjs` | 打包脚本 bundler |
| `vendor/three.module.js` | Three.js r160（本地，离线可用） (local, offline) |
| `*.test.mjs` | Node 单测 unit tests |

## 单测 Tests

```bash
node kinematics.test.mjs  # IK/FK 往返 500 次，误差 < 1e-9 / 500 IK/FK round trips, err < 1e-9
node fold.test.mjs         # 折叠镜像 / 侧别 / 中途上扬 / mirror, side, mid-lift
node vision.test.mjs       # 旋转 15° 合成 T 恤 + 裤子：种类识别、关键点误差 < 1px
                           # synthetic rotated tee + pants: type classification, keypoint err < 1px
node planner.test.mjs      # 100+240 次随机摆放：折叠几何正确 + 手臂目标点全部可达 + 归属判定
                           # 340 randomized placements: fold geometry, arm reachability, owner classification
```
