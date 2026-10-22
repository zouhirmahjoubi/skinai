import { useStore, useInsights } from '../lib/store.jsx';
import { TopBar, Icon, NoteCard } from '../components.jsx';
import { CONCERNS, displayScore } from '../../../core/concerns.js';
import { TREATMENTS, treatmentPhase, RED_FLAGS } from '../../../core/treatments.js';
import { questionsFor } from '../../../core/insights.js';
import { sameSeries } from '../../../core/trends.js';
import { CATALOG, PRODUCT_BY_ID } from '../../../core/catalog.js';
import { shelfContext, rankShelf } from '../../../core/ingredients.js';

const fmt = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

export default function Report() {
  const { profile, checkins, server, list = [] } = useStore();
  const { current, notes } = useInsights();
  const rows = current ? checkins.filter((c) => sameSeries(c, current)).slice(-6) : [];
  const phase = treatmentPhase(profile.startDate);
  const questions = questionsFor(notes, { treatments: profile.treatments || [], phase });
  const ctx = shelfContext(profile, notes);
  const planned = rankShelf(CATALOG.filter((p) => list.includes(p.id)), ctx);
  const pencils = list.map((id) => PRODUCT_BY_ID[id]).filter((p) => p && p.hex);
  const shown = notes.filter((n) => n.level !== 'good' && n.id !== 'baseline');

  return (
    <div className="stack-lg">
      <TopBar back="#/today" mode={server.mode} right={<button className="btn secondary small no-print" onClick={() => window.print()}><Icon name="print" />Print or save PDF</button>} />
      <header className="stack">
        <h1>Skin summary for my care team</h1>
        <p>
          {profile.name ? `${profile.name}. ` : ''}
          {(profile.treatments || []).map((t) => TREATMENTS[t].noun).join(' and ').replace(/^./, (c) => c.toUpperCase()) || 'Treatment not specified'}
          {profile.startDate ? `; started ${new Date(`${profile.startDate}T12:00:00`).toLocaleDateString()}` : ''}
          {phase.phase === 'during' ? ` (week ${phase.week})` : ''}. Prepared {new Date().toLocaleDateString()}.
        </p>
        <p className="fine">Self-tracked with the Ahead app using YouCam AI Skin Analysis photos (raw model scores 1–100, higher is healthier). Not a clinical assessment.</p>
      </header>

      {!current ? (
        <div className="sheet empty">No check-ins yet. Take a check-in and your scores and notes fill in here.</div>
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
        </>
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

      {current?.photo && (
        <section className="sheet" aria-labelledby="ph">
          <h2 id="ph" style={{ marginBottom: 12 }}>Latest photo ({fmt(current.date)})</h2>
          <img src={current.photo} alt="Latest check-in" style={{ maxWidth: 240, borderRadius: 12 }} />
        </section>
      )}

      {(planned.length > 0 || pencils.length > 0) && (
        <section className="sheet" aria-labelledby="pl">
          <h2 id="pl" style={{ marginBottom: 12 }}>Products I plan to use: are these OK?</h2>
          <ul className="list-plain small">
            {planned.map(({ product, verdict, reasons }) => (
              <li key={product.id}>
                <strong>{product.name}</strong> ({product.line}). Ingredients: {product.ingredients}.
                {verdict !== 'good' && <em> Ahead flags: {reasons.filter((r) => r.type !== 'good').map((r) => r.text).join('; ')}.</em>}
              </li>
            ))}
            {pencils.map((p) => (
              <li key={p.id}>
                <span className="dot" style={{ background: p.hex }} aria-hidden="true" />
                <strong>{p.name}</strong> ({p.line}), for drawing in thinning brows.
              </li>
            ))}
          </ul>
        </section>
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
