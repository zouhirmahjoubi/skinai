// The welcome page's painted scenes, drawn on one full-screen canvas. As you scroll,
// one painting breaks into dots and settles into the next. Plain WebGL: a small
// shader and two textures. It only draws when asked, so nothing runs while the page
// is still. With no WebGL, or with reduced motion, this never starts and each
// chapter shows its own painting instead.

const vertexSource = `
  attribute vec2 aPos;
  varying vec2 vUv;
  void main() { vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const fragmentSource = `
  #ifdef GL_FRAGMENT_PRECISION_HIGH
  precision highp float;
  #else
  precision mediump float;
  #endif
  uniform sampler2D uA;
  uniform sampler2D uB;
  uniform vec2 uRes;
  uniform vec2 uSizeA;
  uniform vec2 uSizeB;
  uniform float uZoomA;
  uniform float uZoomB;
  uniform float uP;
  uniform float uCell;
  varying vec2 vUv;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

  // Same crop as CSS object-fit: cover, from the centre.
  vec2 cover(vec2 uv, vec2 size, float zoom) {
    float screen = uRes.x / uRes.y;
    float image = size.x / size.y;
    vec2 k = screen > image ? vec2(1.0, image / screen) : vec2(screen / image, 1.0);
    vec2 c = (uv - 0.5) * k / zoom + 0.5;
    return vec2(c.x, 1.0 - c.y);
  }

  void main() {
    vec2 px = gl_FragCoord.xy;
    vec2 cell = floor(px / uCell);
    vec2 clump = floor(px / (uCell * 7.0));
    vec2 centre = (cell + 0.5) * uCell / uRes;

    // Clumps go first, then loose dots, so it breaks up like dust and not like a wipe.
    float order = hash(clump) * 0.5 + hash(cell) * 0.22 + (1.0 - vUv.y) * 0.28;
    float t = uP * 1.36 - 0.18;
    float band = 0.18;
    float d = order - t;

    vec4 a = texture2D(uA, cover(vUv, uSizeA, uZoomA));
    vec4 b = texture2D(uB, cover(vUv, uSizeB, uZoomB));
    vec4 col = d > 0.0 ? a : b;

    if (abs(d) < band) {
      // Inside the band each cell is one dot of colour, drifting a little from home.
      float heat = 1.0 - abs(d) / band;
      vec2 drift = (vec2(hash(cell + 1.7), hash(cell + 4.1)) - 0.5) * 0.09 * heat;
      vec2 at = centre + drift;
      vec4 dot_ = d > 0.0 ? texture2D(uA, cover(at, uSizeA, uZoomA)) : texture2D(uB, cover(at, uSizeB, uZoomB));
      float r = length(fract(px / uCell) - 0.5);
      col = mix(col, dot_, 1.0 - smoothstep(0.2 + heat * 0.34, 0.28 + heat * 0.36, r));
    }
    gl_FragColor = vec4(col.rgb, 1.0);
  }
`;

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  return shader;
}

/**
 * Prepares `canvas` for the paintings at `urls`. Resolves to { draw(i, p, zoomA, zoomB), stop() },
 * or null when WebGL is missing or slow, or the first painting can't load. `onLost` fires if
 * the browser takes the WebGL context away later, so the page can fall back to plain paintings.
 */
export async function startScenes(canvas, urls, startColor, onLost) {
  const gl = canvas.getContext('webgl', { alpha: false, antialias: false, powerPreference: 'low-power', failIfMajorPerformanceCaveat: true });
  if (!gl) return null;
  const lost = (e) => {
    e.preventDefault();
    onLost?.();
  };
  canvas.addEventListener('webglcontextlost', lost);

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
  const u = Object.fromEntries(['uA', 'uB', 'uRes', 'uSizeA', 'uSizeB', 'uZoomA', 'uZoomB', 'uP', 'uCell'].map((n) => [n, gl.getUniformLocation(program, n)]));
  gl.uniform1i(u.uA, 0);
  gl.uniform1i(u.uB, 1);

  const makeTexture = (source, width, height) => {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    if (source) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(startColor));
    return { texture, size: [width, height] };
  };

  // The colour the very first painting gathers out of.
  const blank = makeTexture(null, 1, 1);
  const loaded = new Map();
  const loading = new Map();
  let last = null;
  let stopped = false;

  const load = (i) => {
    if (i < 0 || i >= urls.length || loaded.has(i)) return Promise.resolve();
    if (!loading.has(i)) {
      const img = new Image();
      img.decoding = 'async';
      img.src = urls[i];
      loading.set(
        i,
        img.decode().then(() => {
          if (stopped) return;
          loaded.set(i, makeTexture(img, img.naturalWidth, img.naturalHeight));
          if (last) draw(...last);
        }),
      );
    }
    return loading.get(i);
  };

  const bind = (unit, item, sizeUniform) => {
    gl.activeTexture(unit);
    gl.bindTexture(gl.TEXTURE_2D, item.texture);
    gl.uniform2f(sizeUniform, item.size[0], item.size[1]);
  };

  /**
   * Scene `i` turning into scene `i + 1`, `p` of the way there. `i` of -1 is the
   * painting gathering out of the plain colour on arrival.
   */
  function draw(i, p, zoomA = 1, zoomB = 1) {
    last = [i, p, zoomA, zoomB];
    // Keep this painting and the next two ready, let the rest wait, and free any far behind.
    load(Math.max(i, 0));
    load(i + 1);
    load(i + 2);
    for (const [k, item] of loaded) {
      if (k < i - 1 || k > i + 3) {
        gl.deleteTexture(item.texture);
        loaded.delete(k);
        loading.delete(k);
      }
    }
    let a = i < 0 ? blank : loaded.get(i);
    let b = loaded.get(i + 1);
    // If the next one hasn't arrived, hold the one we have; if neither has, hold the colour.
    if (!a) a = b || blank;
    if (!b) b = a;
    bind(gl.TEXTURE0, a, u.uSizeA);
    bind(gl.TEXTURE1, b, u.uSizeB);
    gl.uniform1f(u.uZoomA, zoomA);
    gl.uniform1f(u.uZoomB, zoomB);
    gl.uniform1f(u.uP, p);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  const resize = () => {
    const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
    canvas.width = Math.max(1, Math.round(canvas.clientWidth * ratio));
    canvas.height = Math.max(1, Math.round(canvas.clientHeight * ratio));
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(u.uRes, canvas.width, canvas.height);
    gl.uniform1f(u.uCell, Math.max(5, Math.round(Math.min(canvas.width, canvas.height) / 110)));
    if (last) draw(...last);
  };
  window.addEventListener('resize', resize);
  resize();

  const stop = () => {
    stopped = true;
    window.removeEventListener('resize', resize);
    canvas.removeEventListener('webglcontextlost', lost);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  };

  try {
    await load(0);
  } catch {
    stop();
    return null;
  }

  return { draw, stop };
}
