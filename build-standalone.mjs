// build-standalone.mjs — 把 three.module.js + 5 个源文件打包成单个可双击打开的 foldbot-standalone.html
// 用法: node build-standalone.mjs
import { readFileSync, writeFileSync } from 'fs';

const THREE_NAMES = `ACESFilmicToneMapping,BoxGeometry,BufferAttribute,BufferGeometry,CanvasTexture,CircleGeometry,Clock,Color,CylinderGeometry,DirectionalLight,DoubleSide,Fog,Group,HemisphereLight,Mesh,MeshStandardMaterial,OrthographicCamera,PCFSoftShadowMap,PerspectiveCamera,PlaneGeometry,Points,PointsMaterial,SRGBColorSpace,Scene,SphereGeometry,Sprite,SpriteMaterial,WebGLRenderTarget,WebGLRenderer`;

let threeSrc = readFileSync('vendor/three.module.js', 'utf8');
// 去掉末尾的 export { ... };
threeSrc = threeSrc.replace(/export\s*\{[^}]*\}\s*;?\s*$/, '');
const threeWrapped = `const THREE = (() => {\n${threeSrc}\nreturn { ${THREE_NAMES} };\n})();`;

const mine = ['kinematics.js', 'fold.js', 'vision.js', 'planner.js', 'garments.js', 'app.js']
  .map((f) => {
    let src = readFileSync(f, 'utf8');
    src = src.replace(/^import\s+[^;]+;\s*$/gm, ''); // 去掉 import 行
    src = src.replace(/^export\s+/gm, '');           // export function -> function
    return `\n// ===== ${f} =====\n${src}`;
  })
  .join('\n');

let html = readFileSync('index.html', 'utf8');
html = html.replace(/<script type="importmap">[\s\S]*?<\/script>/, '');
html = html.replace(/<link rel="stylesheet" href="style.css" \/>/, () => {
  const css = readFileSync('style.css', 'utf8');
  return `<style>\n${css}\n</style>`;
});
html = html.replace(/<script type="module" src="(?:\.\/)?app\.js"><\/script>/,
  () => `<script type="module">\n${threeWrapped}\n${mine}\n</script>`);
writeFileSync('foldbot-standalone.html', html);
console.log('built foldbot-standalone.html', (html.length / 1024).toFixed(0) + 'KB');
