import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useStore } from '../lib/store.jsx';
import { api } from '../lib/api.js';
import { db, newId, today } from '../lib/db.js';
import { loadImage, cropToJpeg } from '../lib/image.js';
import { TopBar, Capture, Steps, ErrorBox, CompareSlider, Icon } from '../components.jsx';
import { browPatternFor, FACE_SHAPE_TIPS, LASH_STYLES, LIP_SHADES } from '../../../core/brows.js';
import { BROW_PRODUCTS } from '../../../core/catalog.js';
import { closest } from '../../../core/color.js';

// Upload each photo once per session and reuse its YouCam file id.
const fileIds = new Map();
async function fileIdFor(key, dataUrl) {
  if (fileIds.has(key)) return fileIds.get(key);
  const blob = await (await fetch(dataUrl)).blob();
  const { fileId } = await api.upload(blob);
  fileIds.set(key, fileId);
  return fileId;
}
// YouCam reports a file it has lost or never fully received as one of these.
const REUPLOAD = new Set(['InvalidFileId', 'unknown_internal_error', 'error_download_image']);
/**
 * Runs fn with a file id per photo ({ key, dataUrl, ref }). If YouCam lost a
 * file, every photo is uploaded again and fn runs once more: at most two
 * tasks per tap. A product photo (ref) that fails to upload is reported
 * against the product photo, never as a reason to retake the portrait.
 * The server deletes each live try-on task with its photos, and a failed one
 * too, so the ids are then forgotten and the next try-on uploads afresh.
 */
async function withFiles(photos, fn) {
  const forget = () => photos.forEach((p) => fileIds.delete(p.key));
  const ids = () =>
    Promise.all(
      photos.map((p) =>
        fileIdFor(p.key, p.dataUrl).catch((err) => {
          if (p.ref && err.fix === 'photo') err.fix = 'ref';
          throw err;
        }),
      ),
    );
  const run = async () => {
    const out = await fn(...(await ids()));
    if (out?.deleted) forget();
    return out;
  };
  try {
    return await run();
  } catch (err) {
    forget();
    if (!REUPLOAD.has(err.code)) throw err;
    return run();
  }
}

const demoLabel = (label, demo) => (demo ? `${label} (demo, photo unchanged)` : label);

/**
 * When a try-on result replaces its picker, bring the comparison into view and
 * put focus on its first button (Save), so nobody is left on <body> or mid-page.
 */
function useResultFocus(result) {
  const ref = useRef(null);
  useEffect(() => {
    if (!result || !ref.current) return;
    ref.current.scrollIntoView({ block: 'start' });
    ref.current.querySelector('button')?.focus({ preventScroll: true });
  }, [result]);
  return ref;
}

function Swatch({ label, hex, name, family, note }) {
  return (
    <div className="swatch">
      <div className="chipcolor" style={{ background: hex || 'var(--tint)' }} />
      <div>
        <strong>{label}</strong>
        {family ? name || 'not read' : <>{name ? `${name}, ` : ''}{hex || 'not read'}</>}
        {note && <span className="fine" style={{ display: 'block' }}>{note}</span>}
      </div>
    </div>
  );
}

// YouCam's hair colour families, each with a typical shade for the swatch.
// YouCam only names a family (its hex is a stand-in, e.g. #000000 for Black).
const HAIR_FAMILIES = { Black: '#1f1b19', Brown: '#5a3a24', Auburn: '#7b3a22', Red: '#a5482a', Blonde: '#c9a46a', 'Grey/White': '#c9c6c1' }; // ds-allow-hardcode: hair colours, not theme colours

// Bright or flat light can fool the hair reading (a black-haired studio
// portrait came back Blonde), so the person can set it right. What YouCam
// read is kept in hair_read, and picking it again restores it.
function HairFix({ print, savePrint }) {
  const { hair_read: read, ...c } = print.colors || {};
  async function choose(name) {
    const was = read || { name: c.hair_color_name, hex: c.hair_color };
    const colors = name === was.name ? { ...c, hair_color_name: was.name, hair_color: was.hex } : { ...c, hair_color_name: name, hair_color: HAIR_FAMILIES[name], hair_read: was };
    await savePrint({ ...print, colors });
  }
  return (
    <details>
      <summary style={{ cursor: 'pointer', fontWeight: 700, color: 'var(--accent)' }}>Hair colour wrong?</summary>
      <div className="stack" style={{ marginTop: 10 }}>
        <p className="fine">Bright or flat light can fool the reading. Pick your natural colour and your fitting sheet uses it.</p>
        <div className="chips">
          {Object.keys(HAIR_FAMILIES).map((name) => (
            <button key={name} type="button" className="chip" aria-pressed={c.hair_color_name === name} onClick={() => choose(name)}>
              {name}
            </button>
          ))}
        </div>
      </div>
    </details>
  );
}

