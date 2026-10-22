import { useEffect, useState } from 'react';
import { useStore } from '../lib/store.jsx';
import { api } from '../lib/api.js';
import { db, newId, today } from '../lib/db.js';
import { TopBar, Capture, Steps, ErrorBox, CompareSlider } from '../components.jsx';
import { browPatternFor, browThicknessFor, FACE_SHAPE_TIPS } from '../../../core/brows.js';

// Upload each photo once per session and reuse its YouCam file id.
const fileIds = new Map();
async function fileIdFor(key, dataUrl) {
  if (fileIds.has(key)) return fileIds.get(key);
  const blob = await (await fetch(dataUrl)).blob();
  const { fileId } = await api.upload(blob);
  fileIds.set(key, fileId);
  return fileId;
}
async function withFile(key, dataUrl, fn) {
  try {
    return await fn(await fileIdFor(key, dataUrl));
  } catch (err) {
    if (err.code !== 'InvalidFileId' && err.code !== 'unknown_internal_error') throw err;
    fileIds.delete(key);
    return fn(await fileIdFor(key, dataUrl));
  }
}

const BROW_COLORS = [
  ['Soft black', '#2b2522'],
  ['Dark brown', '#3b2a20'],
  ['Medium brown', '#5a4030'],
  ['Taupe', '#7a6656'],
  ['Dark blonde', '#9a7d5c'],
  ['Auburn', '#6b3a2a'],
];

function Swatch({ label, hex, name }) {
  return (
    <div className="swatch">
      <div className="chipcolor" style={{ background: hex || 'var(--tint)' }} />
      <div>
        <strong>{label}</strong>
        {name ? `${name}, ` : ''}
        {hex || 'not read'}
      </div>
    </div>
  );
}

function PrintSection() {
  const { print, savePrint } = useStore();
  const [retake, setRetake] = useState(false);
  const [step, setStep] = useState(-1);
  const [error, setError] = useState(null);
  const [key, setKey] = useState(0);

  async function onCapture(shot) {
    setError(null);
    try {
      setStep(0);
      const { fileId } = await api.upload(shot.blob);
      setStep(1);
      const result = await api.print(fileId);
      const p = { date: today(), photo: shot.dataUrl, colors: result.colors, face: result.face, partial: result.partial, demo: Boolean(result.demo) };
      fileIds.set(`print:${p.date}`, fileId);
      await savePrint(p);
      setRetake(false);
      setStep(-1);
    } catch (err) {
      setStep(-1);
      setError(err);
      setKey((k) => k + 1);
    }
  }

  if (!print || retake) {
    return (
      <section className="sheet stack" aria-labelledby="print">
        <h2 id="print">Your Hair & Brow Print</h2>
        <p>One clear selfie records your natural hair colour, brow colour, brow shape and face shape, using YouCam’s facial colour and face attribute analysis. Wig specialists and brow artists can match from it, even after your hair has changed.</p>
        <p className="fine">Hair down, forehead visible, face the light.</p>
        {step >= 0 ? (
          <Steps steps={['Uploading securely', 'Reading colours and face shape']} at={step} />
        ) : (
          <>
            <ErrorBox error={error} />
            <Capture key={key} mode="face" maxLong={1600} onCapture={onCapture} cta="Take print photo" />
          </>
        )}
        {retake && <button className="btn quiet" onClick={() => setRetake(false)}>Keep my current print</button>}
      </section>
    );
  }

  const c = print.colors || {};
  const f = print.face || {};
  const tip = FACE_SHAPE_TIPS[String(f.faceShape || '').toLowerCase()];
  return (
    <section className="sheet stack" aria-labelledby="print">
      <div className="section-title">
        <h2 id="print">Your Hair & Brow Print</h2>
        <span className="fine">Saved {new Date(`${print.date}T12:00:00`).toLocaleDateString()}</span>
      </div>
      {(print.sample || print.demo) && <div className="banner info">{print.sample ? 'Sample print.' : 'Demo result: colours and shapes are placeholders until a YouCam key is configured.'}</div>}
      <div className="swatches">
        <Swatch label="Hair" hex={c.hair_color} name={c.hair_color_name} />
        <Swatch label="Brows" hex={c.eyebrow_color} />
        <Swatch label="Skin" hex={c.skin_color} />
      </div>
      <div className="facts">
        <div className="fact"><span>Face shape</span><strong>{f.faceShape || 'Not read'}</strong></div>
        <div className="fact"><span>Brow shape</span><strong>{f.browShape || 'Not read'}</strong></div>
        <div className="fact"><span>Brow thickness</span><strong>{f.browThickness || 'Not read'}</strong></div>
        <div className="fact">
          <span>Eye colour</span>
          <strong>
            {c.eye_color && <span aria-hidden="true" style={{ display: 'inline-block', width: 12, height: 12, borderRadius: 6, background: c.eye_color, marginRight: 6 }} />}
            {c.eye_color_name || (c.eye_color ? 'Measured' : 'Not read')}
          </strong>
        </div>
      </div>
      {tip && <p className="small"><strong>Wig shape tip: </strong>{tip}</p>}
      <div className="row wrap">
        <a className="btn primary" style={{ flex: 1 }} href="#/fitting">Fitting sheet for your specialist</a>
        <button className="btn secondary" onClick={() => setRetake(true)}>Retake</button>
      </div>
    </section>
  );
}

