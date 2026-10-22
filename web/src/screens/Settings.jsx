import { useEffect, useState } from 'react';
import { useStore, go } from '../lib/store.jsx';
import { api, setAccessCode } from '../lib/api.js';
import { TopBar } from '../components.jsx';
import { TREATMENTS, TREATMENT_KEYS } from '../../../core/treatments.js';

export default function Settings() {
  const { profile, saveProfile, server, resetAll, loadSample, importJournal, checkins, looks, print, list } = useStore();
  const [units, setUnits] = useState(null);
  const [svcError, setSvcError] = useState('');
  const [code, setCode] = useState('');
  const [codeMsg, setCodeMsg] = useState('');
  const [msg, setMsg] = useState('');
  const [dataMsg, setDataMsg] = useState('');
  const [draft, setDraft] = useState(profile);

  useEffect(() => setDraft(profile), [profile]);
  useEffect(() => {
    if (server.mode !== 'live') return;
    api
      .units()
      .then((r) => {
        setUnits(r.units);
        setSvcError('');
      })
      .catch((e) => {
        setUnits(null);
        setSvcError(e.fix === 'setup' && e.code !== 'AccessCode' ? e.message : '');
      });
  }, [server.mode]);

  function exportData() {
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), profile, print, checkins, looks, list }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `ahead-journal-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
  }

  async function restore(e) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try {
      await importJournal(JSON.parse(await f.text()));
      go('/today');
    } catch {
      setDataMsg('That file couldn’t be read as an Ahead journal.');
    }
  }

  async function saveCode() {
    const c = code.trim();
    setAccessCode(c);
    setCodeMsg('Checking…');
    try {
      await api.units(); // gated by the access code, spends no YouCam units
      setCodeMsg('Code accepted. You can analyse photos now.');
    } catch (err) {
      if (err.code === 'AccessCode') setAccessCode('');
      setCodeMsg(err.code === 'AccessCode' ? 'That code didn’t work. Check the testing instructions and try again.' : err.message);
    }
  }

  const toggle = (k) => setDraft((d) => ({ ...d, treatments: d.treatments.includes(k) ? d.treatments.filter((x) => x !== k) : [...d.treatments, k] }));

  return (
    <div className="stack-lg">
      <TopBar back="#/today" mode={server.mode} />
      <h1>Settings</h1>

      {draft && (
        <section className="sheet stack" aria-labelledby="tr">
          <h2 id="tr">Your treatment</h2>
          {TREATMENT_KEYS.map((k) => (
            <label key={k} className="choice">
              <input type="checkbox" checked={draft.treatments.includes(k)} onChange={() => toggle(k)} />
              <span><strong>{TREATMENTS[k].label}</strong></span>
            </label>
          ))}
          <label className="field">
            <span>First treatment day</span>
            <input className="input" type="date" required value={draft.startDate || ''} onChange={(e) => setDraft({ ...draft, startDate: e.target.value })} />
          </label>
          <label className="field">
            <span>Name</span>
            <input className="input" value={draft.name || ''} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </label>
          <button className="btn primary" disabled={!draft.startDate} onClick={() => saveProfile(draft).then(() => setMsg('Saved.'))}>Save changes</button>
          {msg && <p className="fine" role="status">{msg}</p>}
        </section>
      )}

      <section className="sheet stack" aria-labelledby="svc">
        <h2 id="svc">Analysis service</h2>
        <p>
          {server.mode === 'live' && (svcError || 'Connected to the YouCam API.')}
          {server.mode === 'demo' && 'Demo mode: the server has no YouCam API key, so results are simulated.'}
          {server.mode === 'offline' && 'The Ahead server can’t be reached.'}
          {server.mode === 'unknown' && 'Checking…'}
        </p>
        {units !== null && <p className="small">YouCam units remaining: <strong>{units}</strong></p>}
        {server.accessCodeRequired && (
          <div className="stack">
            <label className="field">
              <span>Access code</span>
              <input className="input" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" />
              <small>This demo is protected so its API units aren’t used up. The code is in the project’s testing instructions.</small>
            </label>
            <button className="btn secondary" onClick={saveCode}>Save code</button>
            {codeMsg && <p className="fine" role="status">{codeMsg}</p>}
          </div>
        )}
      </section>

      <section className="sheet stack" aria-labelledby="data">
        <h2 id="data">Your data</h2>
        <p className="small">Everything is stored in this browser: {checkins.length} check-ins, {looks.length} saved looks{print ? ', your Hair & Brow Print' : ''}. Browsers can clear site data, so download a copy now and then.</p>
        <button className="btn secondary" onClick={exportData}>Download my journal</button>
        <label className="btn secondary">
          Restore from a file
          <input type="file" accept="application/json,.json" hidden onChange={restore} />
        </label>
        <button className="btn secondary" onClick={async () => { if (window.confirm('Replace your journal with the sample journey?')) { await loadSample(); go('/today'); } }}>Load sample journey</button>
        <button className="btn secondary" style={{ color: 'var(--call)' }} onClick={async () => { if (window.confirm('Delete everything Ahead has stored on this device?')) { await resetAll(); go('/today'); } }}>Delete everything</button>
        {dataMsg && <p className="fine" role="status">{dataMsg}</p>}
      </section>

      <section className="stack fine">
        <p>Ahead is a self-tracking tool, not a medical device, and doesn’t diagnose or treat any condition. Always follow your care team’s advice.</p>
        <p>Skin, colour, face, hairstyle, hat and makeup analysis by the YouCam API (Perfect Corp.).</p>
      </section>
    </div>
  );
}
