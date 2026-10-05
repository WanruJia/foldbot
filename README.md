# FoldBot · 叠衣机器人

一个会用 **ABC 叠衣法** 叠 T 恤的虚拟双臂机器人 —— 关键是, 它的折叠线**不是写死的**, 而是来自俯视相机的实时**关键点检测**。

## ABC 叠衣法 (三点定位快叠法)

- **A** — 肩点: 肩线中点 (领口与肩头之间)
- **B** — A 点正下方的中点
- **C** — A 点正下方的下摆点

机器人流程:

1. **A·感知**: 俯视相机抓拍 → 颜色分割 → 轮廓 → 凸包 + 凹点分析 → 检出肩/袖/下摆/腋下等关键点, 算出 A/B/C (小窗实时显示检测结果)
2. **B·翻折**: 左臂抓住袖口, 右臂按住 C 点固定折痕, 沿 ABC 线把左侧翻过去
3. **C·对折**: 左臂按住 B 点, 右臂抓住下摆中点沿过 B 点的横线翻上去 → 完成 ✨

## 关键点检测管线 (vision.js, 纯 JS, 可单测)

`颜色分割 → 闭运算去洞 → 外轮廓 → 凸包 → 凹点聚类(到凸包距离) → 腋下/领口 → 肩点/袖口/下摆 → A/B/C`

衣服每次随机换色、换位置、转角度, 检测照样找得准 —— 这就是"视觉驱动"的意思。

## 运行

**直接双击打开 `foldbot-standalone.html`** 即可 (单文件, 内嵌 Three.js, 离线可用)。

开发版 (多文件, 改代码刷新即看): `index.html`，Three.js 从 `vendor/` 本地加载, 需用本地服务打开:
```bash
python3 -m http.server 8000
# 访问 http://localhost:8000
```

改完源文件后重新打包单文件:
```bash
node build-standalone.mjs
```

## 文件

| 文件 | 说明 |
|---|---|
| `foldbot-standalone.html` | **交付物**: 单文件版, 双击即开 |
| `index.html` / `style.css` | 页面与 UI (开发版) |
| `app.js` | 场景、T 恤、折叠引擎、双臂、时间线 |
| `kinematics.js` | 机械臂解析 IK/FK (纯数学) |
| `fold.js` | 折叠几何 Rodrigues 旋转 (纯数学) |
| `vision.js` | 关键点检测 (纯 JS) |
| `planner.js` | 折叠规划: 关键点 → 两步折叠参数 + 手臂目标点 (纯数学) |
| `build-standalone.mjs` | 打包脚本 |
| `vendor/three.module.js` | Three.js r160 (本地, 离线可用) |
| `*.test.mjs` | Node 单测 |

## 单测

```bash
node kinematics.test.mjs  # IK/FK 往返 500 次, 误差 < 1e-9
node fold.test.mjs         # 折叠镜像/侧别/中途上扬
node vision.test.mjs       # 旋转 15° 的合成 T 恤, 关键点误差 < 1px
node planner.test.mjs      # 200 次随机摆放: 折叠几何正确 + 手臂目标点全部可达
```
