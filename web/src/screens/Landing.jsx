import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Logo, PaletteSwitcher } from '../components.jsx';
import { landingStory, reducedMotion } from '../lib/motion.js';

// The first screen: a short scroll story (hero, how it works, our promise)
// before setup. Everything decorative is aria-hidden; the text reads in order.

// Reticle positions on the portrait (cheek, brow, hair); on phones the tags sit under their reticles.
const PINS = [
  { x: '40%', y: '56%', side: 'left', name: 'Calm skin', note: 'steady' },
  { x: '60%', y: '41%', side: 'right', name: 'Brow shape', note: 'saved' },
  { x: '47%', y: '27%', side: 'left minor', name: 'Hair colour', note: 'on record' },
];

// The portrait: one AI-generated woman (KIE, Nano Banana 2) photographed 15 ways,
// head turned in a 5 x 3 grid (left to right, up to down); gaze-2-1 looks straight ahead.
const GAZE_COLS = 5;
const GAZE_ROWS = 3;
const GAZE_FRAMES = Array.from({ length: GAZE_COLS * GAZE_ROWS }, (_, i) => `${i % GAZE_COLS}-${Math.floor(i / GAZE_COLS)}`);
const GAZE_HOME = '2-1';

const STEPS = [
  { n: '01', title: 'Print', body: 'One selfie keeps your hair colour, brow shape and face shape on record.' },
  { n: '02', title: 'Try on', body: 'Wigs, hats and brows on your own face, from any shop.' },
  { n: '03', title: 'Check in', body: 'A weekly selfie shows which skin changes are real.' },
];

const ARCH_LABELS = [
  { text: 'Hair colour saved', x: '14%', y: '20%' },
  { text: 'Wig preview ready', x: '46%', y: '42%' },
  { text: 'Calm skin steady', x: '12%', y: '64%' },
  { text: 'Summary ready', x: '40%', y: '82%' },
];

// The promise, as words; '*' marks an accent word, '•' an image pill.
const PROMISE = 'Ahead helps you • see what treatment changes before it happens, keep your own look • on record, and know when to call your care team. Made for your *calmest,* most *prepared* days.';
const TAGS = ['Prepared', 'Calm', 'Informed', 'Confident', 'Seen'];

/** A line of words, each in its own mask so they can rise in turn. */
function Words({ text }) {
  return text.split(' ').flatMap((w, i) => [
    <span key={i} className="hero-word">
      <span>{w}</span>
    </span>,
    ' ',
  ]);
}

function Arrow() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path d="M5 12h14m-5-5 5 5-5 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Lock() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path d="M7 11V8a5 5 0 0 1 10 0v3M6 11h12v9H6z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * Fallback when WebGL is unavailable: the frames are stacked and the one nearest the
 * pointer's direction is shown. Returns a stop function.
 */
function flatGaze(el, setAt, onPose) {
  const target = { x: 0, y: 0 };
  const cur = { x: 0, y: 0 };
  let lastMove = -Infinity;
  let raf = 0;
  let visible = true;
  const clamp = (v) => Math.max(-1, Math.min(1, v));
  const onMove = (e) => {
    const r = el.getBoundingClientRect();
    target.x = clamp((e.clientX - (r.left + r.width / 2)) / (window.innerWidth * 0.3));
    target.y = clamp((e.clientY - (r.top + r.height * 0.36)) / (window.innerHeight * 0.3));
    lastMove = performance.now();
  };
  const loop = (t) => {
    raf = requestAnimationFrame(loop);
    if (t - lastMove > 3000) {
      target.x = Math.sin(t / 2700) * 0.8;
      target.y = Math.sin(t / 4100) * 0.6;
    }
    cur.x += (target.x - cur.x) * 0.1;
    cur.y += (target.y - cur.y) * 0.1;
    const col = Math.round(((cur.x + 1) / 2) * (GAZE_COLS - 1));
    const row = Math.round(((cur.y + 1) / 2) * (GAZE_ROWS - 1));
    const key = `${col}-${row}`;
    setAt((prev) => (prev === key ? prev : key));
    onPose(cur.x, cur.y);
  };
  const play = () => {
    if (!raf && visible && !document.hidden) raf = requestAnimationFrame(loop);
  };
  const pause = () => {
    cancelAnimationFrame(raf);
    raf = 0;
  };
  const io = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    visible ? play() : pause();
  });
  io.observe(el);
  const onVisibility = () => (document.hidden ? pause() : play());
  window.addEventListener('pointermove', onMove, { passive: true });
  document.addEventListener('visibilitychange', onVisibility);
  play();
  return () => {
    pause();
    io.disconnect();
    window.removeEventListener('pointermove', onMove);
    document.removeEventListener('visibilitychange', onVisibility);
  };
}

