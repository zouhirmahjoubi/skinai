// Gold dust, drawn with three.js: a few hundred motes at different depths, in the
// paintings' own gold, parchment and lavender. Loaded on its own, after the page is up.
// Nothing here loops. On the welcome page the motes move only when the scroll or the
// pointer does, and each dissolve throws them outward. On an app screen they rise once
// when the painting opens, then the scene is thrown away.

import { BufferGeometry, Float32BufferAttribute, PerspectiveCamera, Points, Scene, ShaderMaterial, WebGLRenderer } from 'three';

const vertexShader = /* glsl */ `
  uniform float uTravel;
  uniform float uLift;
  uniform float uFade;
  uniform float uPx;
  uniform float uAspect;
  uniform vec2 uPointer;
  attribute vec4 aSeed;
  varying float vAlpha;
  varying float vHue;
  void main() {
    float t = uTravel * (0.35 + aSeed.x);
    float y = mod(position.y + 1.0 + t, 2.0) - 1.0;
    float x = position.x + sin(aSeed.y * 6.283 + t * 2.4) * 0.05;
    // A dissolve throws the motes outward from the middle of the picture.
    vec2 dir = normalize(vec2(x, y) + 0.0001);
    vec2 xy = vec2(x, y) + dir * uLift * (0.06 + aSeed.x * 0.16);
    // Nearer motes follow the pointer further, which is what gives the depth.
    xy += uPointer * (position.z + 1.0) * 0.035;
    vec4 mv = modelViewMatrix * vec4(xy.x * uAspect, xy.y, position.z * 0.9, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uPx * (0.5 + aSeed.z * 1.6) * (1.0 + uLift * 0.6) * (3.0 / -mv.z);
    float edge = smoothstep(1.0, 0.82, abs(y));
    vAlpha = uFade * edge * (0.18 + 0.82 * uLift) * (0.35 + 0.65 * aSeed.w);
    vHue = aSeed.y;
  }
`;

const fragmentShader = /* glsl */ `
  precision mediump float;
  varying float vAlpha;
  varying float vHue;
  void main() {
    float r = length(gl_PointCoord - 0.5);
    if (r > 0.5) discard;
    float core = smoothstep(0.5, 0.05, r);
    vec3 gold = vec3(0.90, 0.74, 0.42);
    vec3 pale = vec3(1.0, 0.97, 0.86);
    vec3 lavender = vec3(0.80, 0.70, 0.91);
    vec3 colour = vHue < 0.72 ? gold : (vHue < 0.92 ? pale : lavender);
    gl_FragColor = vec4(colour, vAlpha * core * core);
  }
`;

// At this angle a plane two units tall exactly fills the view from three units away.
const FOV = 36.87;

function build(canvas, count, size) {
  let renderer;
  try {
    renderer = new WebGLRenderer({ canvas, alpha: true, antialias: false, powerPreference: 'low-power', failIfMajorPerformanceCaveat: true });
  } catch {
    return null;
  }
  renderer.setClearColor(0x000000, 0);

  const position = new Float32Array(count * 3);
  const seed = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    position.set([Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1], i * 3);
    seed.set([Math.random(), Math.random(), Math.random(), Math.random()], i * 4);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(position, 3));
  geometry.setAttribute('aSeed', new Float32BufferAttribute(seed, 4));

  const uniforms = {
    uTravel: { value: 0 },
    uLift: { value: 0 },
    uFade: { value: 1 },
    uPx: { value: size },
    uAspect: { value: 1 },
    uPointer: { value: [0, 0] },
  };
  const material = new ShaderMaterial({ uniforms, vertexShader, fragmentShader, transparent: true, depthWrite: false, depthTest: false });
  const points = new Points(geometry, material);
  points.frustumCulled = false;
  const scene = new Scene();
  scene.add(points);
  const camera = new PerspectiveCamera(FOV, 1, 0.1, 10);
  camera.position.z = 3;

  const resize = () => {
    const w = canvas.clientWidth || 1;
    const h = canvas.clientHeight || 1;
    const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
    renderer.setPixelRatio(ratio);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    uniforms.uAspect.value = w / h;
    uniforms.uPx.value = size * ratio;
  };
  resize();

  return {
    uniforms,
    resize,
    render: () => renderer.render(scene, camera),
    dispose() {
      geometry.dispose();
      material.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}

/**
 * The welcome page's dust, over the shared stage. Returns { draw({ travel, lift }),
 * point(x, y), stop() }, or null when WebGL is missing or slow.
 */
export function startDust(canvas, { count = 420, size = 3.4, fine = false } = {}) {
  const dust = build(canvas, count, size);
  if (!dust) return null;
  const { uniforms } = dust;
  let raf = 0;
  const target = [0, 0];

  // Eases toward the pointer, then stops: nothing runs once the motes have caught up.
  const settle = () => {
    raf = 0;
    const p = uniforms.uPointer.value;
    const dx = target[0] - p[0];
    const dy = target[1] - p[1];
    p[0] += dx * 0.08;
    p[1] += dy * 0.08;
    dust.render();
    if (Math.abs(dx) + Math.abs(dy) > 0.002) raf = requestAnimationFrame(settle);
  };
  const onPointer = (e) => {
    target[0] = (e.clientX / window.innerWidth) * 2 - 1;
    target[1] = 1 - (e.clientY / window.innerHeight) * 2;
    if (!raf) raf = requestAnimationFrame(settle);
  };
  const onResize = () => {
    dust.resize();
    dust.render();
  };
  if (fine) window.addEventListener('pointermove', onPointer, { passive: true });
  window.addEventListener('resize', onResize);

  return {
    draw({ travel, lift }) {
      uniforms.uTravel.value = travel;
      uniforms.uLift.value = lift;
      dust.render();
    },
    stop() {
      cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onPointer);
      window.removeEventListener('resize', onResize);
      dust.dispose();
    },
  };
}

const RISE_MS = 2400;

/** One short rise over a painting on an app screen, then gone. Returns a function that ends it early. */
export function riseDust(canvas) {
  const dust = build(canvas, 130, 3);
  if (!dust) return () => {};
  const { uniforms } = dust;
  let raf = 0;
  let ended = false;
  const t0 = performance.now();
  const end = () => {
    if (ended) return;
    ended = true;
    cancelAnimationFrame(raf);
    dust.dispose();
  };
  const step = (now) => {
    const t = Math.min(1, (now - t0) / RISE_MS);
    const out = 1 - (1 - t) * (1 - t);
    uniforms.uTravel.value = out * 0.5;
    uniforms.uLift.value = 0.55 * (1 - t);
    uniforms.uFade.value = Math.sin(Math.PI * t);
    dust.render();
    if (t < 1) raf = requestAnimationFrame(step);
    else end();
  };
  raf = requestAnimationFrame(step);
  return end;
}
