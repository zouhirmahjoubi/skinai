import { useEffect, useMemo, useRef, useState } from 'react';
import { TREATMENTS, treatmentPhase } from '../../core/treatments.js';
import { STATUS_TEXT } from '../../core/trends.js';
import { displayScore } from '../../core/concerns.js';
import { cropToJpeg, faceBrightness, lightLabel, loadImage } from './lib/image.js';

// Icons ---------------------------------------------------------------------
const paths = {
  today: 'M4 11.5 12 5l8 6.5V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z',
  skin: 'M12 3c-4 0-7 3.2-7 7.6 0 3.3 1.6 6.4 4 8.2.9.7 1.9 1.2 3 1.2s2.1-.5 3-1.2c2.4-1.8 4-4.9 4-8.2C19 6.2 16 3 12 3Zm-3 8.2h.01M15 11.2h.01M9.5 15c1.4 1 3.6 1 5 0',
  shelf: 'M9 3h6v3l1.5 2.2c.3.5.5 1 .5 1.6V20a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V9.8c0-.6.2-1.1.5-1.6L9 6zM7 13h10',
  look: 'M5 20c0-5 1-8.5 3-10.5S11 7 12 7s2 .5 4 2.5S19 15 19 20M8.5 9.5C9 6 10.3 4 12 4s3 2 3.5 5.5M9.5 14.5c1.2-.6 2.2-.6 3 0M14 14.5c.8-.6 1.8-.6 3 0',
  settings: 'M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4ZM19.4 13.5l1.6 1.2-1.8 3.1-1.9-.6a7.6 7.6 0 0 1-2 1.2l-.4 2h-3.6l-.4-2a7.6 7.6 0 0 1-2-1.2l-1.9.6-1.8-3.1 1.6-1.2a7.7 7.7 0 0 1 0-2.4L3.2 9.9 5 6.8l1.9.6a7.6 7.6 0 0 1 2-1.2l.4-2h3.6l.4 2a7.6 7.6 0 0 1 2 1.2l1.9-.6 1.8 3.1-1.6 1.2a7.7 7.7 0 0 1 0 2.4Z',
  camera: 'M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Zm8 9a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z',
  upload: 'M12 16V4m0 0-4.5 4.5M12 4l4.5 4.5M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4',
  back: 'M15 5l-7 7 7 7',
  print: 'M7 9V4h10v5M7 17H5a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-2M7 14h10v6H7z',
  phone: 'M6.5 3.5 9 3l2 5-2.5 1.5a11 11 0 0 0 6 6L16 13l5 2-.5 2.5a2 2 0 0 1-2 1.6C10.6 19 5 13.4 4.9 5.5a2 2 0 0 1 1.6-2Z',
};

export function Icon({ name, title }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden={title ? undefined : true} role={title ? 'img' : undefined}>
      {title && <title>{title}</title>}
      <path d={paths[name]} />
    </svg>
  );
}

export function Logo() {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="16" fill="var(--accent)" />
      <path d="M12 42 C 22 42, 26 22, 36 22 S 48 30, 52 30" fill="none" stroke="var(--tint)" strokeWidth="5" strokeLinecap="round" />
      <circle cx="36" cy="22" r="6" fill="#fff" />
    </svg>
  );
}

// Frame -----------------------------------------------------------------------
export function TopBar({ title, back, right, mode }) {
  return (
    <header className="topbar">
      {back ? (
        <a className="icon-btn" href={back} aria-label="Back">
          <Icon name="back" />
        </a>
      ) : (
        <a className="wordmark" href="#/today">
          <Logo />
          Ahead
        </a>
      )}
      {title && <span className="sr-only">{title}</span>}
      <div className="row">
        {mode === 'demo' && <span className="mode-chip" title="No YouCam API key configured on the server">Demo results</span>}
        {right}
      </div>
    </header>
  );
}

const TABS = [
  ['/today', 'today', 'Today'],
  ['/skin', 'skin', 'Skin'],
  ['/shelf', 'shelf', 'Shelf'],
  ['/look', 'look', 'Hair & brows'],
];

