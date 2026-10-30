import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore, useInsights } from '../lib/store.jsx';
import { api } from '../lib/api.js';
import { withFiles, withResult } from '../lib/files.js';
import { db, newId } from '../lib/db.js';
import { TopBar, ErrorBox } from '../components.jsx';
import { treatmentPhase, RED_FLAGS } from '../../../core/treatments.js';
import { PRODUCT_BY_ID } from '../../../core/catalog.js';
import { LIP_SHADES } from '../../../core/brows.js';

// The companion. Answers come from the server's agent, which reads Still Me's
// own rules through tools; this screen sends a short summary of the journal
// (never photos), runs proposed try-ons only when the person taps, and keeps
// what they keep or reject so later suggestions learn from it.

const STARTERS = [
  'My face feels tight and has spots. What can I use?',
  'Plan a look for a family wedding in a few weeks.',
  'What should I ask my care team this week?',
  'Is this cream OK for me? Water, Glycerin, Fragrance, Salicylic Acid',
];

const KIND_LABEL = { wig: 'Wig try-on', brows: 'Brows', regrowth: 'Regrowth preview' };

// Bold and bullet lines are the only formatting the companion uses.
function Rich({ text }) {
  const blocks = text.split(/\n{2,}/);
  const inline = (s) => s.split(/(\*\*[^*]+\*\*)/g).map((part, i) => (part.startsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : part));
  return blocks.map((b, i) => {
    const lines = b.split('\n').filter(Boolean);
    if (lines.length && lines.every((l) => /^\s*[-•*]\s+/.test(l))) {
      return <ul key={i}>{lines.map((l, j) => <li key={j}>{inline(l.replace(/^\s*[-•*]\s+/, ''))}</li>)}</ul>;
    }
    return <p key={i}>{lines.map((l, j) => <span key={j}>{j > 0 && <br />}{inline(l)}</span>)}</p>;
  });
}

function useAskData() {
  const [prefs, setPrefs] = useState([]);
  const [feedback, setFeedback] = useState([]);
  const [consent, setConsent] = useState(null);
  useEffect(() => {
    Promise.all([db.get('prefs'), db.get('lookFeedback'), db.get('askConsent')]).then(([p, f, c]) => {
      setPrefs(Array.isArray(p) ? p : []);
      setFeedback(Array.isArray(f) ? f : []);
      setConsent(Boolean(c));
    });
  }, []);
  return { prefs, setPrefs, feedback, setFeedback, consent, setConsent };
}

