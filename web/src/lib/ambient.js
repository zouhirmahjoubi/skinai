// The ambient background: one full-screen three.js shader drawing three soft
// hazes (lilac, pine, oatmeal) that drift slowly. Loaded on demand, so the
// rest of the app never waits for three.js. Colours come from the
// --paper and --ambient-* tokens, so they follow the light and dark themes.

import { Color, Mesh, OrthographicCamera, PlaneGeometry, Scene, ShaderMaterial, Vector2, WebGLRenderer } from 'three';

const FPS = 30; // the motion is slow; 30 fps looks the same and halves the work
const RENDER_SCALE = 0.5; // it is all soft gradients, so half resolution costs nothing visible

const fragmentShader = /* glsl */ `
  precision mediump float;
  uniform float uTime;
  uniform vec2 uRes;
  uniform vec2 uPointer;
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
  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.02; a *= 0.5; }
    return v;
  }
  float haze(vec2 p, vec2 c, float r) { return smoothstep(r, 0.0, length(p - c)); }

  void main() {
    float aspect = uRes.x / uRes.y;
    vec2 p = vec2(vUv.x * aspect, vUv.y);
    float t = uTime * 0.035;
    // Warp the space with slow noise so the hazes breathe instead of sliding.
    vec2 warp = vec2(fbm(p * 1.3 + t), fbm(p * 1.3 - t + 5.2)) - 0.5;
    vec2 q = p + warp * 0.32 + (uPointer - 0.5) * 0.03;
    // Lissajous drift: different periods on x and y, so the path barely repeats.
    vec2 cA = vec2((0.16 + 0.07 * sin(t * 2.1)) * aspect, 0.84 + 0.05 * cos(t * 1.7));
    vec2 cB = vec2((0.88 + 0.06 * cos(t * 1.3)) * aspect, 0.14 + 0.06 * sin(t * 1.9));
    vec2 cC = vec2((0.55 + 0.09 * sin(t * 1.1)) * aspect, 0.5 + 0.08 * cos(t * 2.3));
    vec3 col = uBase;
    col = mix(col, uC, haze(q, cC, 0.62) * 0.85);
    col = mix(col, uA, haze(q, cA, 0.72) * 0.95);
    col = mix(col, uB, haze(q, cB, 0.66) * 0.9);
    // A whisper of grain stops gradient banding on 8-bit screens.
    col += (hash(gl_FragCoord.xy + fract(uTime)) - 0.5) * 0.01;
    gl_FragColor = vec4(col, 1.0);
  }
`;

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

function themeColors() {
  const css = getComputedStyle(document.documentElement);
  // three.js keeps colours in linear space; this raw shader writes them straight
  // to the screen, so hand it the sRGB values the CSS tokens actually name.
  const read = (name, fallback) => new Color(css.getPropertyValue(name).trim() || fallback).convertLinearToSRGB();
  return {
    uBase: read('--paper', '#f6f1e8'),
    uA: read('--ambient-a', '#e6daf1'),
    uB: read('--ambient-b', '#d6e2d8'),
    uC: read('--ambient-c', '#ebe0cc'),
  };
}

/**
 * Starts the background on `canvas`. With `still`, it draws one frame and
 * stops (reduced motion). Returns a stop function, or null when WebGL is
 * unavailable, in which case the CSS gradient underneath stays in place.
 */
export function startAmbient(canvas, { still = false } = {}) {
  let renderer;
  try {
    renderer = new WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'low-power' });
  } catch {
    return null;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2) * RENDER_SCALE);

  const colors = themeColors();
  const uniforms = {
    uTime: { value: 0 },
    uRes: { value: new Vector2(1, 1) },
    uPointer: { value: new Vector2(0.5, 0.5) },
    uBase: { value: colors.uBase },
    uA: { value: colors.uA },
    uB: { value: colors.uB },
    uC: { value: colors.uC },
  };
  const scene = new Scene();
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const geometry = new PlaneGeometry(2, 2);
  const material = new ShaderMaterial({ uniforms, vertexShader, fragmentShader, depthTest: false, depthWrite: false });
  scene.add(new Mesh(geometry, material));

  const resize = () => {
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    uniforms.uRes.value.set(window.innerWidth, window.innerHeight);
  };
  resize();

  // A random start time, so the composition differs a little on each visit.
  const t0 = performance.now() - Math.random() * 60_000;
  const draw = (now) => {
    uniforms.uTime.value = (now - t0) / 1000;
    renderer.render(scene, camera);
  };

  // The hazes lean very slightly toward a mouse pointer (never on touch).
  const target = new Vector2(0.5, 0.5);
  const onPointer = (e) => {
    if (e.pointerType === 'mouse') target.set(e.clientX / window.innerWidth, 1 - e.clientY / window.innerHeight);
  };

  let raf = 0;
  let last = 0;
  const loop = (now) => {
    raf = requestAnimationFrame(loop);
    if (now - last < 1000 / FPS) return;
    last = now;
    uniforms.uPointer.value.lerp(target, 0.04);
    draw(now);
  };
  const play = () => {
    if (!raf && !still && !document.hidden) raf = requestAnimationFrame(loop);
  };
  const pause = () => {
    cancelAnimationFrame(raf);
    raf = 0;
  };
  const onVisibility = () => (document.hidden ? pause() : play());

  const scheme = window.matchMedia('(prefers-color-scheme: dark)');
  const onScheme = () => {
    const next = themeColors();
    uniforms.uA.value.copy(next.uA);
    uniforms.uB.value.copy(next.uB);
    uniforms.uC.value.copy(next.uC);
    uniforms.uBase.value.copy(next.uBase);
    if (still) draw(performance.now());
  };
  const onResize = () => {
    resize();
    if (still) draw(performance.now());
  };

  window.addEventListener('resize', onResize);
  window.addEventListener('pointermove', onPointer, { passive: true });
  document.addEventListener('visibilitychange', onVisibility);
  scheme.addEventListener('change', onScheme);
  draw(performance.now());
  play();

  return () => {
    pause();
    window.removeEventListener('resize', onResize);
    window.removeEventListener('pointermove', onPointer);
    document.removeEventListener('visibilitychange', onVisibility);
    scheme.removeEventListener('change', onScheme);
    geometry.dispose();
    material.dispose();
    renderer.dispose();
  };
}
