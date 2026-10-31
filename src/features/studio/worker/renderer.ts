/**
 * WebGL2 compositor (runs in the worker on an OffscreenCanvas).
 *
 * Passes per frame:
 *   [blur only]  frame → quarter-res FBO → separable Gaussian (×2)
 *   composite    mix(background, frame, person mask)  → full-res FBO
 *   effect       colour/texture effect                  → canvas
 *
 * Orientation: textures uploaded from VideoFrame / ImageBitmap / mask bytes have row 0 at the top,
 * so they're sampled with a flipped v; our own FBOs are in GL orientation and sampled as-is.
 */

const VERT = `#version 300 es
in vec2 aPos; out vec2 vUv;
void main(){ vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;

const BLUR = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o;
uniform sampler2D uSrc; uniform vec2 uDir; uniform bool uFlip;
const float W[5] = float[](0.227027, 0.1945946, 0.1216216, 0.054054, 0.016216);
void main(){
  vec2 uv = uFlip ? vec2(vUv.x, 1.0 - vUv.y) : vUv;
  vec2 d = uFlip ? vec2(uDir.x, -uDir.y) : uDir;
  vec3 s = texture(uSrc, uv).rgb * W[0];
  for (int i = 1; i < 5; i++) {
    s += texture(uSrc, uv + d * float(i)).rgb * W[i];
    s += texture(uSrc, uv - d * float(i)).rgb * W[i];
  }
  o = vec4(s, 1.0);
}`;