export default function Ask() {
  const { profile, print, list, looks, server } = useStore();
  const { current, comparison, notes } = useInsights();
  const { prefs, setPrefs, feedback, setFeedback, consent, setConsent } = useAskData();
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const endRef = useRef(null);

  // What the agent's tools read: a summary of the journal, no photos.
  const context = useMemo(() => {
    const phase = treatmentPhase(profile?.startDate);
    const c = print?.colors || {};
    const f = print?.face || {};
    return {
      name: profile?.name || undefined,
      treatments: profile?.treatments || [],
      phase,
      latest: current && !current.sample ? {
        date: current.date,
        tier: current.tier,
        scores: Object.fromEntries((comparison?.rows || []).filter((r) => r.score).map((r) => [r.key, { score: r.score.ui ?? r.score.raw, change: r.vsBase.delta, status: r.vsBase.status }])),
      } : null,
      notes: current && !current.sample ? notes : [],
      print: print && !print.sample ? { hair: c.hair_color_name, browHex: c.eyebrow_color, skinHex: c.skin_color, lipHex: c.lip_color, faceShape: f.faceShape, browShape: f.browShape, browThickness: f.browThickness } : null,
      list: list.map((id) => PRODUCT_BY_ID[id]).filter(Boolean).map((p) => `${p.line} ${p.name}`),
      looks: [...looks.filter((l) => !l.demo).slice(0, 6).map((l) => ({ label: l.label, kept: true })), ...feedback.slice(-6)],
      prefs,
    };
  }, [profile, print, list, looks, current, comparison, notes, prefs, feedback]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [messages.length, busy]);

  async function send(text) {
    const q = (text ?? draft).trim();
    if (!q || busy) return;
    setDraft('');
    setError(null);
    const history = [...messages, { id: newId(), role: 'user', content: q }];
    setMessages(history);
    setBusy(true);
    try {
      const out = await api.agent(history.map(({ role, content }) => ({ role, content })), context);
      if (out.remember?.length) {
        const next = [...new Set([...prefs, ...out.remember])].slice(-12);
        setPrefs(next);
        await db.set('prefs', next);
      }
      setMessages((m) => [...m, { id: newId(), role: 'assistant', content: out.reply, plan: out.plan, urgent: out.urgent, remembered: out.remember, demo: out.demo, model: out.model }]);
    } catch (err) {
      setError(err);
    }
    setBusy(false);
  }

  async function forget(note) {
    const next = prefs.filter((p) => p !== note);
    setPrefs(next);
    await db.set('prefs', next);
  }

  // Two quick taps must both land, so the latest list lives in a ref too.
  const feedbackRef = useRef(feedback);
  useEffect(() => {
    feedbackRef.current = feedback;
  }, [feedback]);
  async function onFeedback(label, kept) {
    const next = [...feedbackRef.current.filter((f) => f.label !== label), { label, kept }].slice(-12);
    feedbackRef.current = next;
    setFeedback(next);
    await db.set('lookFeedback', next);
  }

  if (consent === false) {
    return (
      <div className="stack-lg">
        <TopBar mode={server.mode} />
        <h1>Ask Still Me</h1>
        <section className="sheet stack">
          <p>Ask about your skin, a product, what to ask your care team, or plan a look to try on. Answers use Still Me’s own rules and your journal. It never diagnoses, and it never changes your treatment.</p>
          <p className="small">To answer, your question and a short summary of your journal go to an AI model (Claude, or GPT when Claude is busy, both through KIE): your treatment and week, latest scores and notes, print colours and shapes, saved products, looks and preferences. Never your photos. Still Me’s server doesn’t keep them.</p>
          <button className="btn primary" onClick={async () => { await db.set('askConsent', true); setConsent(true); }}>I understand, continue</button>
          <a className="btn quiet" href="#/today">Not now</a>
        </section>
      </div>
    );
  }

  return (
    <div className="stack-lg ask">
      <TopBar mode={server.mode} />
      <div className="stack">
        <h1>Ask Still Me</h1>
        <p className="muted">Skin, products, questions for your care team, or a look to try on. Facts come from Still Me’s rules, not guesses.</p>
      </div>

      {messages.length === 0 && (
        <div className="chips" aria-label="Suggestions">
          {STARTERS.map((s) => (
            <button key={s} type="button" className="chip" onClick={() => send(s)} disabled={busy}>{s}</button>
          ))}
        </div>
      )}

      <ol className="chat" aria-live="polite">
        {messages.map((m) => (
          <li key={m.id} className={`bubble ${m.role}`}>
            {m.urgent?.length > 0 && (
              <div className="note call" data-still role="alert">
                <p className="note-kicker">Contact your care team now</p>
                <p className="small">Call them, or your emergency number, if you have: {m.urgent.join('; ').toLowerCase()}.</p>
              </div>
            )}
            {m.role === 'assistant' ? <Rich text={m.content} /> : <p>{m.content}</p>}
            {m.remembered?.length > 0 && <p className="fine">Noted for next time: {m.remembered.join('; ')}</p>}
            {m.plan && <PlanCard plan={m.plan} onFeedback={onFeedback} />}
            {m.demo && <p className="fine">Demo mode: no model key on this server.</p>}
          </li>
        ))}
        {busy && <li className="bubble assistant thinking" role="status">Checking Still Me’s rules…</li>}
      </ol>
      <div ref={endRef} />
      <ErrorBox error={error} onRetry={error ? () => send(messages.filter((m) => m.role === 'user').at(-1)?.content) : undefined} />

      <form className="ask-form" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <label className="sr-only" htmlFor="ask-input">Your question</label>
        <textarea id="ask-input" className="input" rows={2} maxLength={1500} value={draft} placeholder="Ask about your skin, a product, or a look" onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} />
        <button className="btn primary" type="submit" disabled={busy || !draft.trim()}>Send</button>
      </form>

      {prefs.length > 0 && (
        <details className="sheet">
          <summary style={{ cursor: 'pointer', fontWeight: 700 }}>What Still Me remembers ({prefs.length})</summary>
          <ul className="stack" style={{ marginTop: 10, paddingLeft: 0, listStyle: 'none' }}>
            {prefs.map((p) => (
              <li key={p} className="row" style={{ justifyContent: 'space-between' }}>
                <span className="small">{p}</span>
                <button className="btn quiet small" onClick={() => forget(p)}>Forget</button>
              </li>
            ))}
          </ul>
        </details>
      )}
      <p className="fine">Not medical advice. For anything on this list, contact your care team straight away: {RED_FLAGS[0].split('.')[0].toLowerCase()}, and the other warning signs on Today.</p>
    </div>
  );
}

