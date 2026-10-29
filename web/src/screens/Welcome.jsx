import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useStore, go } from '../lib/store.jsx';
import { enterScreen } from '../lib/motion.js';
import Landing from './Landing.jsx';
import { TREATMENTS, TREATMENT_KEYS } from '../../../core/treatments.js';
import { today } from '../lib/db.js';

const isIOS = typeof navigator !== 'undefined' && (/iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
const standalone = typeof window !== 'undefined' && (window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true);

export default function Welcome() {
  const { saveProfile, loadSample, server } = useStore();
  const [step, setStep] = useState(0);
  const [treatments, setTreatments] = useState([]);
  const [startDate, setStartDate] = useState(today());
  const [name, setName] = useState('');
  const [consent, setConsent] = useState(false);

  // The steps share one route, so App's focus-the-heading effect never runs here:
  // each step opens at the top, names itself and moves focus to its question.
  const shownStep = useRef(step);
  useEffect(() => {
    if (shownStep.current === step) return;
    shownStep.current = step;
    document.title = step ? `Set up, step ${step} of 3 · Ahead` : 'Welcome · Ahead';
    window.scrollTo(0, 0);
    const h1 = document.querySelector('main h1');
    if (h1) {
      h1.setAttribute('tabindex', '-1');
      h1.focus({ preventScroll: true });
    }
  }, [step]);

  // The landing runs its own scroll story; each setup step fades up like any other screen.
  const rootRef = useRef(null);
  useLayoutEffect(() => (step === 0 ? undefined : enterScreen(rootRef.current)), [step]);

  const toggle = (k) => setTreatments((t) => (t.includes(k) ? t.filter((x) => x !== k) : [...t, k]));

  async function finish() {
    await saveProfile({ name: name.trim(), treatments, startDate, consentedAt: new Date().toISOString() });
    go('/today');
  }

  async function sample() {
    await loadSample();
    go('/today');
  }

  if (step === 0) {
    return (
      <Landing
        onStart={() => setStep(1)}
        onSample={sample}
        demo={server.mode === 'demo'}
        iosNote={isIOS && !standalone && <p className="small">On iPhone, Safari can clear websites you haven’t opened for a week. Add Ahead to your Home Screen first (Share, then Add to Home Screen) and set it up from there.</p>}
      />
    );
  }

  if (step === 1) {
    return (
      <div className="stack-lg" ref={rootRef}>
        <div className="stack">
          <p className="muted">Step 1 of 3</p>
          <h1>Which treatments are you having?</h1>
          <p className="muted">Choose all that apply. This only changes how Ahead explains skin changes; you can edit it later.</p>
        </div>
        <fieldset style={{ border: 0, padding: 0, marginInline: 0, marginBottom: 0 }}>
          <legend className="sr-only">Treatments</legend>
          {TREATMENT_KEYS.map((k) => (
            <label key={k} className="choice">
              <input type="checkbox" checked={treatments.includes(k)} onChange={() => toggle(k)} />
              <span>
                <strong>{TREATMENTS[k].label}</strong>
                <span className="muted small">{TREATMENTS[k].hint}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <p className="fine">Not sure which type you have? Your treatment plan or pharmacist can tell you. You can also continue without choosing.</p>
        <div className="row">
          <button className="btn secondary" onClick={() => setStep(0)}>Back</button>
          <button className="btn primary" style={{ flex: 1 }} onClick={() => setStep(2)}>Continue</button>
        </div>
      </div>
    );
  }

  if (step === 2) {
    return (
      <div className="stack-lg" ref={rootRef}>
        <div className="stack">
          <p className="muted">Step 2 of 3</p>
          <h1>When does treatment start?</h1>
          <p className="muted">Many side effects follow a typical timeline from the first dose. If you haven’t started yet, even better: you can take a baseline photo first.</p>
        </div>
        <label className="field">
          <span>First treatment day</span>
          <input className="input" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
        </label>
        <label className="field">
          <span>What should Ahead call you? (optional)</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="given-name" />
        </label>
        <div className="row">
          <button className="btn secondary" onClick={() => setStep(1)}>Back</button>
          <button className="btn primary" style={{ flex: 1 }} onClick={() => setStep(3)} disabled={!startDate}>Continue</button>
        </div>
      </div>
    );
  }

  return (
    <div className="stack-lg" ref={rootRef}>
      <div className="stack">
        <p className="muted">Step 3 of 3</p>
        <h1>Before you start</h1>
      </div>
      <ul className="list-plain stack" style={{ marginTop: 28 }}>
        <li>Ahead is a journal and a guide, not a diagnosis. Your care team always has the final word, and the safety signs on the Today screen mean call them now.</li>
        <li>Skin scores come from the YouCam AI Skin Analysis service. One photo can be off, so Ahead only flags changes larger than normal photo-to-photo variation.</li>
        <li>Photos you analyse are uploaded to YouCam (Perfect Corp.). Ahead asks YouCam to delete each check-in photo and its results as soon as they arrive; try-on photos are deleted by YouCam automatically within its retention period (up to 30 days). Ahead’s server doesn’t store photos.</li>
      </ul>
      <label className="choice">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        <span>I understand, and I’m happy for the photos I choose to be analysed this way.</span>
      </label>
      <div className="row">
        <button className="btn secondary" onClick={() => setStep(2)}>Back</button>
        <button className="btn primary" style={{ flex: 1 }} onClick={finish} disabled={!consent}>Start using Ahead</button>
      </div>
    </div>
  );
}
