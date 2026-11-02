// What happens below the first screen of an app page, with GSAP. Loaded on its own,
// after the screen is already showing, so if it never arrives nothing is missing.
// Short and small on purpose: nothing bounces or loops, warnings never move, and
// with reduced motion or Less motion this file is never used.

import { gsap } from 'gsap';
import { isStill, sectionsOf } from './enter.js';

// Keep to the clock on a slow phone.
gsap.ticker.lagSmoothing(0);

const EASE = 'expo.out';
const DONE = { clearProps: 'opacity,transform,clipPath' };

/** Draws one sparkline from its first point, then sets its last dot. */
function drawSpark(svg, delay = 0) {
  const path = svg.querySelector('path');
  const dot = svg.querySelector('circle');
  if (!path) return;
  path.setAttribute('pathLength', '1');
  gsap.fromTo(path, { strokeDasharray: 1, strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 0.9, delay, ease: 'power2.out', clearProps: 'strokeDasharray,strokeDashoffset' });
  if (dot) gsap.fromTo(dot, { opacity: 0 }, { opacity: 1, duration: 0.3, delay: delay + 0.7, clearProps: 'opacity' });
}

/**
 * Counts a score up to its value. The text node stays the same one, so React still
 * owns it, and the real value is there from the first frame for screen readers
 * because the numbers are written only after this has started.
 */
function countUp(el, delay = 0) {
  const node = el.firstChild;
  const final = node?.nodeValue;
  if (node?.nodeType !== 3 || !/^\d+$/.test(final || '')) return;
  const to = Number(final);
  const state = { n: Math.max(0, to - 24) };
  gsap.to(state, {
    n: to,
    duration: 0.8,
    delay,
    ease: 'power3.out',
    onUpdate: () => {
      if (node.isConnected) node.nodeValue = String(Math.round(state.n));
    },
    onComplete: () => {
      if (node.isConnected) node.nodeValue = final;
    },
  });
}

/** Brings one block in as it scrolls into view. Runs once. */
function arrive(el) {
  gsap.to(el, { opacity: 1, y: 0, duration: 0.65, ease: EASE, ...DONE });
  el.querySelectorAll('.spark').forEach((s, i) => drawSpark(s, 0.1 + Math.min(i, 8) * 0.05));
  el.querySelectorAll('.score .value').forEach((v, i) => countUp(v, 0.1 + Math.min(i, 8) * 0.05));
  const figures = el.querySelectorAll('.gallery figure, .lookbook figure');
  if (figures.length) gsap.fromTo(figures, { clipPath: 'inset(0 0 100% 0 round 10px)' }, { clipPath: 'inset(0 0 0% 0 round 10px)', duration: 0.8, stagger: 0.07, ease: EASE, clearProps: 'clipPath' });
}

/** Sets up one freshly shown screen. Returns a function that undoes it. */
export function enhanceScreen(root) {
  const vh = window.innerHeight;
  const sections = sectionsOf(root);
  const below = sections.filter((el) => el.getBoundingClientRect().top >= vh);
  const above = sections.filter((el) => el.getBoundingClientRect().top < vh);

  // What is already on screen draws straight away, alongside the screen's own fade.
  above.forEach((el) => {
    el.querySelectorAll('.spark').forEach((s, i) => drawSpark(s, 0.15 + Math.min(i, 8) * 0.05));
    el.querySelectorAll('.score .value').forEach((v, i) => countUp(v, 0.15 + Math.min(i, 8) * 0.05));
    const figures = el.querySelectorAll('.gallery figure, .lookbook figure');
    if (figures.length) gsap.fromTo(figures, { clipPath: 'inset(0 0 100% 0 round 10px)' }, { clipPath: 'inset(0 0 0% 0 round 10px)', duration: 0.8, delay: 0.1, stagger: 0.07, ease: EASE, clearProps: 'clipPath' });
  });

  below.forEach((el) => gsap.set(el, { opacity: 0, y: 18 }));
  const seen = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        seen.unobserve(entry.target);
        arrive(entry.target);
      });
    },
    { rootMargin: '0px 0px -6% 0px' },
  );
  below.forEach((el) => seen.observe(el));

  // Nothing may stay hidden on paper, whatever has been scrolled to.
  const showAll = () => below.forEach((el) => gsap.set(el, { clearProps: 'opacity,transform' }));
  window.addEventListener('beforeprint', showAll);

  // The week you're on settles into place along the timeline.
  const here = root.querySelector('.road-week.here .node');
  if (here && !isStill(here)) gsap.fromTo(here, { rotation: 90, opacity: 0 }, { rotation: 0, opacity: 1, duration: 0.8, delay: 0.3, ease: EASE, clearProps: 'transform,opacity' });

  return () => {
    seen.disconnect();
    window.removeEventListener('beforeprint', showAll);
    showAll();
  };
}