// A proposed set of try-ons. Nothing runs, and no units are spent, until the person taps Run.
function PlanCard({ plan, onFeedback }) {
  const { print, addLook } = useStore();
  const [portrait, setPortrait] = useState(null);
  const [browPhoto, setBrowPhoto] = useState(null);
  const [state, setState] = useState('ready'); // ready | running | done
  const [at, setAt] = useState(-1);
  const [results, setResults] = useState([]);
  const [error, setError] = useState(null);
  const [verdicts, setVerdicts] = useState({});

  useEffect(() => {
    db.get('portrait').then((p) => p && setPortrait(p));
    db.get('browPhoto').then((p) => p && setBrowPhoto(p));
  }, []);

  const needsPortrait = plan.steps.some((s) => s.kind !== 'brows');
  const face = browPhoto ? { key: `brow:${browPhoto.id}`, dataUrl: browPhoto.dataUrl } : print?.photo ? { key: `print:${print.date}`, dataUrl: print.photo } : null;
  const needsFace = plan.steps.some((s) => s.kind === 'brows');
  const missing = (needsPortrait && !portrait) || (needsFace && !face);

  async function runStep(s) {
    const me = portrait && { key: `portrait:${portrait.id}`, dataUrl: portrait.dataUrl };
    const c = print?.colors || {};
    if (s.kind === 'wig') {
      let out = await withFiles([me], (fileId) => api.hairTryOn({ fileId, templateId: s.templateId, keepColor: false }));
      if (s.recolour && c.hair_color_name) {
        const id = newId();
        const coloured = await withResult(`plan:${id}`, out.image, (fileId) => api.hairColor({ fileId, family: c.hair_color_name }));
        out = { ...coloured, demo: out.demo || coloured.demo };
      }
      return { ...out, label: `Wig${s.recolour ? ', in my colour' : ''}` };
    }
    if (s.kind === 'brows') {
      const lips = s.lips === 'mine' ? c.lip_color : LIP_SHADES.find((l) => l.id === s.lips)?.hex || null;
      const out = await withFiles([face], (fileId) => api.browTryOn({
        fileId,
        pattern: s.pattern,
        color: c.eyebrow_color || '#3b2a20', // ds-allow-hardcode: fallback brow colour
        intensity: 55,
        thickness: 0,
        lashes: s.lashes ? { style: s.lashes } : undefined,
        underEye: s.underEye && c.skin_color ? { color: c.skin_color } : undefined,
        lips: lips ? { color: lips } : undefined,
      }));
      return { ...out, label: 'Brows and makeup' };
    }
    const out = await withFiles([me], (fileId) => api.regrowth({ fileId, family: s.shade }));
    return { ...out, label: `Regrowth, ${String(s.shade).toLowerCase()}` };
  }

  async function run() {
    setState('running');
    setError(null);
    const done = [];
    for (let i = 0; i < plan.steps.length; i++) {
      setAt(i);
      try {
        done.push({ ...(await runStep(plan.steps[i])), step: plan.steps[i] });
        setResults([...done]);
      } catch (err) {
        setError(err);
        break;
      }
    }
    setAt(-1);
    setState('done');
  }

  async function verdict(r, kept) {
    const label = `${plan.title}: ${r.label}`;
    setVerdicts((v) => ({ ...v, [r.label]: kept }));
    await onFeedback(label, kept);
    if (kept) await addLook({ id: newId(), kind: r.step.kind === 'brows' ? 'brows' : 'hair', image: r.image, label: r.demo ? `${label} (demo)` : label, createdAt: new Date().toISOString(), demo: r.demo });
  }

  return (
    <div className="plan stack">
      <div className="section-title">
        <h3>{plan.title}</h3>
        <span className="fine">{plan.units} units{plan.livePrices ? ', live prices' : ''}</span>
      </div>
      <ol className="plan-steps">
        {plan.steps.map((s, i) => (
          <li key={i} aria-current={at === i ? 'step' : undefined}>
            <strong>{KIND_LABEL[s.kind]}</strong> <span className="fine">({s.units} {s.units === 1 ? 'unit' : 'units'})</span>
            <span className="small" style={{ display: 'block' }}>{s.why}</span>
          </li>
        ))}
      </ol>
      {missing ? (
        <p className="small">
          First add {needsPortrait && !portrait ? 'a head-and-shoulders portrait' : 'your Hair & Brow Print'} in <a href="#/look">Hair & brows</a>, then come back and run this plan.
        </p>
      ) : state === 'ready' ? (
        <button className="btn primary" onClick={run}>Run these try-ons ({plan.units} units)</button>
      ) : null}
      {state === 'running' && <p role="status" className="small">Rendering {KIND_LABEL[plan.steps[at]?.kind]?.toLowerCase() || 'your looks'}…</p>}
      <ErrorBox error={error} />
      {results.length > 0 && (
        <div className="lookbook">
          {results.map((r) => (
            <figure key={r.label} className="stack">
              <img src={r.image} alt={r.label} />
              <figcaption className="small">{r.label}{r.demo ? ' (demo)' : ''}</figcaption>
              {verdicts[r.label] === undefined ? (
                <div className="row wrap">
                  <button className="btn secondary small" onClick={() => verdict(r, true)}>Keep</button>
                  <button className="btn quiet small" onClick={() => verdict(r, false)}>Not for me</button>
                </div>
              ) : (
                <p className="fine">{verdicts[r.label] ? 'Saved to your looks. Still Me will suggest more like it.' : 'Noted. Still Me will steer away from this.'}</p>
              )}
            </figure>
          ))}
        </div>
      )}
    </div>
  );
}