function StyleThumb({ t, pressed, onPress }) {
  return (
    <button type="button" className="style" aria-pressed={pressed} onClick={onPress}>
      {t.thumb ? (
        <img src={t.thumb} alt="" loading="lazy" />
      ) : (
        <div className="ph" aria-hidden="true">
          <svg viewBox="0 0 40 50" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M8 46c0-8 2-14 4-18M32 46c0-8-2-14-4-18M10 24C10 12 15 6 20 6s10 6 10 18" />
            <ellipse cx="20" cy="24" rx="7" ry="9" />
          </svg>
        </div>
      )}
      <span>{t.title}</span>
    </button>
  );
}

function WigSection() {
  const { addLook } = useStore();
  const [portrait, setPortrait] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [showAll, setShowAll] = useState(false);
  const [chosen, setChosen] = useState(null);
  const [refUrl, setRefUrl] = useState('');
  const [keepColor, setKeepColor] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    db.get('portrait').then((p) => p && setPortrait(p));
    api.hairTemplates().then((r) => setTemplates(r.templates || [])).catch((err) => setError(err));
  }, []);

  async function savePortrait(shot) {
    const p = { id: newId(), dataUrl: shot.dataUrl, width: shot.width, height: shot.height };
    await db.set('portrait', p);
    setPortrait(p);
    setResult(null);
  }

  async function tryOn() {
    setError(null);
    setBusy(true);
    setSaved(false);
    try {
      const out = await withFile(`portrait:${portrait.id}`, portrait.dataUrl, (fileId) =>
        api.hairTryOn({ fileId, templateId: refUrl ? null : chosen?.id, refUrl: refUrl || undefined, keepColor }),
      );
      setResult({ image: out.image, demo: out.demo, label: refUrl ? 'Wig from a shop photo' : chosen.title });
    } catch (err) {
      setError(err);
    }
    setBusy(false);
  }

  async function save() {
    await addLook({ id: newId(), kind: 'hair', image: result.image, label: `${result.label}${keepColor ? ', my colour' : ''}`, createdAt: new Date().toISOString(), demo: result.demo });
    setSaved(true);
  }

  const visible = showAll ? templates : templates.slice(0, 9);
  return (
    <section className="sheet stack" aria-labelledby="wig">
      <h2 id="wig">Try wig styles on yourself</h2>
      <p>Try styles from home, at your own pace, before you visit a wig specialist or order online. Many shops won’t take a wig back once it has been worn.</p>
      {!portrait ? (
        <>
          <p className="fine">Hairstyle try-on needs your head and shoulders in the photo, hair down.</p>
          <Capture mode="portrait" maxLong={1024} onCapture={savePortrait} cta="Take portrait" />
        </>
      ) : (
        <>
          {!result && (
            <div className="row">
              <img src={portrait.dataUrl} alt="Your portrait" style={{ width: 72, borderRadius: 12 }} />
              <button className="btn quiet small" onClick={() => db.del('portrait').then(() => setPortrait(null))}>Change photo</button>
            </div>
          )}
          {result && (
            <div className="stack">
              <CompareSlider before={portrait.dataUrl} after={result.image} afterLabel={result.label} />
              {result.demo && <div className="banner">Demo mode shows your own photo; a YouCam key on the server renders the real try-on.</div>}
              <div className="row">
                <button className="btn primary" style={{ flex: 1 }} onClick={save} disabled={saved}>{saved ? 'Saved to your looks' : 'Save to my looks'}</button>
                <button className="btn secondary" onClick={() => setResult(null)}>Try another</button>
              </div>
            </div>
          )}
          {!result && (
            <>
              <h3>Choose a style</h3>
              <div className="styles">
                {visible.map((t) => (
                  <StyleThumb key={t.id} t={t} pressed={chosen?.id === t.id && !refUrl} onPress={() => { setChosen(t); setRefUrl(''); }} />
                ))}
              </div>
              {templates.length > 9 && <button className="btn quiet small" onClick={() => setShowAll((s) => !s)}>{showAll ? 'Show fewer' : `Show all ${templates.length} styles`}</button>}
              <label className="field">
                <span>Or paste a wig photo from any shop</span>
                <input className="input" type="url" inputMode="url" placeholder="https://…/wig.jpg" value={refUrl} onChange={(e) => setRefUrl(e.target.value.trim())} />
                <small>A product photo of the wig on a model works best.</small>
              </label>
              <label className="toggle">
                <span>
                  <strong>Keep my natural colour</strong>
                  <span className="fine" style={{ display: 'block' }}>Shows the cut in your own colour, the closest match to how you look now.</span>
                </span>
                <input type="checkbox" checked={keepColor} onChange={(e) => setKeepColor(e.target.checked)} />
              </label>
              <ErrorBox error={error} />
              <button className="btn primary block" onClick={tryOn} disabled={busy || (!chosen && !refUrl)}>
                {busy ? 'Rendering your try-on…' : 'Try it on'}
              </button>
            </>
          )}
        </>
      )}
    </section>
  );
}

