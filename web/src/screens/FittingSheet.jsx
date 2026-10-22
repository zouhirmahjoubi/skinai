import { useStore } from '../lib/store.jsx';
import { TopBar, Icon } from '../components.jsx';
import { FACE_SHAPE_TIPS } from '../../../core/brows.js';

export default function FittingSheet() {
  const { print, looks, profile, server } = useStore();
  if (!print) {
    return (
      <div className="stack-lg">
        <TopBar back="#/look" mode={server.mode} />
        <div className="sheet empty stack">
          <p>Make your Hair & Brow Print first; the fitting sheet is built from it.</p>
          <a className="btn primary" href="#/look">Go to Hair & brows</a>
        </div>
      </div>
    );
  }
  const c = print.colors || {};
  const f = print.face || {};
  const hairLooks = looks.filter((l) => l.kind === 'hair').slice(0, 6);
  const brow = looks.find((l) => l.kind === 'brows');

  return (
    <div className="stack-lg">
      <TopBar back="#/look" mode={server.mode} right={<button className="btn secondary small no-print" onClick={() => window.print()}><Icon name="print" />Print</button>} />
      <header className="stack">
        <h1>Wig and brow fitting sheet</h1>
        <p>{profile.name ? `For ${profile.name}. ` : ''}My natural hair and brows, recorded {new Date(`${print.date}T12:00:00`).toLocaleDateString()} before treatment changes.</p>
      </header>
      <section className="sheet stack">
        <div className="row wrap" style={{ alignItems: 'flex-start', gap: 16 }}>
          {print.photo && <img src={print.photo} alt="Reference selfie" style={{ width: 140, borderRadius: 14 }} />}
          <table className="grid" style={{ flex: '1 1 220px' }}>
            <tbody>
              <tr><th scope="row">Hair colour</th><td><span style={{ display: 'inline-block', width: 14, height: 14, borderRadius: 7, background: c.hair_color, verticalAlign: -2, marginRight: 6 }} />{c.hair_color_name || ''} {c.hair_color}</td></tr>
              <tr><th scope="row">Brow colour</th><td><span style={{ display: 'inline-block', width: 14, height: 14, borderRadius: 7, background: c.eyebrow_color, verticalAlign: -2, marginRight: 6 }} />{c.eyebrow_color}</td></tr>
              <tr><th scope="row">Skin tone</th><td><span style={{ display: 'inline-block', width: 14, height: 14, borderRadius: 7, background: c.skin_color, verticalAlign: -2, marginRight: 6 }} />{c.skin_color}</td></tr>
              <tr><th scope="row">Face shape</th><td>{f.faceShape || '–'}</td></tr>
              <tr><th scope="row">Brow shape</th><td>{f.browShape || '–'}</td></tr>
              <tr><th scope="row">Brow thickness</th><td>{f.browThickness || '–'}</td></tr>
            </tbody>
          </table>
        </div>
        {FACE_SHAPE_TIPS[String(f.faceShape || '').toLowerCase()] && <p className="small">{FACE_SHAPE_TIPS[String(f.faceShape).toLowerCase()]}</p>}
        <p className="fine">Colours were measured from a photo by YouCam’s AI Facial Color Tones Analyzer and shift with lighting, so match against real hair samples in daylight.</p>
      </section>
      {hairLooks.length > 0 && (
        <section className="sheet">
          <h2 style={{ marginBottom: 12 }}>Styles I liked</h2>
          <div className="gallery">
            {hairLooks.map((l) => (
              <figure key={l.id}>
                <img src={l.image} alt={l.label} />
                <figcaption>{l.label}</figcaption>
              </figure>
            ))}
          </div>
        </section>
      )}
      {brow && (
        <section className="sheet">
          <h2 style={{ marginBottom: 12 }}>Brow reference</h2>
          <img src={brow.image} alt={brow.label} style={{ maxWidth: 260, borderRadius: 12 }} />
        </section>
      )}
      <section className="sheet tint small">
        <strong>Comfort notes for treatment: </strong>
        a scalp may feel tender during chemotherapy. Ask about soft-lined, lightweight caps such as monofilament or hand-tied tops, and an adjustable cap size, since head size changes as hair is lost.
      </section>
    </div>
  );
}
