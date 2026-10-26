import { useEffect, useRef, useState } from 'react';
import { useStore, go } from '../lib/store.jsx';
import { api } from '../lib/api.js';
import { newId, today } from '../lib/db.js';
import { TopBar, Capture, Steps, ErrorBox } from '../components.jsx';
import { lightingCheck } from '../../../core/trends.js';

const STEPS = ['Uploading securely', 'Analysing 8 skin signals', 'Saving to your journal'];

export default function CheckIn() {
  const { checkins, addCheckin, server } = useStore();
  const [shot, setShot] = useState(null);
  const [step, setStep] = useState(-1);
  const [error, setError] = useState(null);
  const [captureKey, setCaptureKey] = useState(0);
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );

  // Only the person's own check-ins count here: the sample journey is never a baseline.
  const real = checkins.filter((c) => !c.sample);
  const hasSample = checkins.length > real.length;
  const baseline = real[0];

  const short = shot ? Math.min(shot.width, shot.height) : 0;
  const tier = short >= 1080 ? 'hd' : short >= 480 ? 'sd' : null;
  const tierMismatch = shot && baseline && tier && !real.some((c) => c.tier === tier);
  const sameTierBase = real.find((c) => c.tier === tier);
  const photoError = error?.fix === 'photo';
  const light = shot && sameTierBase ? lightingCheck({ capture: { brightness: shot.brightness } }, sameTierBase) : { comparable: true };

  async function analyse() {
    if (step >= 0) return;
    setError(null);
    try {
      setStep(0);
      const up = await api.upload(shot.blob);
      setStep(1);
      const result = await api.analyzeSkin(up.fileId, tier);
      setStep(2);
      const checkin = {
        id: newId(),
        date: today(),
        createdAt: new Date().toISOString(),
        tier: result.tier,
        scores: result.scores,
        overall: result.overall,
        skinAge: result.skinAge,
        photo: shot.dataUrl,
        baseImage: result.baseImage,
        capture: { brightness: shot.brightness, width: shot.width, height: shot.height, source: shot.source },
        demo: Boolean(result.demo),
        deletedFromYouCam: Boolean(result.deleted),
      };
      await addCheckin(checkin);
      // The check-in is saved either way (it shows on Today and in Skin);
      // only open the result if the person is still on this screen.
      if (alive.current) go(`/result/${checkin.id}`);
    } catch (err) {
      if (!alive.current) return;
      setStep(-1);
      setError(err);
    }
  }

  function retake() {
    setShot(null);
    setError(null);
    setCaptureKey((k) => k + 1);
  }

  return (
    <div className="stack-lg">
      <TopBar back="#/skin" title="Check-in" mode={server.mode} />
      <div className="stack">
        <h1>{baseline ? 'Weekly check-in' : 'Baseline photo'}</h1>
        <p className="muted">Face the light, no makeup, hair back. Fit your face inside the oval and look straight ahead.</p>
        {hasSample && !baseline && <div className="banner info">This photo starts your own trend line. It isn’t compared with the sample journey’s scores.</div>}
      </div>

      {!shot && <Capture key={captureKey} mode="face" ghost={baseline?.photo} onCapture={setShot} cta="Take check-in photo" />}

      {shot && (
        <div className="stack">
          <p className="sr-only" role="status">
            {step >= 0 ? `${STEPS[step]}…${step === 1 ? ' This usually takes 10 to 30 seconds.' : ''}` : ''}
          </p>
          <div className="photo preview">
            <img src={shot.dataUrl} alt="Your check-in photo" />
          </div>
          {!tier && (
            <div className="banner">
              {shot.source === 'camera'
                ? `This camera’s resolution is too low for skin analysis (${short}px; 480px needed). Upload a selfie taken with your phone instead.`
                : `This photo is too small to analyse (${short}px; 480px needed). Zoom out, or upload a higher-resolution photo.`}
            </div>
          )}
          {tier && (
            <p className="fine">
              {tier === 'hd' ? 'HD analysis' : 'Standard analysis'} ({shot.width}×{shot.height}px).
              {tier === 'sd' && ' For HD, use your phone’s camera app and upload the photo.'}
            </p>
          )}
          {tierMismatch && <div className="banner">Your baseline was {baseline.tier.toUpperCase()}. This photo will be analysed as {tier.toUpperCase()} and starts a separate trend line, because the two aren’t directly comparable.</div>}
          {!light.comparable && <div className="banner">Your face is {Math.round(Math.abs(light.diff) * 100)}% {light.diff > 0 ? 'brighter' : 'darker'} than in your baseline. Changes may come from the light. Retake in your usual spot if you can.</div>}

          {step >= 0 ? (
            <div className="sheet">
              <Steps steps={STEPS} at={step} />
              <p className="fine">Analysis usually takes 10 to 30 seconds.</p>
            </div>
          ) : (
            <>
              <ErrorBox error={error} />
              {/* After a rejected photo, Retake is the way forward; otherwise Analyse (which also retries). */}
              <div className="row">
                <button className={`btn ${photoError ? 'primary' : 'secondary'}`} style={photoError ? { flex: 1 } : undefined} onClick={retake} autoFocus={photoError}>Retake</button>
                <button className={`btn ${photoError ? 'secondary' : 'primary'}`} style={photoError ? undefined : { flex: 1 }} onClick={analyse} disabled={!tier} autoFocus={!photoError}>Analyse my skin</button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