/** A shop's product photo: picked from the phone (re-encoded here) or pasted as a link. */
// Product photos are re-encoded as JPEG with the try-on's long-side cap
// (Hairstyle VTO: 1024 px). The minimum is checked on the original first, so
// a large but wide photo isn't rejected for the size it was shrunk to.
function ProductPhotoPicker({ label, hint, linkHint, photo, onPhoto, url, onUrl, minShort = 0, maxLong = 1024 }) {
  const [problem, setProblem] = useState('');
  const fileRef = useRef(null);
  const hintId = useId();
  async function pick(e) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setProblem('');
    try {
      const img = await loadImage(f);
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      if (minShort && Math.min(w, h) < minShort) {
        setProblem(`That photo is only ${w}×${h} px; at least ${minShort} px on each side is needed.`);
        return;
      }
      const j = await cropToJpeg(img, { x: 0, y: 0, w, h }, { maxLong });
      if (minShort && Math.min(j.width, j.height) < minShort) {
        setProblem(`That photo is ${w}×${h} px, too long and narrow to use. Crop it closer to the item.`);
        return;
      }
      onPhoto({ id: newId(), dataUrl: j.dataUrl });
    } catch (err) {
      setProblem(err.message);
    }
  }
  return (
    <div className="stack">
      <div className="field" role="group" aria-label={label}>
        <span>{label}</span>
        <button type="button" className="btn secondary" aria-describedby={hintId} onClick={() => fileRef.current?.click()}>
          <Icon name="upload" />
          {photo ? 'Choose another photo' : 'Add photo'}
        </button>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={pick} />
        <small id={hintId}>{hint}</small>
      </div>
      {photo && (
        <div className="row">
          <img src={photo.dataUrl} alt="Chosen product photo" style={{ width: 64, borderRadius: 10 }} />
          <button className="btn quiet small" onClick={() => onPhoto(null)}>Remove</button>
        </div>
      )}
      <label className="field">
        <span>Or paste a link to the photo</span>
        <input className="input" type="url" inputMode="url" placeholder="https://…/photo.jpg" value={url} onChange={(e) => onUrl(e.target.value.trim())} />
        <small>{linkHint || 'A direct link to a .jpg or .png.'} If it doesn’t work, save the picture and add it above.</small>
      </label>
      {problem && <div className="banner" role="alert">{problem}</div>}
    </div>
  );
}

const PRINT_STEPS = ['Uploading securely', 'Reading colours and face shape'];

/** Says which half of the last print photo couldn't be read, and why. */
function PrintGaps({ print }) {
  const halves = [
    ['colors', 'Colours (hair, brows, skin)'],
    ['face', 'Face and brow shape'],
  ].filter(([k]) => print.errors?.[k]);
  if (!halves.length) return null;
  return (
    <div className="banner" role="status">
      {halves.map(([k, label]) => {
        const e = print.errors[k];
        const when = print.kept?.[k] ? new Date(`${print.kept[k]}T12:00:00`).toLocaleDateString() : null;
        return (
          <p key={k}>
            <strong>{label} couldn’t be read from this photo.</strong> {e.message}{' '}
            {when ? `Your earlier reading from ${when} is kept.` : e.fix === 'photo' ? 'Retake to add them.' : 'Try Retake again in a moment.'}
          </p>
        );
      })}
    </div>
  );
}

