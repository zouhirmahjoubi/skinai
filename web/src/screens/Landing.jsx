import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Logo } from '../components.jsx';
import { landingStory, reducedMotion } from '../lib/motion.js';

// The first screen: a short scroll story (hero, how it works, our promise)
// before setup. Everything decorative is aria-hidden; the text reads in order.

// Reticle positions on the orb; on phones the tags sit under their reticles instead of beside them.
const PINS = [
  { x: '24%', y: '30%', side: 'left', name: 'Calm skin', note: 'steady' },
  { x: '64%', y: '18%', xw: '62%', yw: '54%', side: 'right', name: 'Brow shape', note: 'saved' },
  { x: '34%', y: '62%', side: 'left minor', name: 'Hair colour', note: 'on record' },
];

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

export default function Landing({ onStart, onSample, demo, iosNote }) {
  const root = useRef(null);
  const orbRef = useRef(null);
  useLayoutEffect(() => landingStory(root.current, () => orbRef.current), []);

  return (
    <div className="landing" ref={root}>
      <header className="land-top">
        <div className="wordmark">
          <Logo />
          Ahead
        </div>
        <button type="button" className="linkish" onClick={onSample}>
          See a sample
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
          <Orb orbRef={orbRef} />
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
              Set up Ahead
              <span className="cta-arrow">
                <Arrow />
              </span>
            </button>
            <button className="btn secondary" onClick={onSample}>
              Explore a sample journey first
            </button>
          </div>
          <p className="trust">
            <Lock /> Your photos and history stay on this device.
          </p>
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
            <div className="arch-orb" />
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
            Set up Ahead
            <span className="cta-arrow">
              <Arrow />
            </span>
          </button>
          <button className="btn secondary" onClick={onSample}>
            Explore a sample journey first
          </button>
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
