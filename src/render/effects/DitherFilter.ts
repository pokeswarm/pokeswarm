import Phaser from 'phaser';

/**
 * 半透明をディザ（市松）の不透明ドットにするフィルター（作者の依頼 2026年10月31日: 塗りをドットの雰囲気に合わせる試作）。
 *
 * 半透明の塗りを草の上に重ねると、パレットに無い濁った色になる。ドット絵の世界では半透明を使わず、
 * 「透ける」は点をまばらに打って表す（GBA や SFC の透過）。このフィルターは、層に描かれた色の
 * 不透明度（alpha）を「点の密度」と読み替え、ドットごとに Bayer 4×4 のしきい値と比べて、
 * 色をそのまま不透明に出すか、何も出さないかの二択にする。レシピの fillAlpha・shapeAlpha はそのまま密度になる。
 *
 * ドットの大きさ（size）は Blocky フィルターと同じにして、同じマス目で判定する（Blocky の後ろに掛ける）。
 * 描画の入れ物は premultiplied alpha（色 × alpha で入っている）なので、通すときは alpha で割って元の色に戻す。
 */
const NODE_NAME = 'FilterDither';

const SHADER = [
  '#pragma phaserTemplate(shaderName)',
  'precision mediump float;',
  'uniform sampler2D uMainSampler;',
  'uniform vec2 resolution;',
  'uniform vec4 uSizeAndOffset;',
  'uniform float uGain;',
  'varying vec2 outTexCoord;',
  // Bayer 2×2: (0,0)=0 (1,0)=2 (0,1)=3 (1,1)=1
  'float bayer2(vec2 c) { return mod(2.0 * c.x + 3.0 * c.y, 4.0); }',
  // Bayer 4×4 = 2×2 を入れ子にしたもの（0〜15）
  'float bayer4(vec2 c) { return 4.0 * bayer2(mod(c, 2.0)) + bayer2(mod(floor(c / 2.0), 2.0)); }',
  'void main()',
  '{',
  '    vec4 color = texture2D(uMainSampler, outTexCoord);',
  '    if (color.a <= 0.001) { gl_FragColor = vec4(0.0); return; }',
  '    vec2 cell = floor((outTexCoord * resolution + uSizeAndOffset.zw) / uSizeAndOffset.xy);',
  '    float threshold = (bayer4(cell) + 0.5) / 16.0;',
  '    float density = min(1.0, color.a * uGain);',
  '    if (density < threshold) { gl_FragColor = vec4(0.0); return; }',
  '    gl_FragColor = vec4(color.rgb / color.a, 1.0);',
  '}',
].join('\n');

/** 描く側（WebGL の RenderNode）。シェーダーに、マス目の大きさと密度の倍率を渡す */
class FilterDither extends Phaser.Renderer.WebGL.RenderNodes.BaseFilterShader {
  constructor(manager: Phaser.Renderer.WebGL.RenderNodes.RenderNodeManager) {
    super(NODE_NAME, manager, undefined, SHADER);
  }

  override setupUniforms(controller: Phaser.Filters.Controller, drawingContext: Phaser.Renderer.WebGL.DrawingContext): void {
    const c = controller as DitherController;
    const pm = this.programManager;
    pm.setUniform('resolution', [drawingContext.width, drawingContext.height]);
    pm.setUniform('uSizeAndOffset', [Math.max(1, c.size.x), Math.max(1, c.size.y), c.offset.x, c.offset.y]);
    pm.setUniform('uGain', c.gain);
  }
}

/** 設定を持つ側（層の filters に足すもの）。size は1ドットの画面のマス数（Blocky と同じにする）、gain は密度の倍率 */
export class DitherController extends Phaser.Filters.Controller {
  size = { x: 4, y: 4 };
  offset = { x: 0, y: 0 };
  gain = 1;

  constructor(camera: Phaser.Cameras.Scene2D.Camera, size: number, gain = 1) {
    super(camera, NODE_NAME);
    this.size = { x: size, y: size };
    this.gain = gain;
  }
}

/** フィルターの描く側を、この renderer に一度だけ登録する */
const registered = new WeakSet<object>();

/**
 * 層（filters を有効にしたもの）にディザのフィルターを足す。WebGL でなければ null。
 * size は1ドットの画面のマス数。Blocky の後ろに足すこと（同じマス目で判定する）
 */
export function addDither(scene: Phaser.Scene, list: Phaser.GameObjects.Components.FilterList, size: number, gain = 1): DitherController | null {
  if (scene.renderer.type !== Phaser.WEBGL) return null;
  const renderer = scene.renderer as Phaser.Renderer.WebGL.WebGLRenderer;
  if (!registered.has(renderer)) {
    renderer.renderNodes.addNodeConstructor(NODE_NAME, FilterDither);
    registered.add(renderer);
  }
  return list.add(new DitherController(list.camera, size, gain)) as DitherController;
}
