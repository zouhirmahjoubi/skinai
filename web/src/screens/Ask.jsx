import { memo, useEffect, useMemo, useRef, useState } from 'react';
import * as m from 'motion/react-m';
import { useStore, useInsights } from '../lib/store.jsx';
import { api } from '../lib/api.js';
import { withFiles, withResult } from '../lib/files.js';
import { db, newId } from '../lib/db.js';
import { askSession, updateAsk, useAskSession } from '../lib/askSession.js';
import { reducedMotion } from '../lib/reduced.js';
import { TopBar, ErrorBox, Working } from '../components.jsx';
import { treatmentPhase } from '../../../core/treatments.js';
import { urgentFlags } from '../../../core/safety.js';
import { PRODUCT_BY_ID } from '../../../core/catalog.js';
import { LIP_SHADES } from '../../../core/brows.js';

// The companion. Answers come from the server's agent, which reads Still Me's
// own rules through tools; this screen sends a short summary of the journal
// (never photos or a name), runs proposed try-ons only when the person taps, and
// keeps what they keep or reject so later suggestions learn from it. Red flags
// are matched here too, so the warning shows at once, even offline.

const STARTERS = [
  'My face feels tight and has spots. What can I use?',
  'Plan a look for a family wedding in a few weeks.',
  'What should I ask my care team this week?',
  'Is this cream OK for me? Water, Glycerin, Fragrance, Salicylic Acid',
];

const KIND_LABEL = { wig: 'Wig try-on', brows: 'Brows and makeup', regrowth: 'Regrowth preview' };
const HISTORY = 10; // the server uses the last ten turns, so sending more only risks the size limit
const ARRIVE = { initial: { opacity: 0, y: 10 }, animate: { opacity: 1, y: 0 }, transition: { type: 'spring', stiffness: 380, damping: 36 } };

// Bold and bullet lines are the only formatting the companion uses.
const Rich = memo(function Rich({ text }) {
  const inline = (s) => s.split(/(\*\*[^*]+\*\*)/g).map((part, i) => (part.startsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : part));
  return text.split(/\n{2,}/).map((b, i) => {
    const lines = b.split('\n').filter(Boolean);
    if (lines.length && lines.every((l) => /^\s*[-•*]\s+/.test(l))) {
      return <ul key={i}>{lines.map((l, j) => <li key={j}>{inline(l.replace(/^\s*[-•*]\s+/, ''))}</li>)}</ul>;
    }
    return <p key={i}>{lines.map((l, j) => <span key={j}>{j > 0 && <br />}{inline(l)}</span>)}</p>;
  });
});

function useAskData() {
  const [prefs, setPrefs] = useState([]);
  const [feedback, setFeedback] = useState([]);
  const [consent, setConsent] = useState(null);
  const [photos, setPhotos] = useState({ portrait: null, browPhoto: null });
  useEffect(() => {
    Promise.all([db.get('prefs'), db.get('lookFeedback'), db.get('askConsent'), db.get('portrait'), db.get('browPhoto')]).then(([p, f, c, portrait, browPhoto]) => {
      setPrefs(Array.isArray(p) ? p : []);
      setFeedback(Array.isArray(f) ? f : []);
      setConsent(Boolean(c));
      setPhotos({ portrait: portrait || null, browPhoto: browPhoto || null });
    });
  }, []);
  return { prefs, setPrefs, feedback, setFeedback, consent, setConsent, photos };
}

/** The input lives apart, so typing doesn't redraw the whole conversation. */
function AskForm({ busy, onSend }) {
  const [draft, setDraft] = useState('');
  const box = useRef(null);
  const submit = () => {
    const q = draft.trim();
    if (!q || busy) return;
    setDraft('');
    if (box.current) box.current.style.height = '';
    onSend(q);
  };
  return (
    <form className="ask-form" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <label className="sr-only" htmlFor="ask-input">Your question</label>
      <textarea
        ref={box}
        id="ask-input"
        className="input"
        rows={1}
        maxLength={1500}
        value={draft}
        placeholder="Ask about skin or a look"
        onChange={(e) => {
          setDraft(e.target.value);
          // One row to start, growing with the question.
          e.target.style.height = 'auto';
          e.target.style.height = `${Math.min(e.target.scrollHeight + 2, 140)}px`;
        }}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}
      />
      <button className="btn primary" type="submit" disabled={busy || !draft.trim()}>Send</button>
    </form>
  );
}

