// The welcome portrait in 3D. One AI portrait, photographed 15 ways (head
// turned in a 5 x 3 grid), is drawn on a finely divided plane that a depth map
// pushes out into real relief: nose and lips forward, hair and shoulders back.
// The whole head turns toward the pointer in perspective, while the texture
// swaps to the frame looking that way, so both the parallax and the eyes follow.

import { LinearFilter, Mesh, PerspectiveCamera, PlaneGeometry, Scene, ShaderMaterial, TextureLoader, WebGLRenderer } from 'three';

const vertexShader = /* glsl */ `
  uniform sampler2D uDepth;
  uniform float uRelief;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec3 p = position;
    p.z += texture2D(uDepth, uv).r * uRelief;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

// Textures are sampled raw (no colour-space decode) and written raw, so the photo keeps its colours.
const fragmentShader = /* glsl */ `
  uniform sampler2D uFrom;
  uniform sampler2D uTo;
  uniform float uMix;
  varying vec2 vUv;
  void main() {
    gl_FragColor = vec4(mix(texture2D(uFrom, vUv).rgb, texture2D(uTo, vUv).rgb, uMix), 1.0);
  }
`;

const YAW = 0.3; // radians the head turns at the edge of the screen
const PITCH = 0.2;
const RELIEF = 0.16; // depth, in plane-height units, of the nose tip over the background
const FADE_MS = 160;

/**
 * Starts the head in `canvas`. `frames` maps "col-row" to an image URL; `depthUrl`
 * is the grayscale depth map (white = near). `onPose(x, y)` gets the head's
 * direction (-1..1) every frame. Returns { stop } once the textures are loaded,
 * or null when WebGL is unavailable.
 */
export async function startHead(canvas, { frames, depthUrl, cols, rows, home, still = false, onPose }) {
  let renderer;
  try {
    renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
  } catch {
    return null;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);

  const loader = new TextureLoader();
  const load = (url) =>
    new Promise((resolve, reject) =>
      loader.load(
        url,
        (t) => {
          t.minFilter = LinearFilter;
          t.generateMipmaps = false;
          resolve(t);
        },
        undefined,
        reject,
      ),
    );
  let textures;
  let depth;
  try {
    const keys = Object.keys(frames);
    const loaded = await Promise.all(keys.map((k) => load(frames[k])));
    textures = Object.fromEntries(keys.map((k, i) => [k, loaded[i]]));
    depth = await load(depthUrl);
  } catch {
    renderer.dispose();
    return null;
  }

  const uniforms = {
    uDepth: { value: depth },
    uRelief: { value: RELIEF },
    uFrom: { value: textures[home] },
    uTo: { value: textures[home] },
    uMix: { value: 1 },
  };
  const scene = new Scene();
  const camera = new PerspectiveCamera(30, 0.8, 0.1, 10);
  camera.position.set(0, 0, 2.55);
  const geometry = new PlaneGeometry(1, 1.25, 160, 200);
  const material = new ShaderMaterial({ uniforms, vertexShader, fragmentShader, transparent: true });
  const head = new Mesh(geometry, material);
  scene.add(head);

  const resize = () => {
    const { clientWidth: w, clientHeight: h } = canvas.parentElement || canvas;
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(h, 1);
    camera.updateProjectionMatrix();
  };
  resize();

  const target = { x: 0, y: 0 };
  const cur = { x: 0, y: 0 };
  let lastMove = -Infinity;
  let shown = home;
  let fadeStart = 0;
  const clamp = (v) => Math.max(-1, Math.min(1, v));
  const onMove = (e) => {
    const r = canvas.getBoundingClientRect();
    // Measured from her eyes, about a third of the way down the portrait.
    target.x = clamp((e.clientX - (r.left + r.width / 2)) / (window.innerWidth * 0.3));
    target.y = clamp((e.clientY - (r.top + r.height * 0.36)) / (window.innerHeight * 0.3));
    lastMove = performance.now();
  };

  const draw = (t) => {
    // No pointer for a while (or a phone): she glances around slowly on her own.
    if (!still && t - lastMove > 3000) {
      target.x = Math.sin(t / 2700) * 0.8;
      target.y = Math.sin(t / 4100) * 0.6;
    }
    cur.x += (target.x - cur.x) * 0.08;
    cur.y += (target.y - cur.y) * 0.08;
    head.rotation.y = cur.x * YAW;
    head.rotation.x = cur.y * PITCH;
    const col = Math.round(((cur.x + 1) / 2) * (cols - 1));
    const row = Math.round(((cur.y + 1) / 2) * (rows - 1));
    const key = `${col}-${row}`;
    if (key !== shown && textures[key]) {
      uniforms.uFrom.value = uniforms.uTo.value;
      uniforms.uTo.value = textures[key];
      shown = key;
      fadeStart = t;
    }
    uniforms.uMix.value = Math.min(1, (t - fadeStart) / FADE_MS);
    onPose?.(cur.x, cur.y);
    renderer.render(scene, camera);
  };

  // Only animate while on screen and the tab is visible.
  let raf = 0;
  let visible = true;
  const loop = (t) => {
    raf = requestAnimationFrame(loop);
    draw(t);
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
    if (!raf) draw(performance.now());
  });
  ro.observe(canvas.parentElement || canvas);

  window.addEventListener('pointermove', onMove, { passive: true });
  document.addEventListener('visibilitychange', onVisibility);
  draw(performance.now());
  play();

  return {
    stop() {
      pause();
      io.disconnect();
      ro.disconnect();
      window.removeEventListener('pointermove', onMove);
      document.removeEventListener('visibilitychange', onVisibility);
      geometry.dispose();
      material.dispose();
      Object.values(textures).forEach((t) => t.dispose());
      depth.dispose();
      renderer.dispose();
    },
  };
}
