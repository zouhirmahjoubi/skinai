import { useStore, useInsights } from '../lib/store.jsx';
import { TopBar, Icon, NoteCard } from '../components.jsx';
import { CONCERNS, displayScore } from '../../../core/concerns.js';
import { TREATMENTS, treatmentPhase, RED_FLAGS } from '../../../core/treatments.js';
import { questionsFor } from '../../../core/insights.js';

const fmt = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

export default function Report() {
  const { profile, checkins, server } = useStore();
  const { current, notes } = useInsights();
  const tier = current?.tier;
  const rows = checkins.filter((c) => c.tier === tier).slice(-6);
  const questions = questionsFor(notes);
  const phase = treatmentPhase(profile.startDate);
  const shown = notes.filter((n) => n.level !== 'good' && n.id !== 'baseline');

  return (
    <div className="stack-lg">
      <TopBar back="#/today" mode={server.mode} right={<button className="btn secondary small no-print" onClick={() => window.print()}><Icon name="print" />Print or save PDF</button>} />
      <header className="stack">
        <h1>Skin summary for my care team</h1>
        <p>
          {profile.name ? `${profile.name}. ` : ''}
          {(profile.treatments || []).map((t) => TREATMENTS[t].noun).join(' and ').replace(/^./, (c) => c.toUpperCase()) || 'Treatment not specified'}; started {new Date(`${profile.startDate}T12:00:00`).toLocaleDateString()}
          {phase.phase === 'during' ? ` (week ${phase.week})` : ''}. Prepared {new Date().toLocaleDateString()}.
        </p>
        <p className="fine">Self-tracked with the Ahead app using YouCam AI Skin Analysis photos (raw model scores 1–100, higher is healthier). Not a clinical assessment.</p>
      </header>

      {!current ? (
        <div className="sheet empty">No check-ins yet. Take a check-in and this page fills in.</div>
      ) : (
        <>
          <section className="sheet" aria-labelledby="t">
            <h2 id="t" style={{ marginBottom: 12 }}>Scores over time</h2>
            <div className="tablewrap">
              <table className="grid">
                <thead>
                  <tr>
                    <th scope="col">Signal</th>
                    {rows.map((c) => (
                      <th key={c.id} scope="col">{fmt(c.date)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {CONCERNS.map((k) => (
                    <tr key={k.key}>
                      <th scope="row" style={{ fontWeight: 400 }}>{k.label}</th>
                      {rows.map((c) => (
                        <td key={c.id}>{displayScore(c.scores?.[k.key]) ?? '–'}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="fine" style={{ marginTop: 8 }}>Ahead treats changes under 6 raw points as photo-to-photo variation.</p>
          </section>

          {shown.length > 0 && (
            <section aria-labelledby="n">
              <h2 id="n" style={{ marginBottom: 12 }}>What I’ve noticed</h2>
              {shown.map((n) => (
                <NoteCard key={n.id} note={n} />
              ))}
            </section>
          )}

          {questions.length > 0 && (
            <section className="sheet" aria-labelledby="q">
              <h2 id="q" style={{ marginBottom: 12 }}>My questions</h2>
              <ol className="list-plain">
                {questions.map((q) => (
                  <li key={q}>{q}</li>
                ))}
              </ol>
            </section>
          )}

          {current.photo && (
            <section className="sheet" aria-labelledby="ph">
              <h2 id="ph" style={{ marginBottom: 12 }}>Latest photo ({fmt(current.date)})</h2>
              <img src={current.photo} alt="Latest check-in" style={{ maxWidth: 240, borderRadius: 12 }} />
            </section>
          )}
        </>
      )}

      <section className="sheet tint">
        <h3>Safety signs I know to call about</h3>
        <ul className="list-plain small" style={{ marginTop: 8 }}>
          {RED_FLAGS.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}
