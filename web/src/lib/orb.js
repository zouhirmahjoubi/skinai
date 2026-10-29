// The welcome visual: a glass orb with two slow scan rings, drawn with
// three.js. A soft band sweeps over it like a check-in reading skin, and the
// rim catches lilac light. Colours come from the --orb-* tokens. Loaded on
// demand; until then a CSS gradient orb stands in.

import {
  AdditiveBlending,
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  TorusGeometry,
  Vector2,
  WebGLRenderer,
} from 'three';

const vertexShader = /* glsl */ `
  uniform float uTime;
  varying vec3 vNormal;
  varying vec3 vView;
  varying vec3 vPos;
  // Cheap smooth 3D noise: the surface breathes a little, never wobbles.
  float h(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
  float n3(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(h(i), h(i + vec3(1, 0, 0)), f.x), mix(h(i + vec3(0, 1, 0)), h(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(h(i + vec3(0, 0, 1)), h(i + vec3(1, 0, 1)), f.x), mix(h(i + vec3(0, 1, 1)), h(i + vec3(1, 1, 1)), f.x), f.y), f.z);
  }
  void main() {
    vec3 p = position;
    float d = n3(p * 1.6 + uTime * 0.12) - 0.5;
    p += normal * d * 0.06;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vNormal = normalize(normalMatrix * normal);
    vView = normalize(-mv.xyz);
    vPos = position;
    gl_Position = projectionMatrix * mv;
  }
`;

const fragmentShader = /* glsl */ `
  uniform float uTime;
  uniform float uScan;
  uniform vec3 uCore;
  uniform vec3 uGlow;
  uniform vec3 uLight;
  varying vec3 vNormal;
  varying vec3 vView;
  varying vec3 vPos;
  void main() {
    float fres = pow(1.0 - max(dot(vNormal, vView), 0.0), 2.2);
    // Body: mostly oatmeal light, settling into pine only at the lower edge,
    // with lilac in the shade so it reads as glass rather than stone.
    float up = smoothstep(-1.25, 0.85, vPos.y + vPos.x * 0.2);
    vec3 col = mix(uCore, uLight, up);
    col = mix(col, uGlow, 0.22 * (1.0 - up));
    float key = max(dot(vNormal, normalize(vec3(-0.5, 0.7, 0.6))), 0.0);
    col += uLight * pow(key, 6.0) * 0.35;
    // Lilac rim, like light caught in glass.
    col = mix(col, uGlow, fres * 0.9);
    // A soft scan band drifting down the orb.
    float band = smoothstep(0.09, 0.0, abs(vPos.y - uScan));
    col += uGlow * band * 0.35;
    float alpha = 0.92 + fres * 0.08;
    gl_FragColor = vec4(col, alpha);
  }
`;

// Linear colours for the built-in ring material (three.js converts those on output),
// and sRGB copies for the raw shader, which writes its colour straight to the screen.
function orbColors() {
  const css = getComputedStyle(document.documentElement);
  const read = (name, fallback) => new Color(css.getPropertyValue(name).trim() || fallback);
  const core = read('--orb-core', '#1f3b2e');
  const glow = read('--orb-glow', '#cbb3e8');
  const light = read('--orb-light', '#f3ece0');
  const srgb = (c) => c.clone().convertLinearToSRGB();
  return { ring: glow, core: srgb(core), glow: srgb(glow), light: srgb(light) };
}

/**
 * Starts the orb in `canvas` (sized by its container). `still` draws one frame
 * (reduced motion). Returns { stop, setProgress } or null without WebGL.
 * setProgress(0..1) lets scroll turn the orb a little further.
 */
