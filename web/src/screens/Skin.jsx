import { useStore } from '../lib/store.jsx';
import { TopBar, Icon, Sparkline } from '../components.jsx';
import { CONCERNS, displayScore } from '../../../core/concerns.js';
import { treatmentPhase } from '../../../core/treatments.js';
import { sameSeries } from '../../../core/trends.js';

const fmt = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });

export default function Skin() {
  const { checkins, profile, server } = useStore();
  const list = [...checkins].reverse();
  const real = checkins.filter((c) => !c.sample);
  const latest = (real.length ? real : checkins)[(real.length ? real : checkins).length - 1];
  const sameTier = latest ? checkins.filter((c) => sameSeries(c, latest)) : [];

  return (
    <div className="stack-lg">
      <TopBar mode={server.mode} />
      <div className="stack">
        <h1>Skin check-ins</h1>
        <p className="muted">Once a week, or whenever something changes. Each photo is scored on eight signals by YouCam AI Skin Analysis and compared with your baseline.</p>
        <a className="btn primary block" href="#/checkin">
          <Icon name="camera" />
          Start a check-in
        </a>
      </div>

      {sameTier.length >= 2 && (
        <section className="sheet">
          <div className="section-title">
            <h2>Trends</h2>
            <span className="fine">{sameTier.length} check-ins</span>
          </div>
          <div className="stack">
            {CONCERNS.map((c) => {
              const values = sameTier.map((x) => x.scores?.[c.key]?.raw ?? x.scores?.[c.key]?.ui ?? null);
              const lastScore = displayScore(sameTier[sameTier.length - 1].scores?.[c.key]);
              return (
                <div key={c.key} className="row spread">
                  <span>{c.label}</span>
                  <span className="row">
                    <Sparkline values={values} />
                    <strong style={{ width: 32, textAlign: 'right' }}>{lastScore ?? '–'}</strong>
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section aria-labelledby="hist">
        <h2 id="hist" style={{ marginBottom: 12 }}>History</h2>
        {list.length === 0 ? (
          <div className="sheet empty stack">
            <p>No check-ins yet. Your first one becomes the baseline that all later photos are compared with.</p>
          </div>
        ) : (
          <div className="history">
            {list.map((c) => {
              const p = treatmentPhase(profile.startDate, new Date(`${c.date}T12:00:00`));
              return (
                <a key={c.id} href={`#/result/${c.id}`}>
                  {c.photo ? <img src={c.photo} alt="" /> : <span className="thumb" aria-hidden="true" />}
                  <span>
                    <strong>{fmt(c.date)}</strong>
                    <span className="fine" style={{ display: 'block' }}>
                      {p.phase === 'before' ? 'Before treatment' : `Week ${p.week}`}
                      {c.sample ? ', sample data' : c.demo ? ', demo result' : ''}
                    </span>
                  </span>
                  <span className="fine">{c.tier === 'hd' ? 'HD' : 'SD'}</span>
                </a>
              );
            })}
          </div>
        )}
      </section>

      <section className="sheet tint stack">
        <h3>Getting reliable readings</h3>
        <ul className="list-plain small">
          <li>Same place, same time of day, facing the same window or lamp.</li>
          <li>Clean face: no makeup, glasses off, hair back from your forehead.</li>
          <li>Look straight at the camera with a neutral face.</li>
          <li>A sharp photo from your phone’s camera app gives HD analysis (at least 1080 px wide after framing). Webcams usually give SD. Ahead only compares like with like.</li>
        </ul>
      </section>
    </div>
  );
}
