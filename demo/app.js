
import { FRAG, PARAM_FLOATS, LAYOUT } from './shader.js';

const VERT = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aPos;
out vec2 vUV;
out vec2 vBackdropUV;
uniform vec2 uElementHalfSizePx;
uniform vec4 uBackdropRect;   // (offset.xy, scale.xy) of this element within the backdrop
void main() {
  vUV = aPos * uElementHalfSizePx;
  vBackdropUV = uBackdropRect.xy + (aPos * 0.5 + 0.5) * uBackdropRect.zw;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

// Values marked FITTED were recovered by least squares against a real
function baseParams() {
  return {
    halfSize: [160, 100], exponent: 6.5,                 // FITTED exponent
    innerRefractAmount: 8, innerRefractInvHeight: 1 / 30,
    outerRefractAmount: -13, outerRefractInvHeight: 1 / 16,  // OPPOSITE sign
    refractOpacity: 0.65, complexRefraction: 1,
    refractThreshold: [-30, 0],
    displacementMat: [1, 0, 0, 1], refractAngle: [1, 0],
    aberrationAmount: 3, aberrationInvHeight: 1 / 22,
    aberrationOffset: 0, aberrationAngle: [1, 0],
    blurRadius: 22,                                       // FITTED live (sigma ~6)
    blurDist: [0, 8, 20, 40], blurAlpha: [1, 0.6, 0.3, 0],
    edgeBleedAmount: 24, edgeBleedInvHeight: 1 / 20,
    edgeBleedBlurRadius: 32, edgeBleedDist: [0, 26],
    edgeBleedOpacity: 0.15, bleedDarken: [0.92, 0],
    edgeRange: [0, 8], edgeOpacity: [0, 0],
    lightDir: [0, -1], highlightThreshold: 0.35,
    highlightHeight: 10, highlightSoftness: 0.5, highlightIntensity: 0.85,
    shadowAmount: 10, shadowInvHeight: 1 / 20, shadowOffset: [0, 0.004],
    shadowInvRadius: 1 / 26, shadowOpacity: 0.55, shadowContribution: 0.5,
    shadowDistOffset: 6,
    rimGlintGain: 0.10, rimGlintTau: 1.5,                 // FITTED
    faceCM0: [0.3545, -0.1604, -0.0150, 0.1283],          // FITTED (live vs Apple)
    faceCM1: [-0.0368, 0.2329, -0.0158, 0.1297],
    faceCM2: [-0.0438, -0.1498, 0.3705, 0.1263],
    bleedCM0: [1, 0, 0, 0], bleedCM1: [0, 1, 0, 0], bleedCM2: [0, 0, 1, 0],
    shadowCM0: [0.2, 0, 0, 0], shadowCM1: [0, 0.2, 0, 0], shadowCM2: [0, 0, 0.2, 0],
    faceOpacity: 1,
    clampLimit: 0, preserveHue: 1, sdrWhite: 1, edrScale: 1,
    diffusion: 1,
    extraCount: 0, mergeK: 45,
    shape2: [0, 0, 0, 0], shape3: [0, 0, 0, 0], shape4: [0, 0, 0, 0],
    ringShadowOffset: [0, 0], ringShadowStrokeWidth: 9, ringShadowRadius: 30,
    ringShadowOpacity: 0, ringShadowMask: 1,
    keyFillDir: [0.35, -0.94], keyFillHeight: 70, keyFillSpread: 0.55,
    keyFillAmount: 0, keyFillEffectOffset: 4, keyFillColorBias: 0,
    blurFillBlurRadius: 48, blurFillLightenOpacity: 0,
    blurFillDarkenOpacity: 0, blurFillNormalOpacity: 0,
    scaleRef: 75,
  };
}

function pack(p, out) {
  for (const [name, [idx, n]] of Object.entries(LAYOUT)) {
    const v = p[name];
    if (v === undefined) continue;
    if (n === 1) out[idx] = v;
    else for (let i = 0; i < n; i++) out[idx + i] = v[i];
  }
  return out;
}

class GlassPanel {
  constructor(canvas, backdrop) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: false, antialias: false });
    if (!gl) throw new Error('WebGL2 required');
    this.gl = gl;
    this.prog = this.link(VERT, FRAG);
    this.buf = new Float32Array(PARAM_FLOATS);

    const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
    const vbo = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null); this.vao = vao;

    this.ubo = gl.createBuffer();
    gl.bindBuffer(gl.UNIFORM_BUFFER, this.ubo);
    gl.bufferData(gl.UNIFORM_BUFFER, this.buf.byteLength, gl.DYNAMIC_DRAW);
    gl.bindBufferBase(gl.UNIFORM_BUFFER, 0, this.ubo);

    this.tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    // MIPMAPS ARE MANDATORY — the blur is mip selection. Without them every
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, backdrop);
    gl.generateMipmap(gl.TEXTURE_2D);

    this.rect = [0, 0, 1, 1];
    this.measure();
    new ResizeObserver(() => this.measure()).observe(canvas.parentElement);
  }

  /** Recompute this canvas's rect within its panel, in backdrop UV space. */
  measure() {
    const host = this.canvas.parentElement;
    const pr = host.getBoundingClientRect();
    const cr = this.canvas.getBoundingClientRect();
    if (pr.width && pr.height) {
      this.rect = [(cr.left - pr.left) / pr.width, (cr.top - pr.top) / pr.height,
                   cr.width / pr.width, cr.height / pr.height];
    }
  }

  compile(type, src) {
    const gl = this.gl, s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
      throw new Error(gl.getShaderInfoLog(s));
    return s;
  }

  link(vs, fs) {
    const gl = this.gl, p = gl.createProgram();
    gl.attachShader(p, this.compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, this.compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS))
      throw new Error(gl.getProgramInfoLog(p));
    const i = gl.getUniformBlockIndex(p, 'GlassParams');
    if (i !== gl.INVALID_INDEX) gl.uniformBlockBinding(p, i, 0);
    return p;
  }

  render(params) {
    const gl = this.gl, c = this.canvas;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(c.clientWidth * dpr), h = Math.round(c.clientHeight * dpr);
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }

    const p = { ...params, halfSize: [w / 2, h / 2] };
    pack(p, this.buf);
    gl.bindBuffer(gl.UNIFORM_BUFFER, this.ubo);
    gl.bufferSubData(gl.UNIFORM_BUFFER, 0, this.buf);

    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.prog);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.uniform1i(gl.getUniformLocation(this.prog, 'uBackdrop'), 0);
    gl.uniform2f(gl.getUniformLocation(this.prog, 'uElementHalfSizePx'), w / 2, h / 2);
    gl.uniform4f(gl.getUniformLocation(this.prog, 'uBackdropRect'),
      this.rect[0], this.rect[1], this.rect[2], this.rect[3]);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
  }
}

