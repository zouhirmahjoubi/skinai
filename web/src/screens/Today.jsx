import { useState } from 'react';
import { useStore, useInsights } from '../lib/store.jsx';
import { TopBar, RoadAhead, NoteCard, Icon } from '../components.jsx';
import { TREATMENTS, treatmentPhase, expectationsFor, RED_FLAGS } from '../../../core/treatments.js';
import { hasAccessCode } from '../lib/api.js';

const fmt = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

function daysSince(iso) {
  return Math.floor((Date.now() - new Date(`${iso}T12:00:00`).getTime()) / 86400000);
}

export default function Today() {
  const { profile, checkins, print, server } = useStore();
  const { current, notes } = useInsights();
  const [openExp, setOpenExp] = useState(null);
  const phase = treatmentPhase(profile.startDate);
  const treatments = profile.treatments || [];
  const expectations = expectationsFor(treatments, profile.startDate).filter((e) => e.timing !== 'later' || phase.phase === 'before');
  const last = checkins[checkins.length - 1];
  const due = !last || daysSince(last.date) >= 6;
  const urgent = notes.filter((n) => n.level === 'call' || n.level === 'watch');
  const losesHair = treatments.includes('chemo');

  const headline = phase.phase === 'before' ? (phase.daysUntil === 1 ? 'Treatment starts tomorrow' : `Treatment starts in ${phase.daysUntil} days`) : `Week ${phase.week}`;
  const nouns = treatments.map((t) => TREATMENTS[t].noun);
  const treatmentList = nouns.length ? `${nouns.slice(0, -1).join(', ')}${nouns.length > 1 ? ' and ' : ''}${nouns[nouns.length - 1]}`.replace(/^./, (c) => c.toUpperCase()) : 'No treatment type chosen';

  return (
    <div className="stack-lg">
      <TopBar
        mode={server.mode}
        right={
          <a className="icon-btn" href="#/settings" aria-label="Settings">
            <Icon name="settings" />
          </a>
        }
      />

      {server.accessCodeRequired && !hasAccessCode() && (
        <div className="banner info">
          This demo needs an access code before it can analyse photos. <a href="#/settings">Enter the code</a>; it’s in the project’s testing instructions.
        </div>
      )}

      <section className="stack" aria-labelledby="where">
        <div>
          {profile.name && <p className="muted">Hi {profile.name}</p>}
          <h1 id="where" className="hero-week">{headline}</h1>
          <p className="muted" style={{ marginTop: 8 }}>
            {treatmentList}
            {phase.phase === 'during' ? `, since ${fmt(profile.startDate)}` : `, from ${fmt(profile.startDate)}`}
          </p>
        </div>
        <RoadAhead profile={profile} checkins={checkins} />
        <p className="road-caption">Filled dots are your check-ins. Bars show when side effects commonly appear with your treatments; everyone is different.</p>
      </section>

      <section className="sheet stack">
        {phase.phase === 'before' && !last ? (
          <>
            <h2>Take your baseline before treatment starts</h2>
            <p>A photo of your skin today is the reference every later check-in is compared with. It takes about a minute.</p>
          </>
        ) : due ? (
          <>
            <h2>{last ? 'Your weekly check-in is due' : 'Take your first check-in'}</h2>
            <p>{last ? `Last one was ${daysSince(last.date)} days ago.` : 'This becomes your baseline.'} Same spot, same light, no makeup.</p>
          </>
        ) : (
          <>
            <h2>You’re up to date</h2>
            <p>Next check-in around {fmt(new Date(new Date(`${last.date}T12:00:00`).getTime() + 7 * 86400000).toISOString().slice(0, 10))}. Check in sooner if your skin changes.</p>
          </>
        )}
        <a className={`btn ${due ? 'primary' : 'secondary'} block`} href="#/checkin">
          <Icon name="camera" />
          {last ? 'Start a check-in' : 'Take baseline photo'}
        </a>
      </section>

      {current && urgent.length > 0 && (
        <section aria-labelledby="latest">
          <div className="section-title">
            <h2 id="latest">From your last check-in</h2>
            <a href={`#/result/${current.id}`}>Details</a>
          </div>
          {urgent.slice(0, 2).map((n) => (
            <NoteCard key={n.id} note={n} />
          ))}
          <a className="btn secondary block" style={{ marginTop: 12 }} href="#/shelf">See what to use and avoid</a>
        </section>
      )}

      {losesHair && !print && (
        <section className="sheet tint stack">
          <h2>Save your hair and brows while they’re yours</h2>
          <p>Wig specialists suggest choosing a wig before hair changes, so it can be matched to your colour and style. One selfie records your hair colour, brow shape and face shape.</p>
          <a className="btn primary block" href="#/look">Make my Hair & Brow Print</a>
        </section>
      )}

      {expectations.length > 0 && (
        <section aria-labelledby="common">
          <div className="section-title">
            <h2 id="common">{phase.phase === 'before' ? 'What to expect' : 'Common around now'}</h2>
          </div>
          <div className="stack">
            {expectations.slice(0, 5).map((e) => (
              <div key={e.id} className="sheet">
                <button className="row spread" style={{ width: '100%', background: 'none', border: 0, padding: 0, cursor: 'pointer', textAlign: 'left' }} aria-expanded={openExp === e.id} onClick={() => setOpenExp(openExp === e.id ? null : e.id)}>
                  <span>
                    <h3>{e.title}</h3>
                    <span className="fine">
                      {e.treatmentLabel}
                      {e.timing === 'soon' ? ', often starts next week' : ''}
                    </span>
                  </span>
                  <span aria-hidden="true" style={{ fontSize: 22, color: 'var(--accent)' }}>{openExp === e.id ? '−' : '+'}</span>
                </button>
                {openExp === e.id && (
                  <div className="stack" style={{ marginTop: 10 }}>
                    <p>{e.body}</p>
                    {e.careTeam && <p className="small"><strong>Care team: </strong>{e.careTeam}</p>}
                    {e.action && <a className="btn secondary small" href={`#/${e.action.to}`}>{e.action.label}</a>}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="sheet stack">
        <div className="row spread">
          <h2>Care-team summary</h2>
        </div>
        <p>Your scores, notes and questions on one page, ready to show or print at your next appointment.</p>
        <a className="btn secondary block" href="#/report">
          <Icon name="print" />
          Open summary
        </a>
      </section>

      <details className="sheet">
        <summary style={{ cursor: 'pointer', fontWeight: 700 }}>
          <span style={{ color: 'var(--call)' }}>Call your care team now if you notice…</span>
        </summary>
        <ul className="list-plain" style={{ marginTop: 12 }}>
          {RED_FLAGS.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
        <p className="fine" style={{ marginTop: 10 }}>Don’t wait for a check-in. Use the number your treatment centre gave you; in an emergency call your local emergency number.</p>
      </details>
    </div>
  );
}
