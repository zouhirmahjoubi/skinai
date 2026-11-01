// The ambient background: one full-screen shader drawing three soft hazes
// (lilac, pine, oatmeal). Plain WebGL, so app screens never download three.js.
// It does not loop: the hazes glide for a moment when a screen opens, then hold
// still, because a background that keeps drifting costs battery and can make
// someone on treatment feel sick. Colours come from the --paper and --ambient-*
// tokens, so they follow the themes.

import { reducedMotion } from './reduced.js';

const GLIDE_MS = 2600;
const RENDER_SCALE = 0.5; // it is all soft gradients, so half resolution costs nothing visible
const GLIDE_SPEED = 12; // how far the hazes travel, in shader seconds per real second, at the start of a glide

const vertexSource = `
  attribute vec2 aPos;
  varying vec2 vUv;
  void main() { vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const fragmentSource = `
  precision mediump float;
  uniform float uTime;
  uniform vec2 uRes;
  uniform vec3 uBase;
  uniform vec3 uA;
  uniform vec3 uB;
  uniform vec3 uC;
  varying vec2 vUv;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float fbm(vec2 p) { return 0.5 * noise(p) + 0.25 * noise(p * 2.02); }
  float haze(vec2 p, vec2 c, float r) { return smoothstep(r, 0.0, length(p - c)); }

  void main() {
    float aspect = uRes.x / uRes.y;
    vec2 p = vec2(vUv.x * aspect, vUv.y);
    float t = uTime * 0.035;
    // Warp the space with slow noise so the hazes breathe instead of sliding.
    vec2 warp = vec2(fbm(p * 1.3 + t), fbm(p * 1.3 - t + 5.2)) - 0.375;
    vec2 q = p + warp * 0.42;
    // Lissajous drift: different periods on x and y, so the path barely repeats.
    vec2 cA = vec2((0.16 + 0.07 * sin(t * 2.1)) * aspect, 0.84 + 0.05 * cos(t * 1.7));
    vec2 cB = vec2((0.88 + 0.06 * cos(t * 1.3)) * aspect, 0.14 + 0.06 * sin(t * 1.9));
    vec2 cC = vec2((0.55 + 0.09 * sin(t * 1.1)) * aspect, 0.5 + 0.08 * cos(t * 2.3));
    vec3 col = uBase;
    col = mix(col, uC, haze(q, cC, 0.62) * 0.85);
    col = mix(col, uA, haze(q, cA, 0.72) * 0.95);
    col = mix(col, uB, haze(q, cB, 0.66) * 0.9);
    // A whisper of grain stops gradient banding on 8-bit screens.
    col += (hash(gl_FragCoord.xy) - 0.5) * 0.01;
    gl_FragColor = vec4(col, 1.0);
  }
`;

// Any CSS colour to 0..1 RGB, by letting the browser parse it.
const probe = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
function rgb(name, fallback) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  probe.fillStyle = fallback;
  probe.fillStyle = value;
  probe.fillRect(0, 0, 1, 1);
  const [r, g, b] = probe.getImageData(0, 0, 1, 1).data;
  return [r / 255, g / 255, b / 255];
}

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  return shader;
}

/**
 * Starts the background on `canvas`. With reduced motion or Less motion it holds
 * still, checked at each glide so the Settings switch counts at once. Returns a
 * stop function, or null when WebGL is unavailable or slow, in which case the CSS
 * gradient underneath stays in place.
 */
export function startAmbient(canvas) {
  const gl = canvas.getContext('webgl', { alpha: false, antialias: false, powerPreference: 'low-power', failIfMajorPerformanceCaveat: true });
  if (!gl) return null;

  const program = gl.createProgram();
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, vertexSource));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fragmentSource));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(program, 'aPos');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
  const u = Object.fromEntries(['uTime', 'uRes', 'uBase', 'uA', 'uB', 'uC'].map((n) => [n, gl.getUniformLocation(program, n)]));

  // A random start, so the composition differs a little on each visit.
  let time = Math.random() * 60;
  const draw = () => {
    gl.uniform1f(u.uTime, time);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };
  const applyTheme = () => {
    gl.uniform3fv(u.uBase, rgb('--paper', '#f6f1e8'));
    gl.uniform3fv(u.uA, rgb('--ambient-a', '#e6daf1'));
    gl.uniform3fv(u.uB, rgb('--ambient-b', '#d6e2d8'));
    gl.uniform3fv(u.uC, rgb('--ambient-c', '#ebe0cc'));
    draw();
  };
  const resize = () => {
    const scale = Math.min(window.devicePixelRatio || 1, 2) * RENDER_SCALE;
    canvas.width = Math.max(1, Math.round(window.innerWidth * scale));
    canvas.height = Math.max(1, Math.round(window.innerHeight * scale));
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(u.uRes, canvas.width, canvas.height);
    draw();
  };

  // A glide eases out to a stop, then nothing runs until the next screen opens.
  let raf = 0;
  const glide = () => {
    if (reducedMotion() || raf || document.hidden) return;
    let last = performance.now();
    const t0 = last;
    const step = (now) => {
      const p = (now - t0) / GLIDE_MS;
      if (p >= 1) {
        raf = 0;
        return;
      }
      time += ((now - last) / 1000) * GLIDE_SPEED * (1 - p) * (1 - p);
      last = now;
      draw();
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  };

  const scheme = window.matchMedia('(prefers-color-scheme: dark)');
  window.addEventListener('resize', resize);
  window.addEventListener('hashchange', glide);
  window.addEventListener('palettechange', applyTheme);
  scheme.addEventListener('change', applyTheme);
  resize();
  applyTheme();
  glide();

  return () => {
    cancelAnimationFrame(raf);
    raf = 0;
    window.removeEventListener('resize', resize);
    window.removeEventListener('hashchange', glide);
    window.removeEventListener('palettechange', applyTheme);
    scheme.removeEventListener('change', applyTheme);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  };
}