function BrowSection() {
  const { print, addLook } = useStore();
  const [patterns, setPatterns] = useState([]);
  const suggested = browPatternFor(print?.face?.browShape);
  const [pattern, setPattern] = useState(suggested);
  const [color, setColor] = useState(print?.colors?.eyebrow_color || '#3b2a20');
  const [intensity, setIntensity] = useState(55);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.browPatterns().then((r) => setPatterns(r.patterns || [])).catch(() => {});
  }, []);
  useEffect(() => {
    setPattern(suggested);
    if (print?.colors?.eyebrow_color) setColor(print.colors.eyebrow_color);
  }, [print?.date]);

  if (!print) {
    return (
      <section className="sheet stack" aria-labelledby="brows">
        <h2 id="brows">Your brows, recreated</h2>
        <p>Once your print is saved, Ahead can show your natural brow shape and colour drawn back on, a reference for brow pencils, stencils or a brow artist if your brows thin.</p>
      </section>
    );
  }

  async function preview() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const out = await withFile(`print:${print.date}`, print.photo, (fileId) =>
        api.browTryOn({ fileId, pattern, color, intensity, thickness: browThicknessFor(print.face?.browThickness) }),
      );
      setResult(out);
    } catch (err) {
      setError(err);
    }
    setBusy(false);
  }

  const name = patterns.find((p) => p.label === pattern)?.name || pattern;
  return (
    <section className="sheet stack" aria-labelledby="brows">
      <h2 id="brows">Your brows, recreated</h2>
      <p>Brows and lashes can thin during chemotherapy. Preview your own shape and colour drawn back on, using YouCam makeup try-on with skin smoothing switched off, so the rest of your face is untouched.</p>
      {print.sample && <div className="banner info">The sample print has no photo. Retake the print with your own selfie to preview brows.</div>}
      {result ? (
        <div className="stack">
          <CompareSlider before={print.photo} after={result.image} beforeLabel="Today" afterLabel={name} />
          {result.demo && <div className="banner">Demo mode shows your own photo; a YouCam key on the server renders the brows.</div>}
          <div className="row">
            <button className="btn primary" style={{ flex: 1 }} disabled={saved} onClick={async () => { await addLook({ id: newId(), kind: 'brows', image: result.image, label: `Brows: ${name}`, createdAt: new Date().toISOString(), demo: result.demo }); setSaved(true); }}>
              {saved ? 'Saved to your looks' : 'Save to my looks'}
            </button>
            <button className="btn secondary" onClick={() => setResult(null)}>Adjust</button>
          </div>
        </div>
      ) : (
        <>
          <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
            <legend style={{ fontWeight: 700, marginBottom: 8 }}>Shape</legend>
            <div className="chips">
              {(patterns.length ? patterns : [{ label: suggested, name: 'Natural' }]).map((p) => (
                <button key={p.label} type="button" className="chip" aria-pressed={pattern === p.label} style={pattern === p.label ? { background: 'var(--accent)', color: 'var(--accent-ink)', borderColor: 'var(--accent)' } : undefined} onClick={() => setPattern(p.label)}>
                  {p.name}{p.label === suggested ? ' (closest to yours)' : ''}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
            <legend style={{ fontWeight: 700, marginBottom: 8 }}>Colour</legend>
            <div className="chips">
              {print.colors?.eyebrow_color && (
                <button type="button" className="chip" aria-pressed={color === print.colors.eyebrow_color} onClick={() => setColor(print.colors.eyebrow_color)}>
                  <span aria-hidden="true" style={{ display: 'inline-block', width: 12, height: 12, borderRadius: 6, background: print.colors.eyebrow_color, marginRight: 6, verticalAlign: -1 }} />
                  My brows
                </button>
              )}
              {BROW_COLORS.map(([label, hex]) => (
                <button key={hex} type="button" className="chip" aria-pressed={color === hex} style={color === hex ? { borderColor: 'var(--accent)', borderWidth: 2 } : undefined} onClick={() => setColor(hex)}>
                  <span aria-hidden="true" style={{ display: 'inline-block', width: 12, height: 12, borderRadius: 6, background: hex, marginRight: 6, verticalAlign: -1 }} />
                  {label}
                </button>
              ))}
            </div>
          </fieldset>
          <label className="field">
            <span>Strength: {intensity}%</span>
            <input type="range" min="20" max="90" value={intensity} onChange={(e) => setIntensity(Number(e.target.value))} />
          </label>
          <ErrorBox error={error} />
          <button className="btn primary block" onClick={preview} disabled={busy || print.sample}>{busy ? 'Drawing your brows…' : 'Preview my brows'}</button>
        </>
      )}
    </section>
  );
}

const LETTER = (name) => `To my oncology team,

I am starting a treatment that is expected to cause hair loss. Please could you write me a prescription for a "cranial prosthesis" for hair loss due to cancer treatment, so I can claim it through my health insurance.

Many insurers process this under HCPCS code A9282 together with the diagnosis code for my hair loss.

Thank you,
${name || '[your name]'}`;

function InsuranceHelp() {
  const { profile } = useStore();
  const [copied, setCopied] = useState(false);
  return (
    <details className="sheet">
      <summary style={{ cursor: 'pointer' }}><h2 style={{ display: 'inline' }}>Paying for a wig</h2></summary>
      <div className="stack" style={{ marginTop: 12 }}>
        <ul className="list-plain small">
          <li>Some health plans in the US cover a wig as a “cranial prosthesis” when your doctor prescribes it. The word “wig” on a prescription is often rejected.</li>
          <li>Ask your insurer whether they cover it, how much (limits are often a few hundred dollars a year), and whether you pay first and claim back.</li>
          <li>Cancer charities and some treatment centres offer free or low-cost wigs and head coverings. Ask your nurse navigator or social worker.</li>
        </ul>
        <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', background: 'var(--tint)', padding: 14, borderRadius: 12, margin: 0 }}>{LETTER(profile?.name)}</pre>
        <button className="btn secondary" onClick={() => navigator.clipboard?.writeText(LETTER(profile?.name)).then(() => setCopied(true))}>{copied ? 'Copied' : 'Copy request'}</button>
        <p className="fine">Coverage varies widely by plan and country. This is not insurance or legal advice.</p>
      </div>
    </details>
  );
}

function Gallery() {
  const { looks, removeLook } = useStore();
  if (!looks.length) return null;
  return (
    <section aria-labelledby="looks">
      <h2 id="looks" style={{ marginBottom: 12 }}>My looks</h2>
      <div className="gallery">
        {looks.map((l) => (
          <figure key={l.id}>
            <img src={l.image} alt={l.label} />
            <figcaption className="row spread">
              <span>{l.label}</span>
              <button className="linkish" onClick={() => removeLook(l.id)} aria-label={`Remove ${l.label}`}>Remove</button>
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}

export default function Look() {
  const { server } = useStore();
  return (
    <div className="stack-lg">
      <TopBar mode={server.mode} />
      <div className="stack">
        <h1>Hair & brows</h1>
        <p className="muted">Keep your own look on record, and try on what comes next.</p>
      </div>
      <PrintSection />
      <WigSection />
      <BrowSection />
      <Gallery />
      <InsuranceHelp />
    </div>
  );
}