const COMPOSITE = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o;
uniform sampler2D uFrame, uMask, uBlur, uBg;
uniform int uMode;      // 0 none, 1 blur, 2 image
uniform vec4 uCover;    // background uv = uv * xy + zw (cover fit)
vec2 img(vec2 uv){ return vec2(uv.x, 1.0 - uv.y); }
void main(){
  vec3 fg = texture(uFrame, img(vUv)).rgb;
  if (uMode == 0) { o = vec4(fg, 1.0); return; }
  float m = smoothstep(0.35, 0.8, texture(uMask, img(vUv)).r);
  vec3 bg = uMode == 1 ? texture(uBlur, vUv).rgb : texture(uBg, img(vUv * uCover.xy + uCover.zw)).rgb;
  o = vec4(mix(bg, fg, m), 1.0);
}`;

const EFFECT = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o;
uniform sampler2D uSrc; uniform int uEffect; uniform float uTime; uniform vec2 uRes;
float rnd(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main(){
  vec2 uv = vUv;
  if (uEffect == 5) { vec2 b = vec2(18.0) / uRes; uv = (floor(uv / b) + 0.5) * b; }
  if (uEffect == 4) { vec2 b = vec2(1.0 / 176.0, 1.0 / 99.0); uv = (floor(uv / b) + 0.5) * b; }
  vec3 c;
  if (uEffect == 3) {
    float line = floor(uv.y * 240.0);
    float jitter = (rnd(vec2(floor(uTime * 24.0), line)) - 0.5) * 0.004;
    float off = 0.004 + 0.002 * sin(uTime * 2.7);
    vec2 u2 = uv + vec2(jitter, 0.0);
    c = vec3(texture(uSrc, u2 + vec2(off, 0.0)).r, texture(uSrc, u2).g, texture(uSrc, u2 - vec2(off, 0.0)).b);
    c *= 0.82 + 0.18 * sin(uv.y * uRes.y * 1.5708);
    float band = smoothstep(0.0, 0.02, abs(fract(uv.y * 0.6 - uTime * 0.15) - 0.5));
    c *= mix(0.85, 1.0, band);
    c += (rnd(uv * uRes + uTime) - 0.5) * 0.09;
    c = mix(c, vec3(dot(c, vec3(0.3, 0.59, 0.11))), 0.2);
  } else {
    c = texture(uSrc, uv).rgb;
  }
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  if (uEffect == 1) c = vec3(l);
  else if (uEffect == 2) {
    vec3 sepia = vec3(l) * vec3(1.08, 0.82, 0.58);
    c = mix(c, sepia, 0.8);
    c *= mix(0.55, 1.0, smoothstep(0.85, 0.25, length(vUv - 0.5)));
    c += (rnd(vUv * uRes + floor(uTime * 24.0)) - 0.5) * 0.07;
  }
  else if (uEffect == 4) { c = floor(c * 6.0 + 0.5) / 6.0; c *= vec3(0.96, 1.04, 0.92); }
  else if (uEffect == 6) {
    float g = pow(l, 0.75) * 1.7 + (rnd(vUv * uRes + uTime) - 0.5) * 0.18;
    c = vec3(0.12, 1.0, 0.25) * g * smoothstep(0.78, 0.3, length(vUv - 0.5));
  }
  else if (uEffect == 7) c = 1.0 - c;
  o = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

type Target = { fbo: WebGLFramebuffer; tex: WebGLTexture; w: number; h: number };

export class Renderer {
  private gl: WebGL2RenderingContext;
  private progs: { blur: WebGLProgram; composite: WebGLProgram; effect: WebGLProgram };
  private frameTex: WebGLTexture;
  private maskTex: WebGLTexture;
  private bgTex: WebGLTexture;
  private bgSize = { w: 1, h: 1 };
  private targets: { comp?: Target; blurA?: Target; blurB?: Target } = {};
  private width = 0;
  private height = 0;
  private uniforms = new Map<string, WebGLUniformLocation | null>();

  constructor(readonly canvas: OffscreenCanvas) {
    const gl = canvas.getContext("webgl2", {
      alpha: false,
      antialias: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
    });
    if (!gl) throw new Error("WebGL2 isn't available");
    this.gl = gl;
    this.progs = { blur: this.program(BLUR), composite: this.program(COMPOSITE), effect: this.program(EFFECT) };
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    this.frameTex = this.texture();
    this.maskTex = this.texture();
    this.bgTex = this.texture();
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  }

  private program(frag: string): WebGLProgram {
    const gl = this.gl;
    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`shader: ${gl.getShaderInfoLog(s)}`);
      return s;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, frag));
    gl.bindAttribLocation(p, 0, "aPos");
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`link: ${gl.getProgramInfoLog(p)}`);
    return p;
  }

  private u(p: WebGLProgram, name: string) {
    const key = `${this.progName(p)}:${name}`;
    if (!this.uniforms.has(key)) this.uniforms.set(key, this.gl.getUniformLocation(p, name));
    return this.uniforms.get(key)!;
  }
  private progName(p: WebGLProgram) {
    return p === this.progs.blur ? "b" : p === this.progs.composite ? "c" : "e";
  }

  private texture() {
    const gl = this.gl;
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  private target(w: number, h: number): Target {
    const gl = this.gl;
    const tex = this.texture();
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return { fbo, tex, w, h };
  }

  private resize(w: number, h: number) {
    if (w === this.width && h === this.height) return;
    this.width = w;
    this.height = h;
    this.canvas.width = w;
    this.canvas.height = h;
    const gl = this.gl;
    for (const t of Object.values(this.targets)) {
      if (!t) continue;
      gl.deleteFramebuffer(t.fbo);
      gl.deleteTexture(t.tex);
    }
    const bw = Math.max(1, Math.round(w / 4));
    const bh = Math.max(1, Math.round(h / 4));
    this.targets = { comp: this.target(w, h), blurA: this.target(bw, bh), blurB: this.target(bw, bh) };
  }

  setBackground(bitmap: ImageBitmap | null) {
    if (!bitmap) return;
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.bgTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
    this.bgSize = { w: bitmap.width, h: bitmap.height };
  }

  /** Person-confidence mask (0..255, row 0 = top). */
  setMask(bytes: Uint8Array, w: number, h: number) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.maskTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, w, h, 0, gl.RED, gl.UNSIGNED_BYTE, bytes);
  }

  private draw(p: WebGLProgram, target: Target | null) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target?.fbo ?? null);
    gl.viewport(0, 0, target?.w ?? this.width, target?.h ?? this.height);
    gl.useProgram(p);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  private bind(unit: number, tex: WebGLTexture, p: WebGLProgram, name: string) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(this.u(p, name), unit);
  }

  render(frame: VideoFrame, opts: { mode: 0 | 1 | 2; blurStrength: number; effect: number; time: number }) {
    const gl = this.gl;
    const w = frame.displayWidth;
    const h = frame.displayHeight;
    this.resize(w, h);
    gl.bindTexture(gl.TEXTURE_2D, this.frameTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, frame);

    const { comp, blurA, blurB } = this.targets as Required<typeof this.targets>;
    if (opts.mode === 1) {
      const b = this.progs.blur;
      const k = 1 + opts.blurStrength * 3.5;
      const passes: [WebGLTexture, Target, [number, number], boolean][] = [
        [this.frameTex, blurA, [k / blurA.w, 0], true],
        [blurA.tex, blurB, [0, k / blurA.h], false],
        [blurB.tex, blurA, [k / blurA.w, 0], false],
        [blurA.tex, blurB, [0, k / blurA.h], false],
      ];
      for (const [src, dst, dir, flip] of passes) {
        gl.useProgram(b);
        this.bind(0, src, b, "uSrc");
        gl.uniform2f(this.u(b, "uDir"), dir[0], dir[1]);
        gl.uniform1i(this.u(b, "uFlip"), flip ? 1 : 0);
        this.draw(b, dst);
      }
    }

    const c = this.progs.composite;
    gl.useProgram(c);
    this.bind(0, this.frameTex, c, "uFrame");
    this.bind(1, this.maskTex, c, "uMask");
    this.bind(2, blurB.tex, c, "uBlur");
    this.bind(3, this.bgTex, c, "uBg");
    gl.uniform1i(this.u(c, "uMode"), opts.mode);
    // Cover-fit the background image into the frame.
    const fa = w / h;
    const ba = this.bgSize.w / this.bgSize.h;
    const sx = fa < ba ? fa / ba : 1;
    const sy = fa < ba ? 1 : ba / fa;
    gl.uniform4f(this.u(c, "uCover"), sx, sy, (1 - sx) / 2, (1 - sy) / 2);
    this.draw(c, comp);

    const e = this.progs.effect;
    gl.useProgram(e);
    this.bind(0, comp.tex, e, "uSrc");
    gl.uniform1i(this.u(e, "uEffect"), opts.effect);
    gl.uniform1f(this.u(e, "uTime"), opts.time);
    gl.uniform2f(this.u(e, "uRes"), w, h);
    this.draw(e, null);
  }
}