const EFFECTS = [
  { id: 'refraction', label: 'Two-sided refraction',
    note: 'Inner and outer lobes with OPPOSITE signs. Matching signs give a lens; opposing signs give thickness.',
    off: { innerRefractAmount: 0, outerRefractAmount: 0, refractOpacity: 0 } },
  { id: 'aberration', label: 'Chromatic aberration',
    note: '7 taps: 3 forward feeding R/G, 4 backward feeding G/B. Red and blue are dragged opposite ways.',
    off: { aberrationAmount: 0 } },
  { id: 'bleed', label: 'Edge bleed',
    note: 'A wider blur sampled only near the rim. Most-skipped part, biggest quality delta — this is what reads as wet.',
    off: { edgeBleedOpacity: 0, edgeBleedAmount: 0 } },
  { id: 'blur', label: 'Backdrop blur',
    note: 'No blur loop anywhere: radius becomes a mip level via log2(). Constant cost at any radius.',
    off: { blurRadius: 0.5 } },
  { id: 'highlight', label: 'Specular rim',
    note: 'Lambert against the SDF normal, remapped by (n·l − t)/(1 − t) so it is a tight glint, not a wash.',
    off: { highlightIntensity: 0 } },
  { id: 'glint', label: 'Rim glint',
    note: 'FITTED 0.0856·exp(−d/1.5) — a sharp 1.5px edge. Applied post-coverage: a glint is emissive.',
    off: { rimGlintGain: 0 } },
  { id: 'shadow', label: 'Drop shadow',
    note: 'Not blurred — a degree-7 polynomial evaluates the Gaussian integral (erfc) directly.',
    off: { shadowContribution: 0, shadowOpacity: 0 } },
  { id: 'ring', label: 'Ring shadow (macOS 27)',
    note: 'erfc(inner) − erfc(outer). Subtracting two soft steps gives a soft band for free.',
    on: { ringShadowOpacity: 0.30 } },
  { id: 'keyfill', label: 'Key fill highlight (macOS 27)',
    note: 'Two OPPOSING lobes through a rational soft-knee x/(a(1−x)+1), then summed.',
    on: { keyFillAmount: 0.7 } },
  { id: 'blurfill', label: 'Blur fill (macOS 27)',
    note: 'lighten/darken/base as a partition of unity, then lerp to normal blend.',
    on: { blurFillLightenOpacity: 0.30, blurFillDarkenOpacity: 0.22, blurFillNormalOpacity: 0.15 } },
];

