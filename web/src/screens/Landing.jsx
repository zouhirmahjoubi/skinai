import { useLayoutEffect, useRef } from 'react';
import { Logo } from '../components.jsx';
import { gather, landingStory } from '../lib/motion.js';
import { reducedMotion } from '../lib/reduced.js';

// The first screen: the promise and the button at once, then the real app,
// chapter by chapter. Everything decorative is aria-hidden; the text reads in order.

const CHAPTERS = [
  { id: 'print', title: 'Keep your own look on record', body: 'One selfie saves your hair colour, brow shape and face shape before anything changes. Your wig specialist can work from it later.', alt: 'Hair and brow print with measured colours and face shape' },
  { id: 'looks', title: 'See it on your own face', body: 'Try wigs in your own colour, your brows drawn back on, and how your hair might grow back. Many shops won’t take a wig back once it’s been worn.', alt: 'A saved lookbook of wigs, brows and earrings on one person' },
  { id: 'check', title: 'Know which changes matter', body: 'A weekly selfie is read against your treatment and your week. On an EGFR inhibitor, a falling clear-skin score means tell your care team, not buy acne cream.', alt: 'A check-in note saying this looks like an acne-like rash, tell your care team' },
  { id: 'shelf', title: 'Check what’s safe to use', body: 'Every ingredient list is checked against your treatment and your latest check-in. If something you saved stops being right for you, it tells you.', alt: 'A warning that a saved acne gel is no longer right, above the shelf' },
  { id: 'ask', title: 'Ask, then try what it plans', body: 'Ask about your skin, a product, or a look for a wedding. Answers come from Still Me’s rules, and nothing runs until you tap.', alt: 'The companion planning a look for a wedding from the person’s own print' },
  { id: 'report', title: 'Walk in prepared', body: 'Your scores, notes and questions go on a summary for your care team, with a fitting sheet for your wig specialist.', alt: 'A care-team summary with a dated score table and questions' },
];

const screen = (id) => `/story/${id}.webp`;

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
 * The portrait (an AI-generated woman, not a real person). It gathers from points
 * with three.js, then the crisp photo takes over and the scene is thrown away.
 * If three.js is slow or missing, or motion is reduced, the photo simply shows.
 */
function HeroPortrait() {
  const figure = useRef(null);
  const canvas = useRef(null);
  const img = useRef(null);
  useLayoutEffect(() => {
    const save = navigator.connection?.saveData || (navigator.deviceMemory && navigator.deviceMemory <= 2);
    if (reducedMotion() || save) return undefined;
    const el = figure.current;
    let scene = null;
    let cancelGather = null;
    let finished = false;
    el.classList.add('forming');
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(slow);
      el.classList.remove('forming');
      // The crossfade takes 0.5 s; the scene goes once the photo has taken over.
      if (scene) setTimeout(() => scene?.stop(), 600);
    };
    const slow = setTimeout(finish, 2600);
    import('../lib/portrait3d.js')
      .then(({ startPortrait }) => startPortrait(canvas.current, img.current.currentSrc || img.current.src))
      .then((s) => {
        if (finished) {
          s?.stop();
          return;
        }
        if (!s) {
          finish();
          return;
        }
        clearTimeout(slow);
        scene = s;
        cancelGather = gather(s.render, finish);
      })
      .catch(finish);
    return () => {
      finished = true;
      clearTimeout(slow);
      cancelGather?.();
      scene?.stop();
    };
  }, []);
  return (
    <figure className="hero-figure" ref={figure} aria-hidden="true">
      <img ref={img} src="/portrait/portrait.webp" alt="" fetchpriority="high" width="928" height="1152" />
      <canvas ref={canvas} />
    </figure>
  );
}

/**
 * `returning`: reopened from Settings after setup. The main button goes back to
 * the journal, and the sample buttons are left out (loading the sample replaces the journal).
 */
export default function Landing({ onStart, onSample, demo, iosNote, returning = false }) {
  const root = useRef(null);
  useLayoutEffect(() => landingStory(root.current), []);
  const startLabel = returning ? 'Open my journal' : 'Set up Still Me';
  const sampleButton = !returning && (
    <button className="btn secondary" onClick={onSample}>
      See a sample journey
    </button>
  );
  const mainButton = (
    <button className="btn primary cta" onClick={onStart}>
      {startLabel}
      <span className="cta-arrow">
        <Arrow />
      </span>
    </button>
  );

  return (
    <div className="landing" ref={root}>
      <header className="land-top">
        <div className="wordmark">
          <Logo />
          Still Me
        </div>
      </header>

      <section className="hero" aria-labelledby="hero-title">
        <div className="hero-copy">
          <h1 id="hero-title" className="hero-title">
            <span className="hero-word">
              <span>Still</span>
            </span>{' '}
            <span className="hero-word">
              <span>
                <em>you.</em>
              </span>
            </span>
          </h1>
          <p className="hero-sub" data-rise>
            Your skin, hair and brows, through cancer treatment.
          </p>
          <div className="cta-row" data-rise>
            {mainButton}
            {sampleButton}
          </div>
          <p className="trust" data-rise>
            <Lock /> Your journal stays on this device.
          </p>
          {iosNote}
          {demo && <p className="fine">Results here are simulated.</p>}
        </div>
        <HeroPortrait />
      </section>

      <section className="story" aria-labelledby="story-title">
        <div className="story-head">
          <h2 id="story-title" className="display">
            From the first selfie to <em>your next appointment</em>
          </h2>
        </div>
        <div className="story-body">
          <span className="story-rail" aria-hidden="true">
            <span className="story-rail-fill" />
          </span>
          <ol className="chapters">
            {CHAPTERS.map((c) => (
              <li key={c.id} className="chapter">
                <div className="chapter-text">
                  <h3>{c.title}</h3>
                  <p>{c.body}</p>
                </div>
                <figure className="chapter-shot phone">
                  <img src={screen(c.id)} alt={c.alt} loading="lazy" width="390" height="844" />
                </figure>
              </li>
            ))}
          </ol>
          <div className="story-stage" aria-hidden="true">
            <div className="phone">
              {CHAPTERS.map((c) => (
                <img key={c.id} className="phone-screen" src={screen(c.id)} alt="" loading="lazy" width="390" height="844" />
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="final" aria-labelledby="final-title">
        <h2 id="final-title" className="display">
          Start with <em>one selfie.</em>
        </h2>
        <div className="cta-row">
          {mainButton}
          {sampleButton}
        </div>
        <div className="sheet tint stack">
          <h3>Private by design</h3>
          <p>Your photos and history stay on this device, not on our server. Photos go to the YouCam analysis service only when you ask for a check-in or try-on. If you use Ask, your question and a short summary of your journal go to an AI model, never your photos.</p>
        </div>
      </section>

      <footer className="land-foot">
        <span>Still Me, built on the YouCam API. The woman shown is AI-generated.</span>
        <span>A journal and a guide, not a diagnosis. Your care team has the final word.</span>
      </footer>
    </div>
  );
}