function UrgentNote({ flags }) {
  return (
    <div className="note call" data-still role="alert">
      <div className="note-kicker">Contact your care team now</div>
      <p className="small">Use the number your treatment centre gave you, or your emergency number. This is why:</p>
      <ul className="list-plain small">
        {flags.map((f) => <li key={f}>{f}</li>)}
      </ul>
    </div>
  );
}

export default function Ask() {
  const { profile, print, list, looks, server } = useStore();
  const { current, comparison, notes } = useInsights();
  const { prefs, setPrefs, feedback, setFeedback, consent, setConsent, photos } = useAskData();
  const { messages, pending: busy, error, lastQuestion } = useAskSession();
  const endRef = useRef(null);

  // What the agent's tools read: a summary of the journal, no photos and no name.
  const context = useMemo(() => {
    const phase = treatmentPhase(profile?.startDate);
    const c = print?.colors || {};
    const f = print?.face || {};
    return {
      treatments: profile?.treatments || [],
      phase,
      latest: current ? {
        date: current.date,
        tier: current.tier,
        scores: Object.fromEntries((comparison?.rows || []).filter((r) => r.score).map((r) => [r.key, { score: r.score.ui ?? r.score.raw, change: r.vsBase.delta, status: r.vsBase.status }])),
      } : null,
      notes,
      print: print ? { hair: c.hair_color_name, browHex: c.eyebrow_color, skinHex: c.skin_color, lipHex: c.lip_color, faceShape: f.faceShape, browShape: f.browShape, browThickness: f.browThickness } : null,
      list: list.map((id) => PRODUCT_BY_ID[id]).filter(Boolean).map((p) => `${p.line} ${p.name}`),
      looks: [...looks.filter((l) => !l.demo).slice(0, 6).map((l) => ({ label: l.label, kept: true })), ...feedback.slice(-6)],
      prefs,
    };
  }, [profile, print, list, looks, current, comparison, notes, prefs, feedback]);

  useEffect(() => {
    if (messages.length) endRef.current?.scrollIntoView({ block: 'end', behavior: reducedMotion() ? 'auto' : 'smooth' });
  }, [messages.length, busy]);

  // A question can finish while the person is away, so what it remembered is read again.
  useEffect(() => {
    db.get('prefs').then((p) => setPrefs(Array.isArray(p) ? p : [])).catch(() => {});
  }, [messages.length, setPrefs]);

  async function ask(q, { repeat = false } = {}) {
    const session = askSession();
    if (session.pending) return;
    // It carries on if the person leaves Ask, but an answer that returns after the
    // journal was deleted or replaced is dropped, along with anything it remembered.
    const gone = () => askSession() !== session;
    updateAsk((s) => {
      s.pending = true;
      s.error = null;
      s.lastQuestion = q;
      if (!repeat) s.messages.push({ id: newId(), role: 'user', content: q, urgent: urgentFlags(q) });
    });
    try {
      const history = session.messages.slice(-HISTORY).map(({ role, content }) => ({ role, content }));
      const out = await api.agent(history, context);
      if (gone()) return;
      if (out.remember?.length) {
        const saved = await db.get('prefs');
        if (gone()) return;
        await db.set('prefs', [...new Set([...(Array.isArray(saved) ? saved : []), ...out.remember])].slice(-12));
      }
      updateAsk((s) => {
        s.pending = false;
        s.messages.push({ id: newId(), role: 'assistant', content: out.reply, plan: out.plan, remembered: out.remember, rulesOnly: out.rulesOnly });
      });
    } catch (err) {
      if (!gone()) updateAsk((s) => { s.pending = false; s.error = err; });
    }
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
          <p className="small">To answer, your question and a short summary of your journal go to an AI model (Claude or GPT, through KIE): your treatment and week, latest scores and notes, print colours and shapes, saved products, looks and preferences. Never your photos or your name. Still Me’s server doesn’t keep them; KIE and the model provider handle them under their own terms.</p>
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
        <p className="muted">Skin, products, questions for your care team, or a look to try on.</p>
      </div>

      {messages.length === 0 && (
        <div className="starters" aria-label="Suggestions">
          {STARTERS.map((s) => (
            <button key={s} type="button" className="chip" onClick={() => ask(s)} disabled={busy}>{s}</button>
          ))}
        </div>
      )}

      {messages.length > 0 && (
        <ol className="chat" aria-live="polite">
          {messages.map((msg) => (
            // Warnings never move: a message holding one appears at once.
            <m.li key={msg.id} className={`bubble ${msg.role}`} {...(msg.urgent?.length ? {} : ARRIVE)}>
              {msg.role === 'assistant' ? <Rich text={msg.content} /> : <p>{msg.content}</p>}
              {msg.urgent?.length > 0 && <UrgentNote flags={msg.urgent} />}
              {msg.remembered?.length > 0 && <p className="fine">Noted for next time: {msg.remembered.join('; ')}</p>}
              {msg.plan && <PlanCard id={msg.id} plan={msg.plan} photos={photos} onFeedback={onFeedback} />}
              {msg.rulesOnly && <p className="fine">Answered from Still Me’s rules.</p>}
            </m.li>
          ))}
          {busy && <li className="bubble assistant thinking" role="status"><Working label="Checking Still Me’s rules…" /></li>}
        </ol>
      )}
      <div ref={endRef} className="chat-end" />
      <ErrorBox error={error} onRetry={error && lastQuestion ? () => ask(lastQuestion, { repeat: true }) : undefined} />

      <AskForm busy={busy} onSend={ask} />

      {prefs.length > 0 && (
        <details className="sheet">
          <summary style={{ cursor: 'pointer', fontWeight: 700 }}>What Still Me remembers ({prefs.length})</summary>
          <ul className="stack" style={{ marginTop: 10, paddingLeft: 0, listStyle: 'none' }}>
            {prefs.map((p) => (
              <li key={p} className="row spread">
                <span className="small">{p}</span>
                <button className="btn quiet small" onClick={() => forget(p)}>Forget</button>
              </li>
            ))}
          </ul>
        </details>
      )}
      <p className="fine">Not medical advice. Call your care team straight away for a temperature of 38°C (100.4°F) or higher. <a href="#/today">All warning signs are on Today.</a></p>
    </div>
  );
}

