// How an app screen arrives: its sections fade up in reading order, using the
// browser's own animation engine, so the screen shows at once with no library.
// GSAP follows for what sits further down (appMotion.js). Restrained on purpose:
// people on treatment can have nausea or blurred vision, so motion is short, small
// and opacity-led, warnings never move, and reduced motion leaves only a brief fade.

import { reducedMotion } from './reduced.js';

// Anything that tells someone to act, or holds such a message, appears at once.
const STILL = '.note.call, .note.watch, [role="alert"], .error-box, [data-still]';
export const isStill = (el) => el.matches(STILL) || Boolean(el.querySelector(STILL));
const MAX_STAGGERED = 6;
const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';

// A screen usually renders one wrapper; step into it to stagger its sections.
export function sectionsOf(root) {
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
  const vh = window.innerHeight;
  const running = sectionsOf(root)
    .filter((el) => still || el.getBoundingClientRect().top < vh)
    .map((el, i) =>
      el.animate(still ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }], {
        duration: still ? 160 : 420,
        delay: still ? 0 : Math.min(i, MAX_STAGGERED) * 50,
        easing: EASE,
        fill: 'backwards',
      }),
    );
  if (still) return () => running.forEach((a) => a.cancel());

  // The screen's title rises from behind its own baseline.
  const title = root.querySelector('h1');
  if (title && !isStill(title)) {
    running.push(title.animate([{ clipPath: 'inset(0 0 100% 0)', transform: 'translateY(55%)' }, { clipPath: 'inset(0 0 -12% 0)', transform: 'none' }], { duration: 640, delay: 90, easing: EASE, fill: 'backwards' }));
  }

  const road = root.querySelector('.road-inner');
  if (road && !roadDrawn) {
    roadDrawn = true;
    road.querySelectorAll('.road-week').forEach((week, i) => {
      running.push(week.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 360, delay: 120 + Math.min(i, 10) * 45, easing: EASE, fill: 'backwards' }));
    });
    root.querySelectorAll('.road-bands .band').forEach((band, i) => {
      // A clip, not a scale, so the labels on the bars never squash.
      running.push(band.animate([{ clipPath: 'inset(0 100% 0 0 round 999px)' }, { clipPath: 'inset(0 0 0 0 round 999px)' }], { duration: 620, delay: 300 + i * 70, easing: EASE, fill: 'backwards' }));
    });
  }

  // GSAP takes care of what is further down, whenever it has loaded.
  let cancelled = false;
  let undo = null;
  import('./appMotion.js')
    .then(({ enhanceScreen }) => {
      if (!cancelled && root.isConnected) undo = enhanceScreen(root);
    })
    .catch(() => {});
  return () => {
    cancelled = true;
    undo?.();
    running.forEach((a) => a.cancel());
  };
}