function PrintSection({ retake, setRetake }) {
  const { print, savePrint } = useStore();
  const [step, setStep] = useState(-1);
  const [error, setError] = useState(null);
  const [key, setKey] = useState(0);
  const [justSaved, setJustSaved] = useState(false);

  async function onCapture(shot) {
    setError(null);
    try {
      setStep(0);
      const { fileId } = await api.upload(shot.blob);
      setStep(1);
      const result = await api.print(fileId);
      // If one half couldn't be read, keep that half from an earlier real print rather than losing it.
      const prev = print && !print.sample ? print : null;
      const colors = result.colors || prev?.colors || null;
      const face = result.face || prev?.face || null;
      const kept = { colors: !result.colors && prev?.colors ? prev.date : null, face: !result.face && prev?.face ? prev.date : null };
      const p = { date: today(), photo: shot.dataUrl, colors, face, partial: !colors || !face, errors: result.errors || null, kept, demo: Boolean(result.demo) };
      // A live print deletes its selfie on YouCam, so only a kept one is reused.
      if (!result.deleted) fileIds.set(`print:${p.date}`, fileId);
      await savePrint(p);
      setRetake(false);
      setJustSaved(true);
      setStep(-1);
    } catch (err) {
      setStep(-1);
      setError(err);
      setKey((k) => k + 1);
    }
  }

  if (!print || retake) {
    return (
      <section className="sheet stack" aria-labelledby="print" id="print-section">
        <h2 id="print" tabIndex={-1}>Your Hair & Brow Print</h2>
        <p>One clear selfie records your hair colour family, brow colour, brow shape and face shape, using YouCam’s Facial Color Tones and Face Attributes analysis. Show it to your wig specialist or brow artist, even after your hair has changed. For an exact colour match, also keep a lock of your hair.</p>
        <p className="fine">Hair down, forehead visible, face the light.</p>
        {retake && print && !print.sample && <p className="fine">A new print replaces your saved colours and shapes. To see brows on your face as it is now, keep this print and use “Take a photo of today” under Your brows, recreated.</p>}
        <p className="sr-only" role="status">{step >= 0 ? `${PRINT_STEPS[step]}…` : ''}</p>
        {step >= 0 ? (
          <Steps steps={PRINT_STEPS} at={step} />
        ) : (
          <>
            <ErrorBox error={error} />
            <Capture key={key} mode="face" maxLong={1600} onCapture={onCapture} cta="Take print photo" />
          </>
        )}
        {retake && print && <button className="btn quiet" onClick={() => setRetake(false)}>Keep my current print</button>}
      </section>
    );
  }

  const c = print.colors || {};
  const f = print.face || {};
  const tip = FACE_SHAPE_TIPS[String(f.faceShape || '').toLowerCase()];
  return (
    <section className="sheet stack" aria-labelledby="print" id="print-section">
      <div className="section-title">
        <h2 id="print" tabIndex={-1}>Your Hair & Brow Print</h2>
        <span className="fine">Saved {new Date(`${print.date}T12:00:00`).toLocaleDateString()}</span>
      </div>
      {(print.sample || print.demo) && <div className="banner info">{print.sample ? 'Sample print.' : 'Demo result: colours and shapes are placeholders until a YouCam key is configured.'}</div>}
      <PrintGaps print={print} />
      {justSaved && !print.partial && <p className="fine" role="status">Saved on this device. Your print can’t be retaken once your hair changes, so download a copy now and then from Settings.</p>}
      <div className="swatches">
        <Swatch label="Hair colour family" hex={c.hair_color} name={c.hair_color_name} family note={c.hair_read ? `Set by you. The photo read ${c.hair_read.name || 'nothing'}.` : null} />
        <Swatch label="Brows" hex={c.eyebrow_color} />
        <Swatch label="Skin" hex={c.skin_color} />
      </div>
      {!print.sample && <HairFix print={print} savePrint={savePrint} />}
      <div className="facts">
        <div className="fact"><span>Face shape</span><strong>{f.faceShape || 'Not read'}</strong></div>
        <div className="fact"><span>Brow shape</span><strong>{f.browShape || 'Not read'}</strong></div>
        <div className="fact"><span>Brow thickness</span><strong>{f.browThickness || 'Not read'}</strong></div>
        <div className="fact">
          <span>Eye colour</span>
          <strong>
            {c.eye_color && <span aria-hidden="true" className="dot" style={{ background: c.eye_color }} />}
            {c.eye_color_name || (c.eye_color ? 'Measured' : 'Not read')}
          </strong>
        </div>
      </div>
      {tip && <p className="small"><strong>Wig shape tip: </strong>{tip}</p>}
      <div className="row wrap">
        <a className="btn primary" href="#/fitting">Fitting sheet for your specialist</a>
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
      <span>
        {t.title}
        {t.keepsColor && <span className="fine" style={{ display: 'block', padding: 0 }}>Can keep your colour</span>}
      </span>
    </button>
  );
}

/** The head-and-shoulders portrait shared by wig and head-covering try-ons. */
function usePortrait() {
  const [portrait, setPortrait] = useState(null);
  useEffect(() => {
    db.get('portrait').then((p) => p && setPortrait(p));
  }, []);
  async function save(shot) {
    const p = { id: newId(), dataUrl: shot.dataUrl, width: shot.width, height: shot.height };
    await db.set('portrait', p);
    setPortrait(p);
  }
  async function clear() {
    await db.del('portrait');
    setPortrait(null);
  }
  return { portrait, save, clear };
}

function PortraitPicker({ portrait, save, clear, why }) {
  if (!portrait) {
    return (
      <>
        <p className="fine">{why} Head and shoulders in the photo, hair down. Hair already short? Upload a photo of you from before treatment instead.</p>
        <Capture mode="portrait" maxLong={1024} onCapture={save} cta="Take portrait" />
      </>
    );
  }
  return (
    <div className="row">
      <img src={portrait.dataUrl} alt="Your portrait" style={{ width: 72, borderRadius: 12 }} />
      <button className="btn quiet small" onClick={clear}>Change photo</button>
    </div>
  );
}