// Keeps going if the person leaves Ask: results land in the session, and paid
// work already done is never thrown away or repeated. It stops if the journal is
// deleted or replaced, so no more units are spent on a chat that has gone.
async function runPlan(id, plan, photos, print) {
  const session = askSession();
  const gone = () => askSession() !== session;
  const state = () => session.plans[id];
  const set = (patch) => { if (!gone()) updateAsk((s) => { s.plans[id] = { ...s.plans[id], ...patch }; }); };
  const me = photos.portrait && { key: `portrait:${photos.portrait.id}`, dataUrl: photos.portrait.dataUrl };
  const face = photos.browPhoto ? { key: `brow:${photos.browPhoto.id}`, dataUrl: photos.browPhoto.dataUrl } : print?.photo ? { key: `print:${print.date}`, dataUrl: print.photo } : null;
  const c = print?.colors || {};

  async function runStep(s, i) {
    if (s.kind === 'wig') {
      const wig = state().results[i] || { ...(await withFiles([me], (fileId) => api.hairTryOn({ fileId, templateId: s.templateId, keepColor: false }))), label: `Wig: ${s.title || 'style'}` };
      if (!state().results[i]) set({ results: { ...state().results, [i]: wig } });
      if (s.recolour && c.hair_color_name && !wig.coloured) {
        const out = await withResult(`plan:${id}:${i}`, wig.image, (fileId) => api.hairColor({ fileId, family: c.hair_color_name }));
        set({ results: { ...state().results, [i]: { ...wig, image: out.image, demo: wig.demo || out.demo, coloured: true, label: `${wig.label}, in my colour` } } });
      }
      return;
    }
    let out;
    if (s.kind === 'brows') {
      const lips = s.lips === 'mine' ? c.lip_color : LIP_SHADES.find((l) => l.id === s.lips)?.hex || null;
      out = await withFiles([face], (fileId) => api.browTryOn({
        fileId,
        pattern: s.pattern,
        color: c.eyebrow_color,
        intensity: 55,
        thickness: 0,
        lashes: s.lashes ? { style: s.lashes } : undefined,
        underEye: s.underEye && c.skin_color ? { color: c.skin_color } : undefined,
        lips: lips ? { color: lips } : undefined,
      }));
      out = { ...out, label: 'Brows and makeup' };
    } else {
      out = await withFiles([me], (fileId) => api.regrowth({ fileId, family: s.shade }));
      out = { ...out, label: `Regrowth, ${String(s.shade).toLowerCase()}` };
    }
    set({ results: { ...state().results, [i]: out } });
  }

  set({ status: 'running', errors: {} });
  for (let i = 0; i < plan.steps.length; i++) {
    if (gone()) return;
    const done = state().results[i];
    if (done && (plan.steps[i].kind !== 'wig' || done.coloured || !plan.steps[i].recolour || !c.hair_color_name)) continue;
    set({ at: i });
    try {
      await runStep(plan.steps[i], i);
    } catch (err) {
      set({ errors: { ...state().errors, [i]: err } });
    }
  }
  set({ status: 'done', at: -1 });
}