const state = Object.fromEntries(EFFECTS.map(e => [e.id, !e.on]));
let morph = false, diffusionAnim = false, t0 = performance.now();

function currentParams() {
  const p = baseParams();
  for (const e of EFFECTS) {
    if (state[e.id]) { if (e.on) Object.assign(p, e.on); }
    else { if (e.off) Object.assign(p, e.off); }
  }
  if (morph) {
    const t = (performance.now() - t0) / 1000;
    const gap = 220 + 200 * Math.cos(t * 0.9);
    p.extraCount = 1; p.mergeK = 45;
    p.shape2 = [gap, 0, 90, 90];
  }
  if (diffusionAnim) {
    const t = ((performance.now() - t0) / 1400) % 2;
    const x = t < 1 ? t : 2 - t;
    p.diffusion = x * x * (3 - 2 * x);
  }
  return p;
}

async function main() {
  const img = new Image();
  img.src = './backdrop.png';
  await img.decode();

  const bmp = await createImageBitmap(img);
  const panels = [];
  for (const c of document.querySelectorAll('canvas.glass')) {
    try { panels.push(new GlassPanel(c, bmp)); }
    catch (e) {
      document.getElementById('unsupported').hidden = false;
      document.getElementById('unsupported').textContent =
        'WebGL2 is required and unavailable: ' + e.message;
      return;
    }
  }

  const list = document.getElementById('toggles');
  for (const e of EFFECTS) {
    const row = document.createElement('label');
    row.className = 'toggle';
    row.innerHTML =
      `<input type="checkbox" ${state[e.id] ? 'checked' : ''} data-id="${e.id}">
       <span class="tl">${e.label}</span><span class="tn">${e.note}</span>`;
    row.querySelector('input').addEventListener('change', ev => {
      state[e.id] = ev.target.checked;
    });
    list.appendChild(row);
  }
  document.getElementById('morph').addEventListener('change', e => { morph = e.target.checked; t0 = performance.now(); });
  document.getElementById('diffusion').addEventListener('change', e => { diffusionAnim = e.target.checked; t0 = performance.now(); });
  document.getElementById('allOn').addEventListener('click', () => setAll(true));
  document.getElementById('allOff').addEventListener('click', () => setAll(false));

  function setAll(v) {
    for (const e of EFFECTS) state[e.id] = v;
    for (const cb of list.querySelectorAll('input')) cb.checked = v;
  }

  const full = baseParams();
  let dirty = true;
  const markDirty = () => { dirty = true; };
  list.addEventListener('change', markDirty);
  document.getElementById('morph').addEventListener('change', markDirty);
  document.getElementById('diffusion').addEventListener('change', markDirty);
  document.getElementById('allOn').addEventListener('click', markDirty);
  document.getElementById('allOff').addEventListener('click', markDirty);
  window.addEventListener('resize', markDirty);

  (function loop() {
    if (dirty || morph || diffusionAnim) {
      panels[0]?.render(full);
      panels[1]?.render(currentParams());
      dirty = false;
    }
    requestAnimationFrame(loop);
  })();
}

main();