function WigSection({ portraitState }) {
  const { addLook } = useStore();
  const { portrait, save, clear } = portraitState;
  const [templates, setTemplates] = useState([]);
  const [showAll, setShowAll] = useState(false);
  const [chosen, setChosen] = useState(null);
  const [refPhoto, setRefPhoto] = useState(null);
  const [refUrl, setRefUrl] = useState('');
  const [keepColor, setKeepColor] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [saved, setSaved] = useState(false);
  const resultRef = useResultFocus(result);

  useEffect(() => {
    api.hairTemplates().then((r) => setTemplates(r.templates || [])).catch((err) => setError(err));
  }, []);
  // The portrait is shared with the head-covering section; a new one invalidates this try-on.
  useEffect(() => {
    setResult(null);
    setSaved(false);
  }, [portrait?.id]);

  const isRef = Boolean(refPhoto || refUrl);
  // YouCam honours hair_color only on templates with keep_users_color; a shop photo keeps its own colour.
  const colourKeepable = !isRef && chosen?.keepsColor === true;

  async function tryOn() {
    setError(null);
    setBusy(true);
    setSaved(false);
    try {
      const mine = colourKeepable && keepColor;
      const me = { key: `portrait:${portrait.id}`, dataUrl: portrait.dataUrl };
      const out = refPhoto
        ? await withFiles([me, { key: `ref:${refPhoto.id}`, dataUrl: refPhoto.dataUrl, ref: true }], (fileId, refFileId) => api.hairTryOn({ fileId, refFileId }))
        : await withFiles([me], (fileId) => api.hairTryOn({ fileId, templateId: refUrl ? null : chosen.id, refUrl: refUrl || undefined, keepColor: mine }));
      setResult({ image: out.image, demo: out.demo, label: isRef ? 'Wig from a shop photo' : chosen.title, mine });
    } catch (err) {
      setError(err);
    }
    setBusy(false);
  }

  async function saveLook() {
    if (saved) return;
    const label = `${result.label}${result.mine ? ', my colour' : ''}`;
    await addLook({ id: newId(), kind: 'hair', image: result.image, label: demoLabel(label, result.demo), createdAt: new Date().toISOString(), demo: result.demo });
    setSaved(true);
  }

  const visible = showAll ? templates : templates.slice(0, 9);
  return (
    <section className="sheet stack" aria-labelledby="wig">
      <h2 id="wig">Try wig styles on yourself</h2>
      <p>Try styles from home, at your own pace, before you visit a wig specialist or order online. Many shops won’t take a wig back once it has been worn.</p>
      <p className="sr-only" role="status">{busy ? 'Rendering your try-on…' : saved ? 'Saved to your looks.' : result ? 'Try-on ready.' : ''}</p>
      <PortraitPicker portrait={portrait} save={save} clear={clear} why="Hairstyle try-on works from one portrait photo." />
      {portrait && result && (
        <div className="stack" ref={resultRef}>
          <CompareSlider before={portrait.dataUrl} after={result.image} afterLabel={result.demo ? `${result.label} (demo)` : result.label} />
          {result.demo && <div className="banner">Demo mode: this is your photo unchanged. With a YouCam key on the server, this shows the real try-on.</div>}
          <div className="row wrap">
            <button className="btn primary" onClick={saveLook} aria-disabled={saved || undefined}>{saved ? 'Saved to your looks' : 'Save to my looks'}</button>
            <button className="btn secondary" onClick={() => setResult(null)}>Try another</button>
          </div>
        </div>
      )}
      {portrait && !result && (
        <>
          <h3>Choose a style</h3>
          <div className="styles">
            {visible.map((t) => (
              <StyleThumb
                key={t.id}
                t={t}
                pressed={chosen?.id === t.id && !isRef}
                onPress={() => {
                  setChosen(t);
                  setRefUrl('');
                  setRefPhoto(null);
                }}
              />
            ))}
          </div>
          {templates.length > 9 && <button className="btn quiet small" onClick={() => setShowAll((s) => !s)}>{showAll ? 'Show fewer' : `Show all ${templates.length} styles`}</button>}
          <ProductPhotoPicker
            label="Or try a wig from any shop: add its photo"
            hint="Save or screenshot the shop’s photo of the wig on a model facing forward. Mannequin and flat-lay photos won’t work."
            photo={refPhoto}
            onPhoto={(p) => {
              setRefPhoto(p);
              if (p) setRefUrl('');
            }}
            url={refUrl}
            onUrl={(u) => {
              setRefUrl(u);
              if (u) setRefPhoto(null);
            }}
            linkHint="A direct link to a .jpg photo, no more than 1024 px on the long side."
            minShort={320}
          />
          {colourKeepable ? (
            <label className="toggle">
              <span>
                <strong>Keep my natural colour</strong>
                <span className="fine" style={{ display: 'block' }}>Shows the cut in your own colour, the closest match to how you look now.</span>
              </span>
              <input type="checkbox" checked={keepColor} onChange={(e) => setKeepColor(e.target.checked)} />
            </label>
          ) : (
            (isRef || chosen) && <p className="fine">{isRef ? 'A shop photo shows the wig in its own colour. Compare it with the colour family in your print.' : 'This style comes in its own colour.'}</p>
          )}
          <ErrorBox error={error} onRetry={error?.fix === 'photo' ? () => clear().then(() => setError(null)) : undefined} />
          <button className="btn primary block" onClick={tryOn} disabled={busy || (!chosen && !isRef)}>
            {busy ? 'Rendering your try-on…' : 'Try it on'}
          </button>
        </>
      )}
    </section>
  );
}