export function TabBar({ path }) {
  return (
    <div className="tabbar">
      <nav aria-label="Main">
        {TABS.map(([to, icon, label]) => (
          <a key={to} href={`#${to}`} aria-current={path === to || (to === '/skin' && path === '/checkin') ? 'page' : undefined}>
            <Icon name={icon} />
            {label}
          </a>
        ))}
      </nav>
    </div>
  );
}

// Road ahead -----------------------------------------------------------------------
/** The treatment timeline: weeks, your check-ins on it, and when side effects commonly show up. */
export function RoadAhead({ profile, checkins }) {
  const ref = useRef(null);
  const phase = treatmentPhase(profile?.startDate);
  const current = phase.phase === 'during' ? phase.week : 0;
  const last = Math.min(16, Math.max(8, current + 3));
  const weeks = Array.from({ length: last + 1 }, (_, i) => i);
  const checkedWeeks = new Set(
    checkins.map((c) => {
      const p = treatmentPhase(profile?.startDate, new Date(`${c.date}T12:00:00`));
      return p.phase === 'during' ? p.week : 0;
    }),
  );
  // One bar per side effect; two treatments that both dry the skin share a bar.
  const byLabel = new Map();
  for (const key of profile?.treatments || []) {
    for (const e of TREATMENTS[key]?.expect || []) {
      if (!e.band) continue;
      const label = e.short || e.title;
      const from = Math.min(e.band[0], last);
      const open = e.band[1] === null || e.band[1] > last;
      const to = open ? last : e.band[1];
      const prev = byLabel.get(label);
      byLabel.set(label, prev ? { ...prev, from: Math.min(prev.from, from), to: Math.max(prev.to, to), open: prev.open || open } : { id: e.id, label, from, to, open });
    }
  }
  const bands = [...byLabel.values()].map((b) => ({ ...b, now: current >= b.from && current <= b.to })).sort((a, b) => a.from - b.from);

  useEffect(() => {
    const el = ref.current?.querySelector('.here');
    if (el && ref.current) ref.current.scrollLeft = Math.max(0, el.offsetLeft - ref.current.clientWidth / 2 + 29);
  }, [current]);

  return (
    <div className="road" ref={ref} role="group" aria-label="Your treatment timeline">
      <div className="road-inner" role="list">
        {weeks.map((w) => (
          <div key={w} role="listitem" className={`road-week${w < current ? ' past' : ''}${w === current ? ' here' : ''}${checkedWeeks.has(w) ? ' checked' : ''}`} aria-label={`${w === 0 ? 'Before treatment' : `Week ${w}`}${w === current ? ', you are here' : ''}${checkedWeeks.has(w) ? ', checked in' : ''}`}>
            <span className="node" />
            <span>{w === 0 ? 'Before' : `Wk ${w}`}</span>
          </div>
        ))}
      </div>
      {bands.length > 0 && (
        <div className="road-bands" role="list" aria-label="When side effects commonly appear">
          {bands.map((b) => (
            <div key={b.id} role="listitem" className={`band${b.now ? ' now' : ''}`} style={{ gridColumn: `${b.from + 1} / ${b.to + 2}` }} title={b.label}>
              {b.label}
              <span className="sr-only">{`: ${b.from === 0 ? 'from before treatment' : `from week ${b.from}`}${b.open ? ' onward' : ` to week ${b.to}`}${b.now ? ', likely now' : ''}`}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Notes -------------------------------------------------------------------------
const KICKER = { call: 'Tell your care team', watch: 'Keep an eye on this', info: 'Good to know', good: 'Looking steady' };

export function NoteCard({ note }) {
  return (
    <article className={`note ${note.level}`}>
      <div className="note-kicker">{KICKER[note.level]}</div>
      <h3>{note.title}</h3>
      {note.subtitle && <div className="sub">{note.subtitle}</div>}
      <p>{note.body}</p>
      {note.also?.length > 0 && <p className="small muted">Also common: {note.also.join('; ')}.</p>}
      {note.confirm && (
        <p className="small">
          <strong>Check first: </strong>
          {note.confirm}
        </p>
      )}
      {note.careTeam && (
        <div className="care">
          <strong>What to do: </strong>
          {note.careTeam}
        </div>
      )}
    </article>
  );
}

// Scores ------------------------------------------------------------------------
export function Sparkline({ values }) {
  const pts = values.filter((v) => v !== null && v !== undefined);
  if (pts.length < 2) return <svg className="spark" aria-hidden="true" />;
  const min = Math.min(...pts) - 2;
  const max = Math.max(...pts) + 2;
  const x = (i) => 4 + (i * 76) / (pts.length - 1);
  const y = (v) => 22 - ((v - min) / (max - min || 1)) * 18;
  const d = pts.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  return (
    <svg className="spark" viewBox="0 0 84 26" aria-hidden="true">
      <path d={d} />
      <circle cx={x(pts.length - 1)} cy={y(pts[pts.length - 1])} r="3" />
    </svg>
  );
}

export function ScoreRow({ row, pressed, onPress }) {
  const value = displayScore(row.score);
  const status = row.vsBase.status;
  return (
    <button type="button" className="score" aria-pressed={pressed} onClick={onPress}>
      <span className="name">{row.label}</span>
      <span className="value" aria-label={`score ${value ?? 'not measured'}`}>{value ?? '–'}</span>
      <span className="trend">
        <span className={`trend-tag ${status}`}>{STATUS_TEXT[status]}</span>
        {row.vsBase.delta !== null && <span>{row.vsBase.delta > 0 ? '+' : ''}{row.vsBase.delta} since baseline</span>}
        <Sparkline values={row.history} />
      </span>
    </button>
  );
}

// Progress ----------------------------------------------------------------------
export function Steps({ steps, at }) {
  return (
    <ol className="steps">
      {steps.map((label, i) => (
        <li key={label} className={i < at ? 'done' : i === at ? 'active' : ''}>
          <span className="dot" aria-hidden="true" />
          {label}
        </li>
      ))}
    </ol>
  );
}

export function ErrorBox({ error, onRetry }) {
  if (!error) return null;
  return (
    <div className="error-box" role="alert">
      <strong>
        {error.fix === 'photo' ? 'Let’s retake that photo' : error.fix === 'ref' ? 'Try a different product photo' : error.fix === 'setup' ? 'The app needs setting up' : 'That didn’t work'}
      </strong>
      <p>{error.message}</p>
      {error.code === 'AccessCode' ? (
        <a className="btn secondary small" style={{ marginTop: 10 }} href="#/settings">
          Enter access code
        </a>
      ) : (
        onRetry && (
          <button className="btn secondary small" style={{ marginTop: 10 }} onClick={onRetry}>
            {error.fix === 'photo' ? 'Retake photo' : 'Try again'}
          </button>
        )
      )}
    </div>
  );
}

// Before / after -------------------------------------------------------------------
export function CompareSlider({ before, after, beforeLabel = 'You today', afterLabel = 'Try-on' }) {
  const ref = useRef(null);
  const drag = useRef(null);
  const [split, setSplit] = useState(50);
  const move = (clientX) => {
    const r = ref.current.getBoundingClientRect();
    setSplit(Math.max(0, Math.min(100, ((clientX - r.left) / r.width) * 100)));
  };
  // Touch: only a clearly horizontal drag moves the split, so vertical swipes
  // still scroll the page (touch-action: pan-y in CSS).
  return (
    <div
      ref={ref}
      className="compare"
      style={{ '--split': `${split}%` }}
      onPointerDown={(e) => {
        drag.current = { x: e.clientX, y: e.clientY, active: e.pointerType === 'mouse' };
        if (drag.current.active) {
          e.currentTarget.setPointerCapture(e.pointerId);
          move(e.clientX);
        }
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d || !e.buttons) return;
        if (!d.active) {
          const dx = Math.abs(e.clientX - d.x);
          if (dx < 8 || dx <= Math.abs(e.clientY - d.y)) return;
          d.active = true;
          e.currentTarget.setPointerCapture(e.pointerId);
        }
        move(e.clientX);
      }}
      onPointerUp={() => (drag.current = null)}
      onPointerCancel={() => (drag.current = null)}
    >
      <img src={before} alt={beforeLabel} />
      <img src={after} alt={afterLabel} className="after" />
      <span className="handle" aria-hidden="true" />
      <span className="tag" style={{ left: 12 }}>{beforeLabel}</span>
      <span className="tag" style={{ right: 12 }}>{afterLabel}</span>
      <input
        className="sr-only"
        type="range"
        min="0"
        max="100"
        value={Math.round(split)}
        onChange={(e) => setSplit(Number(e.target.value))}
        aria-label="Drag to compare before and after"
      />
    </div>
  );
}

// Capture ------------------------------------------------------------------------
// Face mode crops tightly around the oval so the face fills ~78% of the
// photo width (YouCam needs the face wider than 60% of the image). Portrait
// mode keeps head and shoulders, which the hairstyle engine needs.

// Fractions of the 3:4 box: rx of its width, ry of its height (a ~1:1.35 face oval).
const OVAL = { cx: 0.5, cy: 0.45, rx: 0.31, ry: 0.315 };
// A 3:4 crop whose width is the oval width / 0.78. In a 3:4 box the same
// fraction of width and of height gives a 3:4 crop, so w === h here.
const FACE_CROP = (() => {
  const w = (OVAL.rx * 2) / 0.78;
  return { x: 0.5 - w / 2, y: OVAL.cy - w / 2, w, h: w };
})();
const SD_MIN_SHORT = 480; // YouCam SD skin analysis: short side >= 480 px

/**
 * FACE_CROP, widened (centred on the oval, up to the whole box) just enough
 * that the crop's short side reaches 480 px. A 720p webcam then gives a
 * 480x640 crop with the face at ~70% of its width instead of a useless 429 px.
 */
export function faceCropFor(srcW, srcH, boxW, boxH, view = { zoom: 1 }) {
  const s = Math.max(boxW / srcW, boxH / srcH) * (view.zoom ?? 1);
  const w = Math.min(1, Math.max(FACE_CROP.w, (SD_MIN_SHORT * s) / boxW));
  if (w === FACE_CROP.w) return FACE_CROP;
  return { x: 0.5 - w / 2, y: Math.min(1 - w, Math.max(0, OVAL.cy - w / 2)), w, h: w };
}

function cropRectFor(mode) {
  return mode === 'face' ? FACE_CROP : { x: 0, y: 0, w: 1, h: 1 };
}

/** Maps a fractional box rect onto source pixels for an object-fit: cover image/video with pan & zoom. */
export function sourceRect(srcW, srcH, boxW, boxH, frac, view = { zoom: 1, tx: 0, ty: 0 }) {
  const s = Math.max(boxW / srcW, boxH / srcH) * view.zoom;
  const ox = (boxW - srcW * s) / 2 + view.tx;
  const oy = (boxH - srcH * s) / 2 + view.ty;
  const x = Math.max(0, (frac.x * boxW - ox) / s);
  const y = Math.max(0, (frac.y * boxH - oy) / s);
  return { x, y, w: Math.min(srcW - x, (frac.w * boxW) / s), h: Math.min(srcH - y, (frac.h * boxH) / s) };
}

// The upload <img> is box-sized (object-fit: cover) and then translated and
// scaled about its centre. It still covers the frame while |tx| and |ty| stay
// within (zoom - 1) / 2 of the box, so the saved crop is exactly what was shown.
function clampView(v, b) {
  if (!b) return v;
  const mx = ((v.zoom - 1) * b.clientWidth) / 2;
  const my = ((v.zoom - 1) * b.clientHeight) / 2;
  return { ...v, tx: Math.max(-mx, Math.min(mx, v.tx)), ty: Math.max(-my, Math.min(my, v.ty)) };
}

function Guide({ mode }) {
  if (mode === 'portrait') {
    return (
      <svg className="guide" viewBox="0 0 300 400" preserveAspectRatio="none" aria-hidden="true">
        <ellipse cx="150" cy="150" rx="62" ry="82" fill="none" stroke="#fff" strokeWidth="3" strokeDasharray="8 8" />
        <path d="M40 400 C 50 300, 100 270, 150 268 S 250 300, 260 400" fill="none" stroke="#fff" strokeWidth="3" strokeDasharray="8 8" />
      </svg>
    );
  }
  if (mode === 'product') return null;
  return (
    <svg className="guide" viewBox="0 0 300 400" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <mask id="oval-hole">
          <rect width="300" height="400" fill="#fff" />
          <ellipse cx={OVAL.cx * 300} cy={OVAL.cy * 400} rx={OVAL.rx * 300} ry={OVAL.ry * 400} fill="#000" />
        </mask>
      </defs>
      <rect width="300" height="400" fill="rgba(20,14,30,0.45)" mask="url(#oval-hole)" />
      <ellipse cx={OVAL.cx * 300} cy={OVAL.cy * 400} rx={OVAL.rx * 300} ry={OVAL.ry * 400} fill="none" stroke="#fff" strokeWidth="3" />
    </svg>
  );
}

/**
 * Camera or upload, with an alignment guide, live light check and optional
 * ghost of the baseline photo. Calls onCapture({ blob, width, height, dataUrl, brightness, source }).
 */
export function Capture({ mode = 'face', ghost, maxLong = 2560, onCapture, cta = 'Take photo' }) {
  const box = useRef(null);
  const video = useRef(null);
  const fileInput = useRef(null);
  const streamRef = useRef(null);
  const starting = useRef(false);
  const alive = useRef(true);
  const [state, setState] = useState('choose');
  const [camPending, setCamPending] = useState(false);
  const [camError, setCamError] = useState('');
  const [light, setLight] = useState(null);
  const [upload, setUpload] = useState(null);
  const [view, setView] = useState({ zoom: 1, tx: 0, ty: 0 });
  const [faceFrac, setFaceFrac] = useState(FACE_CROP);
  const [showGhost, setShowGhost] = useState(Boolean(ghost));
  const [busy, setBusy] = useState(false);
  const drag = useRef(null);
  const frac = mode === 'face' ? faceFrac : cropRectFor(mode);

  function stopCamera() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (video.current) video.current.srcObject = null;
  }

  // The stream lives in a ref, so it is stopped on unmount even after React
  // has cleared the <video> ref.
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      stopCamera();
    };
  }, []);

  async function startCamera() {
    if (starting.current || streamRef.current) return;
    starting.current = true;
    setCamPending(true);
    setCamError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1920 }, height: { ideal: 1440 } }, audio: false });
      if (!alive.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;
      setState('camera');
    } catch (err) {
      if (alive.current) setCamError(err?.name === 'NotAllowedError' ? 'Camera access was blocked. You can allow it in your browser settings, or upload a photo instead.' : 'No camera is available here. Upload a photo instead.');
    } finally {
      starting.current = false;
      if (alive.current) setCamPending(false);
    }
  }

  // Attach the stream once React has rendered the <video>.
  useEffect(() => {
    if (state === 'camera' && video.current && streamRef.current) {
      video.current.srcObject = streamRef.current;
      video.current.play().catch(() => {});
    }
  }, [state]);

  // Live light reading while the camera is open.
  useEffect(() => {
    if (state !== 'camera') return undefined;
    const t = setInterval(() => {
      const v = video.current;
      const b = box.current;
      if (!v?.videoWidth || !b) return;
      const r = sourceRect(v.videoWidth, v.videoHeight, b.clientWidth, b.clientHeight, FACE_CROP);
      setLight(faceBrightness(v, r));
    }, 600);
    return () => clearInterval(t);
  }, [state]);

  async function snap() {
    const v = video.current;
    const b = box.current;
    if (!v?.videoWidth) return;
    setBusy(true);
    const useFrac = mode === 'face' ? faceCropFor(v.videoWidth, v.videoHeight, b.clientWidth, b.clientHeight) : frac;
    const rect = sourceRect(v.videoWidth, v.videoHeight, b.clientWidth, b.clientHeight, useFrac);
    const faceR = sourceRect(v.videoWidth, v.videoHeight, b.clientWidth, b.clientHeight, FACE_CROP);
    const out = await cropToJpeg(v, rect, { maxLong });
    const brightness = faceBrightness(v, faceR);
    stopCamera();
    setBusy(false);
    onCapture({ ...out, brightness, source: 'camera' });
  }

  async function onFile(e) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try {
      const img = await loadImage(f);
      setUpload(img);
      setView({ zoom: 1, tx: 0, ty: 0 });
      stopCamera();
      setState('frame');
    } catch (err) {
      setCamError(err.message);
    }
  }

  async function useFramed() {
    const b = box.current;
    setBusy(true);
    const w = upload.naturalWidth;
    const h = upload.naturalHeight;
    const useFrac = mode === 'face' ? faceCropFor(w, h, b.clientWidth, b.clientHeight, view) : frac;
    const rect = sourceRect(w, h, b.clientWidth, b.clientHeight, useFrac, view);
    const faceR = sourceRect(w, h, b.clientWidth, b.clientHeight, FACE_CROP, view);
    const out = await cropToJpeg(upload, rect, { maxLong });
    setBusy(false);
    onCapture({ ...out, brightness: faceBrightness(upload, faceR), source: 'upload' });
  }

  const ghostStyle = useMemo(() => ({ left: `${frac.x * 100}%`, top: `${frac.y * 100}%`, width: `${frac.w * 100}%`, height: `${frac.h * 100}%` }), [frac]);
  const lightInfo = lightLabel(light);

  return (
    <div className="stack">
      <div
        ref={box}
        className={`capture${state === 'frame' ? ' framing' : ''}`}
        onPointerDown={(e) => {
          if (state !== 'frame') return;
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (state !== 'frame' || !d) return;
          const tx = d.tx + e.clientX - d.x;
          const ty = d.ty + e.clientY - d.y;
          setView((v) => clampView({ ...v, tx, ty }, box.current));
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
      >
        {state === 'camera' && (
          <video
            ref={video}
            className="mirror"
            playsInline
            muted
            onLoadedMetadata={(e) => box.current && mode === 'face' && setFaceFrac(faceCropFor(e.currentTarget.videoWidth, e.currentTarget.videoHeight, box.current.clientWidth, box.current.clientHeight))}
          />
        )}
        {state === 'frame' && upload && (
          <img className="frame-img" src={upload.src} alt="Your photo" draggable="false" style={{ transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.zoom})`, objectFit: 'cover' }} />
        )}
        {state === 'choose' && (
          <div className="frame-img" style={{ display: 'grid', placeItems: 'center', color: '#d9d2f0', padding: 24, textAlign: 'center' }}>
            <p>{mode === 'face' ? 'Your face will go in the oval.' : mode === 'portrait' ? 'Head and shoulders, hair down.' : 'One item, filling most of the picture.'}</p>
          </div>
        )}
        {ghost && showGhost && state !== 'choose' && <img className={`ghost${state === 'camera' ? ' mirror' : ''}`} src={ghost} alt="" style={ghostStyle} />}
        <Guide mode={mode} />
        {state === 'camera' && mode !== 'product' && (
          <div className="light" aria-live="polite">
            <span className={`light-pill ${lightInfo.tone}`}>{lightInfo.text}</span>
          </div>
        )}
      </div>

      {state === 'frame' && (
        <label className="field">
          <span>
            {mode === 'face' ? 'Zoom so your face fills the oval, then drag to centre' : mode === 'portrait' ? 'Zoom so your head and shoulders fit the outline, then drag to centre' : 'Zoom and drag so the item fills the frame'}
          </span>
          <input
            type="range"
            min="1"
            max="3"
            step="0.01"
            value={view.zoom}
            onChange={(e) => {
              const zoom = Number(e.target.value);
              setView((v) => clampView({ ...v, zoom }, box.current));
            }}
          />
        </label>
      )}
      {ghost && state !== 'choose' && (
        <label className="toggle">
          <span>Show my baseline photo to line up</span>
          <input type="checkbox" checked={showGhost} onChange={(e) => setShowGhost(e.target.checked)} />
        </label>
      )}
      {camError && <div className="banner">{camError}</div>}

      <div className="row wrap">
        {state === 'camera' && (
          <button className="btn primary block" onClick={snap} disabled={busy}>
            <Icon name="camera" />
            {cta}
          </button>
        )}
        {state === 'frame' && (
          <button className="btn primary block" onClick={useFramed} disabled={busy}>
            Use this photo
          </button>
        )}
        {state !== 'camera' && (
          <button className={`btn ${state === 'choose' ? 'primary' : 'secondary'}`} style={{ flex: 1 }} onClick={startCamera} disabled={camPending}>
            <Icon name="camera" />
            Use camera
          </button>
        )}
        <button className="btn secondary" style={{ flex: 1 }} onClick={() => fileInput.current?.click()}>
          <Icon name="upload" />
          {state === 'frame' ? 'Choose another' : 'Upload photo'}
        </button>
        <input ref={fileInput} type="file" accept="image/*" hidden onChange={onFile} />
      </div>
    </div>
  );
}
