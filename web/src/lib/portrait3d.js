// The welcome moment, drawn with three.js: the portrait gathers from thousands
// of points, face first and hair last, then the crisp photo takes over and this
// scene is thrown away, so nothing keeps running. Loaded only on the welcome
// page. Colours come straight from the photo.

import { BufferGeometry, Float32BufferAttribute, LinearFilter, NoColorSpace, PerspectiveCamera, Points, Scene, ShaderMaterial, TextureLoader, WebGLRenderer } from 'three';

const vertexShader = /* glsl */ `
  uniform float uProgress;
  uniform float uCell;
  uniform float uDist;
  uniform sampler2D uMap;
  attribute vec2 aUv;
  attribute vec4 aRand;
  varying vec2 vUv;
  varying float vAlpha;
  void main() {
    vUv = aUv;
    // The centre of the face settles first, then outward: hair and shoulders last.
    float d = distance(aUv, vec2(0.5, 0.58));
    float delay = clamp(d * 0.95, 0.0, 0.55) + aRand.w * 0.12;
    float t = clamp((uProgress - delay) / 0.33, 0.0, 1.0);
    t = 1.0 - pow(1.0 - t, 3.0);
    // Each point drifts in from a loose cloud around where it belongs.
    vec3 from = position + vec3((aRand.x - 0.5) * 1.1, (aRand.y - 0.5) * 1.1, (aRand.z - 0.5) * 0.9);
    vec3 p = mix(from, position, t);
    // Brighter points sit a little nearer while it gathers, so the face has depth.
    float lum = dot(texture2D(uMap, aUv).rgb, vec3(0.3, 0.59, 0.11));
    p.z += (lum - 0.5) * 0.16 * (1.0 - t);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uCell * mix(1.1, 2.1, t) * (uDist / -mv.z);
    vAlpha = smoothstep(0.0, 0.3, t);
  }
`;

const fragmentShader = /* glsl */ `
  precision mediump float;
  uniform sampler2D uMap;
  varying vec2 vUv;
  varying float vAlpha;
  void main() {
    float r = length(gl_PointCoord - 0.5);
    if (r > 0.5) discard;
    gl_FragColor = vec4(texture2D(uMap, vUv).rgb, vAlpha * smoothstep(0.5, 0.32, r));
  }
`;

const FOV = 30;

/**
 * Prepares the scene on `canvas` for the photo at `src`. Resolves to
 * { render(progress 0..1), stop() }, or null when WebGL is missing or slow.
 */
export async function startPortrait(canvas, src) {
  let renderer;
  try {
    renderer = new WebGLRenderer({ canvas, alpha: true, antialias: false, powerPreference: 'low-power', failIfMajorPerformanceCaveat: true });
  } catch {
    return null;
  }
  const texture = await new TextureLoader().loadAsync(src).catch(() => null);
  if (!texture) {
    renderer.dispose();
    return null;
  }
  texture.colorSpace = NoColorSpace;
  texture.minFilter = LinearFilter;
  texture.generateMipmaps = false;

  const w = canvas.clientWidth || 1;
  const h = canvas.clientHeight || 1;
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(w, h, false);
  renderer.setClearColor(0x000000, 0);

  // Fewer points on a phone: the screen is smaller and so is the GPU.
  const aspect = w / h;
  const rows = Math.round((window.innerWidth >= 900 ? 280 : 190) * Math.min(h / 480, 1.1));
  const cols = Math.round(rows * aspect);
  const position = new Float32Array(cols * rows * 3);
  const uv = new Float32Array(cols * rows * 2);
  const rand = new Float32Array(cols * rows * 4);
  for (let y = 0, i = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++, i++) {
      const u = (x + 0.5) / cols;
      const v = (y + 0.5) / rows;
      position.set([(u - 0.5) * aspect, v - 0.5, 0], i * 3);
      uv.set([u, v], i * 2);
      rand.set([Math.random(), Math.random(), Math.random(), Math.random()], i * 4);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(position, 3));
  geometry.setAttribute('aUv', new Float32BufferAttribute(uv, 2));
  geometry.setAttribute('aRand', new Float32BufferAttribute(rand, 4));

  // A plane one unit tall exactly fills the view at this distance, so the
  // settled points line up with the photo underneath.
  const dist = 0.5 / Math.tan((FOV * Math.PI) / 360);
  const camera = new PerspectiveCamera(FOV, aspect, 0.01, 10);
  camera.position.z = dist;

  const uniforms = {
    uProgress: { value: 0 },
    uCell: { value: (h * pixelRatio) / rows },
    uDist: { value: dist },
    uMap: { value: texture },
  };
  const material = new ShaderMaterial({ uniforms, vertexShader, fragmentShader, transparent: true, depthWrite: false, depthTest: false });
  const points = new Points(geometry, material);
  points.frustumCulled = false;
  const scene = new Scene();
  scene.add(points);

  return {
    render(progress) {
      uniforms.uProgress.value = progress;
      renderer.render(scene, camera);
    },
    stop() {
      geometry.dispose();
      material.dispose();
      texture.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