function HeadwearSection({ portraitState }) {
  const { addLook } = useStore();
  const { portrait, save, clear } = portraitState;
  const [refPhoto, setRefPhoto] = useState(null);
  const [refUrl, setRefUrl] = useState('');
  const [gender, setGender] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [saved, setSaved] = useState(false);
  const resultRef = useResultFocus(result);
  const tooSmall = portrait && Math.min(portrait.width || 0, portrait.height || 0) < 512;
  // The portrait is shared with the wig section; a new one invalidates this try-on.
  useEffect(() => {
    setResult(null);
    setSaved(false);
    setError(null);
  }, [portrait?.id]);

  async function tryOn() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const me = { key: `portrait:${portrait.id}`, dataUrl: portrait.dataUrl };
      const out = refPhoto
        ? await withFiles([me, { key: `ref:${refPhoto.id}`, dataUrl: refPhoto.dataUrl, ref: true }], (fileId, refFileId) => api.hatTryOn({ fileId, refFileId, gender }))
        : await withFiles([me], (fileId) => api.hatTryOn({ fileId, refUrl, gender }));
      setResult(out);
    } catch (err) {
      setError(err);
    }
    setBusy(false);
  }

  return (
    <section className="sheet stack" aria-labelledby="hats">
      <h2 id="hats">Hats, caps and headbands</h2>
      <p>Not everyone wants a wig. Try a soft cap, beanie or sun hat from any shop, with YouCam’s hat try-on.</p>
      <p className="note">Good to know: this makes a new styled photo, not an edit of yours. YouCam changes the outfit and setting, and your face can look a little different. Use it to judge the hat’s shape and colour.</p>
      <p className="sr-only" role="status">{busy ? 'Rendering your try-on…' : saved ? 'Saved to your looks.' : result ? 'Try-on ready.' : ''}</p>
      {!portrait ? (
        <PortraitPicker portrait={portrait} save={save} clear={clear} why="Head-covering try-on uses the same portrait as wig try-on." />
      ) : result ? (
        <div className="stack" ref={resultRef}>
          <img src={result.image} alt={demoLabel('Head-covering try-on', result.demo)} style={{ width: '100%', borderRadius: 16 }} />
          <p className="fine">A new styled photo made by YouCam, so the outfit, setting and some face details differ from yours.</p>
          {result.demo && <div className="banner">Demo mode: this is your photo unchanged. With a YouCam key on the server, this shows the real try-on.</div>}
          <div className="row wrap">
            <button className="btn primary" aria-disabled={saved || undefined} onClick={async () => { if (saved) return; await addLook({ id: newId(), kind: 'headwear', image: result.image, label: demoLabel('Head covering', result.demo), createdAt: new Date().toISOString(), demo: result.demo }); setSaved(true); }}>
              {saved ? 'Saved to your looks' : 'Save to my looks'}
            </button>
            <button className="btn secondary" onClick={() => setResult(null)}>Try another</button>
          </div>
        </div>
      ) : (
        <>
          {tooSmall && <div className="banner">Head-covering try-on needs a portrait of at least 512 px on each side. Change the photo above to a sharper one.</div>}
          <ProductPhotoPicker
            label="Add a photo of the hat, cap or headband"
            hint="A shop’s product photo with just the one item, filling a good part of the picture (at least 512 × 512 px). A photo of someone wearing it needs at least 800 × 800 px."
            photo={refPhoto}
            onPhoto={(p) => {
              setRefPhoto(p);
              if (p) setRefUrl('');
            }}
            url={refUrl}
            onUrl={(u) => {
              setRefUrl(u);
              if (u) setRefPhoto(null);
            }}
            minShort={512}
            maxLong={2048}
            linkHint="A direct link to a .jpg or .png, at least 512 px on each side."
          />
          <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
            <legend style={{ fontWeight: 700, marginBottom: 8 }}>Style the preview for</legend>
            <div className="chips">
              {[
                ['female', 'Women’s styling'],
                ['male', 'Men’s styling'],
              ].map(([value, label]) => (
                <button key={value} type="button" className="chip" aria-pressed={gender === value} onClick={() => setGender(value)}>
                  {label}
                </button>
              ))}
            </div>
            <p className="fine" style={{ marginTop: 6 }}>YouCam needs this to style the outfit. Ahead never guesses it from your photo.</p>
          </fieldset>
          <ErrorBox error={error} onRetry={error?.fix === 'photo' ? clear : undefined} />
          <button className="btn primary block" onClick={tryOn} disabled={busy || tooSmall || !gender || !(refPhoto || refUrl)}>
            {busy ? 'Rendering your try-on…' : 'Try it on'}
          </button>
        </>
      )}
    </section>
  );
}

