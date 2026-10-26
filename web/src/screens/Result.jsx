import { useState } from 'react';
import { useStore, useInsights, go } from '../lib/store.jsx';
import { TopBar, NoteCard, ScoreRow, RedFlags } from '../components.jsx';
import { CONCERN_BY_KEY } from '../../../core/concerns.js';
import { treatmentPhase } from '../../../core/treatments.js';

const fmt = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });

export default function Result({ param }) {
  const { profile, deleteCheckin, server } = useStore();
  const { current, comparison, notes } = useInsights(param);
  const [selected, setSelected] = useState(null);

  if (!current) {
    return (
      <div className="stack-lg">
        <TopBar back="#/skin" mode={server.mode} />
        <div className="sheet empty">This check-in no longer exists.</div>
      </div>
    );
  }

  const phase = treatmentPhase(profile.startDate, new Date(`${current.date}T12:00:00`));
  const mask = selected ? current.scores?.[selected]?.mask : null;
  const base = mask && current.baseImage ? current.baseImage : current.photo;
  const hasMasks = Object.values(current.scores || {}).some((s) => s?.mask);
  const hasCall = notes.some((n) => n.level === 'call' || n.confirm);

  async function remove() {
    if (!window.confirm('Delete this check-in from your journal?')) return;
    await deleteCheckin(current.id);
    go('/skin');
  }

  return (
    <div className="stack-lg">
      <TopBar back="#/skin" mode={server.mode} />
      <div className="stack">
        <p className="muted">{phase.phase === 'before' ? 'Before treatment' : `Week ${phase.week}`}, {current.tier === 'hd' ? 'HD' : 'standard'} analysis</p>
        <h1>{fmt(current.date)}</h1>
        {current.sample && <div className="banner info">Sample journey: these scores are illustrative, not a real person’s.</div>}
        {current.demo && <div className="banner">Demo result: this server has no YouCam API key, so scores are simulated.</div>}
      </div>

      <section aria-labelledby="notes">
        <h2 id="notes" className="sr-only">What this means</h2>
        {notes.map((n) => (
          <NoteCard key={n.id} note={n} />
        ))}
        {hasCall && <RedFlags style={{ marginTop: 12 }} />}
        {/* When the note says to tell the care team, the summary for them is the main action. */}
        <div className="row wrap" style={{ marginTop: 12 }}>
          {hasCall && <a className="btn primary" href="#/report">Care-team summary</a>}
          <a className={`btn ${hasCall ? 'secondary' : 'primary'}`} href="#/shelf">What to use and avoid</a>
          {!hasCall && <a className="btn secondary" href="#/report">Care-team summary</a>}
        </div>
      </section>

      {(current.photo || current.baseImage) && (
        <section className="stack" aria-labelledby="photo">
          <h2 id="photo">Your photo</h2>
          <div className="photo">
            <img src={base} alt="Check-in photo" />
            {mask && <img className="mask" src={mask} alt={`${CONCERN_BY_KEY[selected].label} areas highlighted`} />}
            {hasMasks && <div className="photo-caption">{selected ? `Showing where ${CONCERN_BY_KEY[selected].label.toLowerCase()} was measured. Tap it again to hide.` : 'Tap a score below to see where it was measured.'}</div>}
          </div>
        </section>
      )}

      <section aria-labelledby="scores">
        <div className="section-title">
          <h2 id="scores">Scores</h2>
          <span className="fine">Higher is healthier</span>
        </div>
        <div className="scores">
          {comparison.rows.map((r) => (
            <ScoreRow key={r.key} row={r} pressed={selected === r.key} onPress={hasMasks ? () => setSelected(selected === r.key ? null : r.key) : undefined} />
          ))}
        </div>
        <p className="fine" style={{ marginTop: 10 }}>
          These are YouCam’s raw model scores, which show change more faithfully than its rounded-up display scores. Changes smaller than 6 points are within normal photo-to-photo variation and show as steady.
          {comparison.baseline ? ` Compared with your baseline from ${new Date(`${comparison.baseline.date}T12:00:00`).toLocaleDateString()}.` : ''}
        </p>
        {current.deletedFromYouCam && <p className="fine">YouCam was asked to delete this photo and its results after analysis; your copy stays on this device.</p>}
      </section>

      <button className="btn quiet" onClick={remove}>Delete this check-in</button>
    </div>
  );
}
