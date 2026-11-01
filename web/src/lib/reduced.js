// One answer to "should this move?": the device's reduced-motion setting, or
// Still Me's own Less motion switch, since few people on treatment will know
// the phone has one. Kept apart from the animation libraries so that asking
// costs nothing.

import { useEffect, useState } from 'react';

const KEY = 'still-me-less-motion';

export function lessMotionChosen() {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export const reducedMotion = () => typeof window !== 'undefined' && (lessMotionChosen() || Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches));

export function applyLessMotion(on = lessMotionChosen()) {
  document.documentElement.toggleAttribute('data-less-motion', on);
}

export function setLessMotion(on) {
  try {
    if (on) localStorage.setItem(KEY, '1');
    else localStorage.removeItem(KEY);
  } catch {
    /* private mode: it still applies until the page reloads */
  }
  applyLessMotion(on);
  window.dispatchEvent(new Event('lessmotionchange'));
}

export function useLessMotion() {
  const [on, setOn] = useState(lessMotionChosen);
  useEffect(() => {
    const sync = () => setOn(lessMotionChosen());
    window.addEventListener('lessmotionchange', sync);
    return () => window.removeEventListener('lessmotionchange', sync);
  }, []);
  return on;
}