function BrowSection({ onNeedPrint }) {
  const { print, addLook, list, toggleList } = useStore();
  const [patterns, setPatterns] = useState([]);
  const suggested = browPatternFor(print?.face?.browShape);
  const [pattern, setPattern] = useState(suggested);
  const myBrows = print?.colors?.eyebrow_color || null;
  const pencils = useMemo(() => closest(BROW_PRODUCTS, myBrows), [myBrows]);
  // Which chip is chosen, not its hex: a pencil can match the measured colour exactly.
  const [colorChoice, setColorChoice] = useState(myBrows ? 'mine' : 'sb-dark-brown');
  const chosenPencil = colorChoice === 'mine' ? null : BROW_PRODUCTS.find((p) => p.id === colorChoice);
  const color = colorChoice === 'mine' ? myBrows : chosenPencil?.hex || '#3b2a20';
  const [intensity, setIntensity] = useState(55);
  // Optional extras drawn in the same 1-unit makeup-vto call.
  const [lashStyle, setLashStyle] = useState(null);
  const [underEye, setUnderEye] = useState(false);
  const [lipChoice, setLipChoice] = useState(null);
  const myLips = print?.colors?.lip_color || null;
  const skinTone = print?.colors?.skin_color || null;
  const lipColor = lipChoice === 'mine' ? myLips : LIP_SHADES.find((s) => s.id === lipChoice)?.hex || null;
  const [todayPhoto, setTodayPhoto] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.browPatterns().then((r) => setPatterns(r.patterns || [])).catch(() => {});
    db.get('browPhoto').then((p) => p && setTodayPhoto(p));
  }, []);
  useEffect(() => {
    setPattern(suggested);
    if (myBrows) setColorChoice('mine');
  }, [print?.date]);
  const resultRef = useResultFocus(result);

  if (!print) {
    return (
      <section className="sheet stack" aria-labelledby="brows">
        <h2 id="brows">Your brows, recreated</h2>
        <p>Once your print is saved, Ahead can draw your natural brow shape and colour back on, a reference for brow pencils, stencils or a brow artist if your brows thin.</p>
      </section>
    );
  }

  // Brows are drawn on a photo of today if there is one, otherwise on the print photo.
  const source = todayPhoto
    ? { key: `brow:${todayPhoto.id}`, dataUrl: todayPhoto.dataUrl, label: 'Today' }
    : print.photo
      ? { key: `print:${print.date}`, dataUrl: print.photo, label: 'At your print' }
      : null;

  async function saveTodayPhoto(shot) {
    const p = { id: newId(), date: today(), dataUrl: shot.dataUrl };
    await db.set('browPhoto', p);
    setTodayPhoto(p);
    setResult(null);
  }

  async function preview() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      // thickness 0: makeup-vto thickness is relative to the brow in the photo being rendered.
      const extras = {
        lashes: lashStyle ? { style: lashStyle } : undefined,
        underEye: underEye && skinTone ? { color: skinTone } : undefined,
        lips: lipColor ? { color: lipColor } : undefined,
      };
      const out = await withFiles([source], (fileId) => api.browTryOn({ fileId, pattern, color, intensity, thickness: 0, ...extras }));
      setResult(out);
    } catch (err) {
      setError(err);
    }
    setBusy(false);
  }

  const name = patterns.find((p) => p.label === pattern)?.name || pattern;
  const extras = [lashStyle && 'lashes', underEye && skinTone && 'under-eye', lipColor && 'lips'].filter(Boolean);
  const lookName = extras.length ? `${name}, with ${extras.length > 1 ? `${extras.slice(0, -1).join(', ')} and ${extras.at(-1)}` : extras[0]}` : name;
  const pencil = chosenPencil || BROW_PRODUCTS.find((p) => p.hex.toLowerCase() === String(myBrows || '').toLowerCase());
  return (
    <section className="sheet stack" aria-labelledby="brows">
      <h2 id="brows">Your brows, recreated</h2>
      <p>Brows and lashes can thin during chemotherapy. See your own shape and colour drawn back on with YouCam makeup try-on. Skin smoothing is switched off, so the rest of your face is untouched.</p>
      <p className="sr-only" role="status">{busy ? 'Drawing your brows…' : saved ? 'Saved to your looks.' : result ? 'Brow preview ready.' : ''}</p>
      {todayPhoto ? (
        <div className="row">
          <img src={todayPhoto.dataUrl} alt="Your photo for brow preview" style={{ width: 72, borderRadius: 12 }} />
          <span className="fine" style={{ flex: 1 }}>Brows are drawn on this photo, using the colour and shape saved in your print.</span>
          <button className="btn quiet small" onClick={() => db.del('browPhoto').then(() => { setTodayPhoto(null); setResult(null); })}>Change</button>
        </div>
      ) : (
        <details>
          <summary style={{ cursor: 'pointer', fontWeight: 700, color: 'var(--accent)' }}>{print.sample ? 'Take a photo of today to preview brows' : 'Brows already thinning? Use a photo of today'}</summary>
          <div className="stack" style={{ marginTop: 10 }}>
            <p className="fine">Your saved print stays as it is; only the face the brows are drawn on changes.</p>
            <Capture mode="face" maxLong={1600} onCapture={saveTodayPhoto} cta="Take a photo of today" />
          </div>
        </details>
      )}
      {result ? (
        <div className="stack" ref={resultRef}>
          <CompareSlider before={source.dataUrl} after={result.image} beforeLabel={source.label} afterLabel={result.demo ? `${extras.length ? 'Preview' : name} (demo)` : extras.length ? 'Preview' : name} />
          {result.demo && <div className="banner">Demo mode: this is your photo unchanged. With a YouCam key on the server, this draws the brows{extras.length ? ` and ${extras.length > 1 ? 'extras' : extras[0]}` : ''}.</div>}
          <div className="row wrap">
            <button className="btn primary" aria-disabled={saved || undefined} onClick={async () => { if (saved) return; await addLook({ id: newId(), kind: 'brows', image: result.image, label: demoLabel(`Brows: ${lookName}`, result.demo), createdAt: new Date().toISOString(), demo: result.demo }); setSaved(true); }}>
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
                <button key={p.label} type="button" className="chip" aria-pressed={pattern === p.label} onClick={() => setPattern(p.label)}>
                  {p.name}
                  {p.label === suggested ? ' (closest to yours)' : ''}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
            <legend style={{ fontWeight: 700, marginBottom: 8 }}>Colour</legend>
            <div className="chips">
              {myBrows && (
                <button type="button" className="chip" aria-pressed={colorChoice === 'mine'} onClick={() => setColorChoice('mine')}>
                  <span aria-hidden="true" className="chip-dot" style={{ background: myBrows }} />
                  My brows
                </button>
              )}
              {pencils.map(({ item, dE }, i) => (
                <button key={item.id} type="button" className="chip" aria-pressed={colorChoice === item.id} onClick={() => setColorChoice(item.id)}>
                  <span aria-hidden="true" className="chip-dot" style={{ background: item.hex }} />
                  {item.name.replace('Brow Pencil, ', '')}
                  {myBrows && i === 0 ? ' (closest pencil)' : ''}
                  {dE !== null && <span className="sr-only">, colour difference {dE.toFixed(1)}</span>}
                </button>
              ))}
            </div>
            {myBrows && pencils[0] && (
              <p className="fine" style={{ marginTop: 6 }}>
                Closest pencil to your measured brow colour: {pencils[0].item.name} (colour difference ΔE {pencils[0].dE.toFixed(1)}; under about 3 is hard to tell apart).
              </p>
            )}
          </fieldset>
          <label className="field">
            <span>Strength: {intensity}%</span>
            <input type="range" min="20" max="90" value={intensity} onChange={(e) => setIntensity(Number(e.target.value))} />
          </label>
          {pencil && (
            <button type="button" className="btn small secondary" onClick={() => toggleList(pencil.id)}>
              {list.includes(pencil.id) ? `${pencil.name} is on my list` : `Add ${pencil.name} ($${pencil.price}) to my list`}
            </button>
          )}
          <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
            <legend style={{ fontWeight: 700, marginBottom: 4 }}>Lashes, under-eye and lips</legend>
            <div className="stack">
              <p className="fine">Optional. They go into the same preview at no extra cost.</p>
              <div className="field" role="group" aria-label="Lashes">
                <span>Lashes</span>
                <div className="chips">
                  {[{ label: null, name: 'None' }, ...LASH_STYLES].map((s) => (
                    <button key={s.name} type="button" className="chip" aria-pressed={lashStyle === s.label} onClick={() => setLashStyle(s.label)}>
                      {s.name}
                    </button>
                  ))}
                </div>
              </div>
              {skinTone && (
                <label className="toggle">
                  <span>
                    <strong>Soften under-eye shadows</strong>
                    <span className="fine" style={{ display: 'block' }}>A light concealer in your measured skin tone.</span>
                  </span>
                  <input type="checkbox" checked={underEye} onChange={(e) => setUnderEye(e.target.checked)} />
                </label>
              )}
              <div className="field" role="group" aria-label="Lip colour">
                <span>Lip colour</span>
                <div className="chips">
                  <button type="button" className="chip" aria-pressed={lipChoice === null} onClick={() => setLipChoice(null)}>None</button>
                  {myLips && (
                    <button type="button" className="chip" aria-pressed={lipChoice === 'mine'} onClick={() => setLipChoice('mine')}>
                      <span aria-hidden="true" className="chip-dot" style={{ background: myLips }} />
                      My lips
                    </button>
                  )}
                  {LIP_SHADES.map((s) => (
                    <button key={s.id} type="button" className="chip" aria-pressed={lipChoice === s.id} onClick={() => setLipChoice(s.id)}>
                      <span aria-hidden="true" className="chip-dot" style={{ background: s.hex }} />
                      {s.name}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </fieldset>
          <ErrorBox error={error} />
          {source ? (
            <button className="btn primary block" onClick={preview} disabled={busy}>{busy ? 'Drawing your brows…' : 'Preview my brows'}</button>
          ) : (
            <button className="btn primary block" onClick={onNeedPrint}>Take my print selfie to preview brows</button>
          )}
        </>
      )}
    </section>
  );
}

const LETTER = (name) => `To my oncology team,

I am starting a treatment that is expected to cause hair loss. Please could you write me a prescription for a "cranial prosthesis" for hair loss due to cancer treatment, so I can claim it through my health insurance or my HSA/FSA.

Many insurers process this under HCPCS code A9282 together with the diagnosis code for my hair loss.

Thank you,
${name || '[your name]'}`;

function InsuranceHelp() {
  const { profile } = useStore();
  const [copied, setCopied] = useState(false);
  return (
    <details className="sheet">
      <summary style={{ cursor: 'pointer', fontWeight: 700 }}>Paying for a wig</summary>
      <div className="stack" style={{ marginTop: 12 }}>
        <ul className="list-plain small">
          <li>Some health plans in the US cover a wig as a “cranial prosthesis” when your doctor prescribes it. The word “wig” on a prescription is often rejected.</li>
          <li>Ask your insurer whether they cover it, how much (limits are often a few hundred dollars a year), and whether you pay first and claim back.</li>
          <li>Original Medicare (Parts A and B) doesn’t pay for wigs, even with a prescription. Some Medicare Advantage plans include a wig allowance, so check your plan’s benefits.</li>
          <li>With an HSA or FSA you can usually pay for a wig your doctor advises for hair loss from cancer treatment. Keep the prescription and the receipt. In the US it can also count as a medical expense on your taxes if you itemize (IRS Publication 502).</li>
          <li>Cancer charities and some treatment centres offer free or low-cost wigs and head coverings. Ask your nurse navigator or social worker.</li>
        </ul>
        <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', background: 'var(--tint)', padding: 14, borderRadius: 12, margin: 0 }}>{LETTER(profile?.name)}</pre>
        <button className="btn secondary" onClick={() => navigator.clipboard?.writeText(LETTER(profile?.name)).then(() => setCopied(true))}>{copied ? 'Copied' : 'Copy request'}</button>
        <p className="fine">Coverage varies widely by plan and country. This is not insurance, tax or legal advice.</p>
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
  const [retakePrint, setRetakePrint] = useState(false);
  const portraitState = usePortrait();

  function needPrint() {
    setRetakePrint(true);
    requestAnimationFrame(() => {
      document.getElementById('print-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      document.getElementById('print')?.focus({ preventScroll: true });
    });
  }

  return (
    <div className="stack-lg">
      <TopBar mode={server.mode} />
      <div className="stack">
        <h1>Hair & brows</h1>
        <p className="muted">Keep your own look on record, and try on what comes next.</p>
      </div>
      <PrintSection retake={retakePrint} setRetake={setRetakePrint} />
      <WigSection portraitState={portraitState} />
      <BrowSection onNeedPrint={needPrint} />
      <HeadwearSection portraitState={portraitState} />
      <Gallery />
      <InsuranceHelp />
    </div>
  );
}