export function startOrb(canvas, { still = false } = {}) {
  let renderer;
  try {
    renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
  } catch {
    return null;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setClearColor(0x000000, 0);

  const c = orbColors();
  const uniforms = {
    uTime: { value: 0 },
    uScan: { value: 0 },
    uCore: { value: c.core },
    uGlow: { value: c.glow },
    uLight: { value: c.light },
  };
  const scene = new Scene();
  const camera = new PerspectiveCamera(32, 1, 0.1, 20);
  camera.position.set(0, 0, 5.2);

  const group = new Group();
  scene.add(group);
  const sphereGeo = new SphereGeometry(1, 96, 96);
  const sphereMat = new ShaderMaterial({ uniforms, vertexShader, fragmentShader, transparent: true });
  group.add(new Mesh(sphereGeo, sphereMat));

  // Two hairline rings on different tilts, turning at different speeds.
  const ringGeo = new TorusGeometry(1.38, 0.006, 8, 160);
  const ringMat = new MeshBasicMaterial({ color: c.ring, transparent: true, opacity: 0.75, blending: AdditiveBlending, depthWrite: false });
  const ringA = new Mesh(ringGeo, ringMat);
  const ringB = new Mesh(ringGeo, ringMat.clone());
  ringA.rotation.set(1.15, 0.2, 0);
  ringB.rotation.set(1.45, -0.6, 0.4);
  ringB.scale.setScalar(1.12);
  ringB.material.opacity = 0.4;
  group.add(ringA, ringB);

  const resize = () => {
    const { clientWidth: w, clientHeight: h } = canvas.parentElement || canvas;
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(h, 1);
    camera.updateProjectionMatrix();
  };
  resize();

  const pointer = new Vector2(0, 0);
  const target = new Vector2(0, 0);
  let progress = 0;
  const t0 = performance.now();
  const draw = (now) => {
    const t = (now - t0) / 1000;
    uniforms.uTime.value = t;
    uniforms.uScan.value = Math.cos(t * 0.45) * 0.95;
    pointer.lerp(target, 0.05);
    group.rotation.y = t * 0.12 + progress * 1.4 + pointer.x * 0.25;
    group.rotation.x = -pointer.y * 0.18;
    ringA.rotation.z = t * 0.25;
    ringB.rotation.z = -t * 0.18;
    renderer.render(scene, camera);
  };

  const onPointer = (e) => {
    if (e.pointerType !== 'mouse') return;
    target.set((e.clientX / window.innerWidth) * 2 - 1, (e.clientY / window.innerHeight) * 2 - 1);
  };

  // Only animate while the orb is on screen and the tab is visible.
  let raf = 0;
  let visible = true;
  const loop = (now) => {
    raf = requestAnimationFrame(loop);
    draw(now);
  };
  const play = () => {
    if (!raf && !still && visible && !document.hidden) raf = requestAnimationFrame(loop);
  };
  const pause = () => {
    cancelAnimationFrame(raf);
    raf = 0;
  };
  const io = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    visible ? play() : pause();
  });
  io.observe(canvas);
  const onVisibility = () => (document.hidden ? pause() : play());
  const ro = new ResizeObserver(() => {
    resize();
    if (still || !raf) draw(performance.now());
  });
  ro.observe(canvas.parentElement || canvas);
  const scheme = window.matchMedia('(prefers-color-scheme: dark)');
  const onScheme = () => {
    const next = orbColors();
    uniforms.uCore.value.copy(next.core);
    uniforms.uGlow.value.copy(next.glow);
    uniforms.uLight.value.copy(next.light);
    ringA.material.color.copy(next.ring);
    ringB.material.color.copy(next.ring);
    if (still) draw(performance.now());
  };

  window.addEventListener('pointermove', onPointer, { passive: true });
  window.addEventListener('palettechange', onScheme);
  document.addEventListener('visibilitychange', onVisibility);
  scheme.addEventListener('change', onScheme);
  draw(performance.now());
  play();

  return {
    setProgress(p) {
      progress = p;
      if (still) draw(performance.now());
    },
    stop() {
      pause();
      io.disconnect();
      ro.disconnect();
      window.removeEventListener('pointermove', onPointer);
      window.removeEventListener('palettechange', onScheme);
      document.removeEventListener('visibilitychange', onVisibility);
      scheme.removeEventListener('change', onScheme);
      sphereGeo.dispose();
      sphereMat.dispose();
      ringGeo.dispose();
      ringMat.dispose();
      ringB.material.dispose();
      renderer.dispose();
    },
  };
}
