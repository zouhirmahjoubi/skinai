import { Fragment, useLayoutEffect, useRef } from 'react';
import { Logo } from '../components.jsx';
import { landingStory } from '../lib/motion.js';

// The first screen: the promise and the button at once, then the app's story as a
// run of paintings. Every painting is decoration (the words carry the meaning), so
// they are hidden from screen readers and the text reads in order. The real app
// screens follow at the end.

const CHAPTERS = [
  { id: 'print', tone: 'light', label: 'The record', chip: 'Hair & Brow Print', title: 'Keep your own look on record', body: 'One selfie saves your hair colour, brow shape and face shape before anything changes. Your wig specialist can work from it later.' },
  { id: 'looks', tone: 'dark', label: 'The fitting', chip: 'Wigs, brows, earrings', title: 'See it on your own face', body: 'Try wigs in your own colour, your brows drawn back on, and how your hair might grow back. Many shops won’t take a wig back once it’s been worn.' },
  { id: 'check', tone: 'dark', label: 'The week', chip: 'Skin Watch', title: 'Know which changes matter', body: 'A weekly selfie is read against your treatment and your week. On an EGFR inhibitor, a falling clear-skin score means tell your care team, not buy acne cream.' },
  { id: 'shelf', tone: 'light', label: 'The shelf', chip: 'Gentle shelf', title: 'Check what’s safe to use', body: 'Every ingredient list is checked against your treatment and your latest check-in. If something you saved stops being right for you, it tells you.' },
  { id: 'ask', tone: 'dark', label: 'The plan', chip: 'Ask', title: 'Ask, then try what it plans', body: 'Ask about your skin, a product, or a look for a wedding. Answers come from Still Me’s rules, and nothing runs until you tap.' },
  { id: 'report', tone: 'light', label: 'The handover', chip: 'Care-team summary', title: 'Walk in prepared', body: 'Your scores, notes and questions go on a summary for your care team, with a fitting sheet for your wig specialist.' },
];

const SCREENS = [
  { id: 'print', alt: 'Hair and brow print with measured colours and face shape' },
  { id: 'looks', alt: 'A saved lookbook of wigs, brows and earrings on one person' },
  { id: 'check', alt: 'A check-in note saying this looks like an acne-like rash, tell your care team' },
  { id: 'shelf', alt: 'A warning that a saved acne gel is no longer right, above the shelf' },
  { id: 'ask', alt: 'The companion planning a look for a wedding from the person’s own print' },
  { id: 'report', alt: 'A care-team summary with a dated score table and questions' },
];

function Arrow() {
  return (
    <span className="arrow-box" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="14" height="14">
        <path d="M5 12h14m-5-5 5 5-5 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

/** A heading whose words can rise one by one, each behind its own mask. It still reads as one line of text. */
function Words({ text }) {
  return text.split(' ').map((word, i) => (
    <Fragment key={i}>
      {i > 0 && ' '}
      <span className="hero-word">
        <span>{word}</span>
      </span>
    </Fragment>
  ));
}

/** One painting: tall on a phone, wide on a laptop. Shown only when the shared stage isn't running. */
function Painting({ id, eager = false }) {
  return (
    <picture className="painting" aria-hidden="true">
      <source media="(max-aspect-ratio: 1/1)" srcSet={`/scenes/${id}-t.webp`} />
      <img src={`/scenes/${id}-w.webp`} alt="" loading={eager ? 'eager' : 'lazy'} decoding="async" />
    </picture>
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
      <Arrow />
    </button>
  );

  return (
    <div className="landing" ref={root} data-tone="dark">
      <div className="stage" aria-hidden="true">
        <canvas />
      </div>
      <canvas className="dust" aria-hidden="true" />

      <div className="guides" aria-hidden="true">
        <span className="guide-v" />
        <span className="guide-h" />
        <span className="guide-star" />
        <span className="guide-ticks" />
        <span className="guide-mark" />
        <span className="guide-label">The promise</span>
      </div>

      <header className="land-top">
        <div className="wordmark">
          <Logo />
          Still Me
        </div>
        <button className="btn top-cta" onClick={onStart}>
          {returning ? 'Open' : 'Set up'}
          <Arrow />
        </button>
      </header>

      <section className="scene hero" data-scene="hero" data-tone="dark" data-label="The promise" aria-labelledby="hero-title">
        <Painting id="hero" eager />
        <div className="scene-hold">
          <div className="hero-copy">
            <div className="hero-head">
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
            </div>
            <div className="hero-foot">
              <div className="cta-row" data-rise>
                {mainButton}
                {sampleButton}
              </div>
              <p className="scene-note" data-rise>
                <span className="tag">Private</span>
                Your journal stays on this device.
              </p>
              {iosNote}
              {demo && <p className="fine">Results here are simulated.</p>}
            </div>
          </div>
        </div>
      </section>

      {CHAPTERS.map((c) => (
        <section key={c.id} className="scene" data-scene={c.id} data-tone={c.tone} data-label={c.label} aria-labelledby={`scene-${c.id}`}>
          <Painting id={c.id} />
          <div className="scene-hold">
            <div className="scene-copy">
              <h2 id={`scene-${c.id}`}>
                <Words text={c.title} />
              </h2>
              <p className="scene-note">
                <span className="tag">{c.chip}</span>
                <span>{c.body}</span>
              </p>
            </div>
          </div>
        </section>
      ))}

      <section className="scene last" data-scene="start" data-tone="dark" data-label="The start" aria-labelledby="final-title">
        <Painting id="start" />
        <div className="scene-hold">
          <div className="scene-copy">
            <h2 id="final-title">
              <Words text="Start with one selfie." />
            </h2>
            <div className="cta-row">
              {mainButton}
              {sampleButton}
            </div>
          </div>
        </div>
      </section>

      <div className="land-end">
        <section aria-labelledby="screens-title">
          <h2 id="screens-title">From the first selfie to your next appointment</h2>
          <p className="muted">The real app, from the sample journey.</p>
          <ul className="screens" tabIndex={0} aria-label="Screens from the sample journey">
            {SCREENS.map((s) => (
              <li key={s.id} className="phone">
                <img src={`/story/${s.id}.webp`} alt={s.alt} loading="lazy" width="390" height="844" />
              </li>
            ))}
          </ul>
        </section>
        <div className="sheet tint stack">
          <h3>Private by design</h3>
          <p>Your photos and history stay on this device, not on our server. Photos go to the YouCam analysis service only when you ask for a check-in or try-on. If you use Ask, your question and a short summary of your journal go to an AI model, never your photos.</p>
        </div>
        <footer className="land-foot">
          <span>Still Me, built on the YouCam API. The people in these paintings are AI-generated.</span>
          <span>A journal and a guide, not a diagnosis. Your care team has the final word.</span>
        </footer>
      </div>
    </div>
  );
}
