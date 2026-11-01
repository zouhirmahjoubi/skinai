// How an app screen arrives: its sections fade up in reading order, using the
// browser's own animation engine, so no animation library is needed here.
// Restrained on purpose: people on treatment can have nausea or blurred vision,
// so motion is short, small and opacity-led, warnings never move, and reduced
// motion leaves only a brief fade.

import { reducedMotion } from './reduced.js';

// Anything that tells someone to act, or holds such a message, appears at once.
const STILL = '.note.call, .note.watch, [role="alert"], .error-box, [data-still]';
const isStill = (el) => el.matches(STILL) || Boolean(el.querySelector(STILL));
const MAX_STAGGERED = 6;
const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';

// A screen usually renders one wrapper; step into it to stagger its sections.
function sectionsOf(root) {
  let el = root;
  while (el.children.length === 1 && el.firstElementChild.children.length > 1) el = el.firstElementChild;
  return [...el.children].filter((c) => !isStill(c) && c.offsetParent !== null);
}

// The timeline draws in once a session, not every time someone returns to Today.
let roadDrawn = false;

/** Brings a freshly shown screen in. Returns a function that cancels it. */
export function enterScreen(root) {
  if (!root || !root.animate) return () => {};
  const still = reducedMotion();
  const running = sectionsOf(root).map((el, i) =>
    el.animate(still ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }], {
      duration: still ? 160 : 420,
      delay: still ? 0 : Math.min(i, MAX_STAGGERED) * 50,
      easing: EASE,
      fill: 'backwards',
    }),
  );
  const bands = root.querySelectorAll('.road-bands .band');
  if (bands.length && !still && !roadDrawn) {
    roadDrawn = true;
    bands.forEach((band, i) => {
      // A clip, not a scale, so the labels on the bars never squash.
      running.push(band.animate([{ clipPath: 'inset(0 100% 0 0 round 999px)' }, { clipPath: 'inset(0 0 0 0 round 999px)' }], { duration: 620, delay: 180 + i * 70, easing: EASE, fill: 'backwards' }));
    });
  }
  return () => running.forEach((a) => a.cancel());
}
