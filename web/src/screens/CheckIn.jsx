import { useState } from 'react';
import { useStore, go } from '../lib/store.jsx';
import { api } from '../lib/api.js';
import { newId, today } from '../lib/db.js';
import { TopBar, Capture, Steps, ErrorBox } from '../components.jsx';
import { lightingCheck } from '../../../core/trends.js';

const STEPS = ['Preparing your photo', 'Uploading securely', 'Analysing 8 skin signals', 'Saving to your journal'];

export default function CheckIn() {
  const { checkins, addCheckin, server } = useStore();
  const [shot, setShot] = useState(null);
  const [step, setStep] = useState(-1);
  const [error, setError] = useState(null);
  const [captureKey, setCaptureKey] = useState(0);
  const first = checkins.find((c) => !c.sample);
  const baseline = checkins[0];

  const short = shot ? Math.min(shot.width, shot.height) : 0;
  const tier = short >= 1080 ? 'hd' : short >= 480 ? 'sd' : null;
  const tierMismatch = shot && baseline && tier && !checkins.some((c) => c.tier === tier);
  const sameTierBase = checkins.find((c) => c.tier === tier);
  const light = shot && sameTierBase ? lightingCheck({ capture: { brightness: shot.brightness } }, sameTierBase) : { comparable: true };

  async function analyse() {
    setError(null);
    try {
      setStep(0);
      setStep(1);
      const up = await api.upload(shot.blob);
      setStep(2);
      const result = await api.analyzeSkin(up.fileId, tier);
      setStep(3);
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
      };
      await addCheckin(checkin);
      go(`/result/${checkin.id}`);
    } catch (err) {
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
        <h1>{first ? 'Weekly check-in' : 'Baseline photo'}</h1>
        <p className="muted">Face the light, no makeup, hair back. Fit your face inside the oval and look straight ahead.</p>
      </div>

      {!shot && <Capture key={captureKey} mode="face" ghost={baseline?.photo} onCapture={setShot} cta="Take check-in photo" />}

      {shot && (
        <div className="stack">
          <div className="photo">
            <img src={shot.dataUrl} alt="Your check-in photo" />
          </div>
          {!tier && <div className="banner">This photo is too small to analyse ({short}px). Move closer to the camera or upload a sharper photo.</div>}
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
              <ErrorBox error={error} onRetry={error?.fix === 'photo' ? retake : analyse} />
              <div className="row">
                <button className="btn secondary" onClick={retake}>Retake</button>
                <button className="btn primary" style={{ flex: 1 }} onClick={analyse} disabled={!tier}>Analyse my skin</button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
