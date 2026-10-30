import { useStore } from '../lib/store.jsx';
import { TopBar, Icon } from '../components.jsx';
import { FACE_SHAPE_TIPS } from '../../../core/brows.js';
import { PRODUCT_BY_ID } from '../../../core/catalog.js';

export default function FittingSheet() {
  const { print, looks, list, profile, server } = useStore();
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
  const hairLooks = looks.filter((l) => l.kind === 'hair' || l.kind === 'headwear').slice(0, 6);
  const brow = looks.find((l) => l.kind === 'brows');
  const pencils = list.map((id) => PRODUCT_BY_ID[id]).filter((p) => p && p.hex);
  const isDemo = Boolean(print.demo) || hairLooks.some((l) => l.demo) || Boolean(brow?.demo);
  const tip = FACE_SHAPE_TIPS[String(f.faceShape || '').toLowerCase()];

  return (
    <div className="stack-lg">
      <TopBar back="#/look" mode={server.mode} right={<button className="btn secondary small no-print" onClick={() => window.print()}><Icon name="print" />Print</button>} />
      <header className="stack">
        <h1>Wig and brow fitting sheet</h1>
        <p>{profile.name ? `For ${profile.name}. ` : ''}My natural hair and brows, recorded {new Date(`${print.date}T12:00:00`).toLocaleDateString()} before treatment changes.</p>
      </header>
      {isDemo && <div className="banner">Demo mode: this sheet uses simulated colours and face shape, and try-on images are the photo unchanged. Make it again with a YouCam key on the server before using it with a wig specialist.</div>}
      <section className="sheet stack">
        <div className="row wrap" style={{ alignItems: 'flex-start', gap: 16 }}>
          {print.photo && <img src={print.photo} alt="Reference selfie" style={{ width: 140, borderRadius: 14 }} />}
          <table className="grid" style={{ flex: '1 1 220px' }}>
            <tbody>
              <tr><th scope="row">Hair colour family</th><td>{c.hair_color_name ? `${c.hair_color_name}${c.hair_read ? ' (set by me)' : ''}` : '–'}</td></tr>
              <tr><th scope="row">Brow colour</th><td>{c.eyebrow_color ? <><span className="dot" style={{ background: c.eyebrow_color }} aria-hidden="true" />{c.eyebrow_color}</> : '–'}</td></tr>
              <tr><th scope="row">Skin tone</th><td>{c.skin_color ? <><span className="dot" style={{ background: c.skin_color }} aria-hidden="true" />{c.skin_color}</> : '–'}</td></tr>
              <tr><th scope="row">Face shape</th><td>{f.faceShape || '–'}</td></tr>
              <tr><th scope="row">Brow shape</th><td>{f.browShape || '–'}</td></tr>
              <tr><th scope="row">Brow thickness</th><td>{f.browThickness || '–'}</td></tr>
            </tbody>
          </table>
        </div>
        {tip && <p className="small">{tip}</p>}
        <p className="fine">Brow and skin colours were measured from a photo by YouCam’s AI Facial Color Tones Analyzer; hair is given as a colour family, not an exact shade. Colours shift with lighting. For an exact wig match, keep a lock of hair from the top front of your head (where it is lightest) in a sealed bag and compare wigs against it in daylight.</p>
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
      {(brow || pencils.length > 0) && (
        <section className="sheet stack">
          <h2>Brow reference</h2>
          {brow && <img src={brow.image} alt={brow.label} style={{ maxWidth: 260, borderRadius: 12 }} />}
          {pencils.map((p) => (
            <p key={p.id} className="small">
              <span className="dot" style={{ background: p.hex }} aria-hidden="true" />
              {p.name} ({p.line})
            </p>
          ))}
        </section>
      )}
      <section className="sheet tint small">
        <strong>Comfort notes for treatment: </strong>
        a scalp may feel tender during chemotherapy. Ask about soft-lined, lightweight caps such as monofilament or hand-tied tops, and an adjustable cap size, since head size changes as hair is lost.
      </section>
    </div>
  );
}