/**
 * The portrait that follows the pointer in 3D (lib/head3d.js): her head turns toward
 * it in perspective while the photo swaps to the frame looking that way. With no
 * pointer for a few seconds (or on a phone) she glances around slowly on her own.
 * The stacked photos show until the 3D head is ready, and stay if WebGL is missing.
 * The pins drift with her head through --gx / --gy. Still with reduced motion.
 */
function Gaze() {
  const ref = useRef(null);
  const canvas = useRef(null);
  const [at, setAt] = useState(GAZE_HOME);
  const [is3d, setIs3d] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const still = reducedMotion();
    const visual = el.closest('.hero-visual');
    const onPose = (x, y) => {
      visual?.style.setProperty('--gx', x.toFixed(3));
      visual?.style.setProperty('--gy', y.toFixed(3));
    };
    const frames = Object.fromEntries(GAZE_FRAMES.map((k) => [k, `/gaze/gaze-${k}.webp`]));
    let head = null;
    let stopFlat = null;
    let cancelled = false;
    const fallBack = () => {
      if (!cancelled && !still) stopFlat = flatGaze(el, setAt, onPose);
    };
    import('../lib/head3d.js')
      .then(({ startHead }) => startHead(canvas.current, { frames, depthUrl: '/gaze/depth.webp', cols: GAZE_COLS, rows: GAZE_ROWS, home: GAZE_HOME, still, onPose }))
      .then((h) => {
        if (cancelled) return h?.stop();
        if (!h) return fallBack();
        head = h;
        setIs3d(true);
      })
      .catch(fallBack);
    return () => {
      cancelled = true;
      head?.stop();
      stopFlat?.();
    };
  }, []);
  return (
    <div className={`gaze${is3d ? ' is-3d' : ''}`} ref={ref}>
      {GAZE_FRAMES.map((key) => (
        <img key={key} src={`/gaze/gaze-${key}.webp`} alt="" decoding="async" fetchpriority={key === GAZE_HOME ? 'high' : 'low'} className={key === at ? 'on' : undefined} />
      ))}
      <canvas ref={canvas} />
    </div>
  );
}

/** The three.js orb, loaded after first paint. A CSS orb shows until then, or for good without WebGL. */
function Orb({ orbRef }) {
  const canvas = useRef(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let orb = null;
    let cancelled = false;
    import('../lib/orb.js')
      .then(({ startOrb }) => {
        if (cancelled || !canvas.current) return;
        orb = startOrb(canvas.current, { still: reducedMotion() });
        orbRef.current = orb;
        if (orb) setReady(true);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      orb?.stop();
      orbRef.current = null;
    };
  }, [orbRef]);
  return (
    <div className={`orb-wrap${ready ? ' ready' : ''}`}>
      <div className="orb-fallback" />
      <canvas ref={canvas} />
    </div>
  );
}

/**
 * `returning`: reopened from Settings after setup. The main button goes back to
 * the journal, and the sample buttons are left out (loading the sample replaces the journal).
 */