// A proposed set of try-ons. Nothing runs, and no units are spent, until the person taps Run.
function PlanCard({ id, plan, photos, onFeedback }) {
  const { print, addLook } = useStore();
  const session = useAskSession();
  const run = session.plans[id] || { status: 'ready', at: -1, results: {}, errors: {}, verdicts: {} };
  const needsPortrait = plan.steps.some((s) => s.kind !== 'brows');
  const needsFace = plan.steps.some((s) => s.kind === 'brows');
  const hasFace = Boolean(photos.browPhoto || print?.photo);
  const missing = (needsPortrait && !photos.portrait) || (needsFace && !hasFace);
  const failed = Object.keys(run.errors).length > 0;
  const units = (n) => `${n} ${n === 1 ? 'unit' : 'units'}`;

  const start = () => {
    if (!session.plans[id]) updateAsk((s) => { s.plans[id] = run; });
    runPlan(id, plan, photos, print);
  };

  async function verdict(i, r, kept) {
    const label = `${plan.title}: ${r.label}`;
    updateAsk((s) => { s.plans[id].verdicts = { ...s.plans[id].verdicts, [i]: kept }; });
    await onFeedback(label, kept);
    if (kept) await addLook({ id: newId(), kind: plan.steps[i].kind === 'brows' ? 'brows' : 'hair', image: r.image, label: r.demo ? `${label} (simulated)` : label, createdAt: new Date().toISOString(), demo: r.demo });
  }

  return (
    <m.div className="plan stack" {...ARRIVE}>
      <div className="section-title">
        <h2 className="plan-title">{plan.title}</h2>
        <span className="fine">YouCam cost: {units(plan.units)}{plan.livePrices ? ', live price' : ''}</span>
      </div>
      <ol className="plan-steps">
        {plan.steps.map((s, i) => (
          <m.li key={i} aria-current={run.at === i ? 'step' : undefined} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.08 * i, duration: 0.3, ease: [0.22, 1, 0.36, 1] }}>
            <strong>{KIND_LABEL[s.kind]}{s.title ? `: ${s.title}` : ''}</strong>
            <span className="small" style={{ display: 'block' }}>{s.why}</span>
          </m.li>
        ))}
      </ol>
      {missing ? (
        <p className="small">
          First add {needsPortrait && !photos.portrait ? 'a head-and-shoulders portrait' : 'your Hair & Brow Print'} in <a href="#/look">Looks</a>. This plan will still be here when you come back.
        </p>
      ) : run.status === 'ready' ? (
        <button className="btn primary" onClick={start}>Run {plan.steps.length === 1 ? 'this try-on' : 'these try-ons'}</button>
      ) : null}
      {run.status === 'running' && <Working label={`Rendering: ${KIND_LABEL[plan.steps[run.at]?.kind]?.toLowerCase() || 'your looks'}`} />}
      {Object.entries(run.errors).map(([i, err]) => (
        <div key={i}>
          <p className="fine">{KIND_LABEL[plan.steps[i].kind]}:</p>
          <ErrorBox error={err} />
        </div>
      ))}
      {failed && run.status === 'done' && <button className="btn secondary small" onClick={start}>Try the failed ones again</button>}
      {Object.keys(run.results).length > 0 && (
        <div className="lookbook">
          {Object.entries(run.results).map(([i, r]) => (
            <m.figure key={i} className="stack" initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}>
              <img src={r.image} alt={r.label} />
              <figcaption className="small">{r.label}{r.demo ? ' (simulated)' : ''}</figcaption>
              {run.verdicts?.[i] === undefined ? (
                <div className="row wrap">
                  <button className="btn secondary small" onClick={() => verdict(i, r, true)}>Keep</button>
                  <button className="btn quiet small" onClick={() => verdict(i, r, false)}>Not for me</button>
                </div>
              ) : (
                <p className="fine">{run.verdicts[i] ? 'Saved to your looks. Still Me will suggest more like it.' : 'Noted. Still Me will steer away from this.'}</p>
              )}
            </m.figure>
          ))}
        </div>
      )}
    </m.div>
  );
}