export default function Landing({ onStart, onSample, demo, iosNote, returning = false }) {
  const root = useRef(null);
  const orbRef = useRef(null);
  useLayoutEffect(() => landingStory(root.current, () => orbRef.current), []);
  const startLabel = returning ? 'Open my journal' : 'Set up Ahead';
  const sampleButton = !returning && (
    <button className="btn secondary" onClick={onSample}>
      Explore a sample journey first
    </button>
  );

  return (
    <div className="landing" ref={root}>
      <header className="land-top">
        <div className="wordmark">
          <Logo />
          Ahead
        </div>
        <button type="button" className="linkish" onClick={returning ? onStart : onSample}>
          {returning ? 'Open my journal' : 'See a sample'}
        </button>
      </header>

      <section className="hero" aria-labelledby="hero-title">
        <div className="hero-head">
          <p className="eyebrow pill" data-rise>Made for cancer treatment</p>
          <h1 id="hero-title" className="hero-title">
            <span className="sr-only">Your skin, hair and brows, one step ahead.</span>
            <span aria-hidden="true">
              <span className="hero-line">
                <Words text="Your skin, hair" />
              </span>
              <span className="hero-line">
                <Words text="and brows," />
              </span>
              <span className="hero-line accent">
                <Words text="one step" />
              </span>
            </span>
          </h1>
        </div>

        <div className="hero-visual" aria-hidden="true">
          <Gaze />
          {PINS.map((p) => (
            <span key={p.name} className={`pin ${p.side}`} style={{ '--x': p.x, '--y': p.y, '--xw': p.xw || p.x, '--yw': p.yw || p.y }}>
              <span className="ret" />
              <span className="tag">
                {p.name} <span className="tag-note">{p.note}</span>
              </span>
            </span>
          ))}
          <div className="scan-card">
            <div className="scan-head">
              <span>Sample check-in</span>
              <span className="scan-done">Week 3</span>
            </div>
            <div className="scan-bar">
              <span />
            </div>
            <dl>
              <div>
                <dt>skin signals read</dt>
                <dd data-count="8">8</dd>
              </div>
              <div>
                <dt>real changes</dt>
                <dd data-count="1">1</dd>
              </div>
              <div>
                <dt>brow print</dt>
                <dd>Saved</dd>
              </div>
            </dl>
          </div>
        </div>

        <p className="hero-big" aria-hidden="true">
          <Words text="ahead." />
        </p>

        <p className="hero-body muted" data-rise>
          Try wigs, brows and hats on yourself before your hair changes. Each week, a selfie shows which skin changes are real, when to call your care team, and which products are safe right now.
        </p>

        <div className="hero-cta" data-rise>
          <div className="cta-row">
            <button className="btn primary cta" onClick={onStart}>
              {startLabel}
              <span className="cta-arrow">
                <Arrow />
              </span>
            </button>
            {sampleButton}
          </div>
          <p className="trust">
            <Lock /> Your photos and history stay on this device.
          </p>
          <PaletteSwitcher />
          {iosNote}
          {demo && <p className="fine">This server has no YouCam key, so analysis shows demo results.</p>}
        </div>
      </section>

      <section className="method" aria-labelledby="method-title">
        <div className="method-text">
          <p className="eyebrow">How Ahead works</p>
          <h2 id="method-title" className="display">
            Care that <em>keeps pace</em>
          </h2>
          <p className="muted">Ahead records how you look before treatment, reads the changes week by week, and tells you which ones matter.</p>
          <div className="steps-wrap">
            <span className="rail" aria-hidden="true">
              <span className="rail-fill" />
            </span>
            <ol className="rail-steps">
              {STEPS.map((s) => (
                <li key={s.n} className="rail-step">
                  <span className="rail-dot" aria-hidden="true" />
                  <h3>
                    <span className="rail-n">{s.n}</span> {s.title}
                  </h3>
                  <p>{s.body}</p>
                </li>
              ))}
              <li className="rail-step final">
                <span className="rail-dot" aria-hidden="true" />
                <h3 className="display">
                  Ready for your <em>care team</em>
                </h3>
                <p>Scores, notes and questions on one page for your next appointment.</p>
              </li>
            </ol>
          </div>
        </div>
        <div className="method-visual" aria-hidden="true">
          <div className="arch">
            <div className="arch-fill" />
            <Orb orbRef={orbRef} />
            {ARCH_LABELS.map((l) => (
              <span key={l.text} className="arch-label" style={{ '--x': l.x, '--y': l.y }}>
                {l.text}
              </span>
            ))}
          </div>
        </div>
      </section>

      <section className="promise" aria-labelledby="promise-title">
        <p className="eyebrow" id="promise-title">
          Our promise
        </p>
        <p className="statement">
          {PROMISE.split(' ').flatMap((w, i) => {
            if (w === '•') return [<span key={i} className="ipill" aria-hidden="true" />, ' '];
            const accent = w.startsWith('*');
            const word = w.replace(/\*/g, '');
            return [accent ? <em key={i} className="sw">{word}</em> : <span key={i} className="sw">{word}</span>, ' '];
          })}
        </p>
        <div className="ftags" aria-hidden="true">
          {TAGS.map((t, i) => (
            <span key={t} className="ftag" style={{ '--d': `${i * -2.3}s` }}>
              {t}
            </span>
          ))}
        </div>
      </section>

      <section className="final" aria-labelledby="final-title">
        <h2 id="final-title" className="display">
          Ready when <em>you are.</em>
        </h2>
        <div className="cta-row">
          <button className="btn primary cta" onClick={onStart}>
            {startLabel}
            <span className="cta-arrow">
              <Arrow />
            </span>
          </button>
          {sampleButton}
        </div>
        <div className="sheet tint stack">
          <h3>Private by design</h3>
          <p>Your photos and history stay on this device, not on our server. Photos go to the YouCam analysis service only when you ask for a check-in or try-on.</p>
        </div>
      </section>

      <footer className="land-foot">
        <span>Ahead · built on the YouCam API</span>
        <span>A journal and a guide, not a diagnosis. Your care team has the final word.</span>
      </footer>
    </div>
  );
}
