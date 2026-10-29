// Screen choreography with GSAP. Restrained on purpose: people on treatment
// can have nausea or blurred vision, so motion is short, small and opacity-led,
// warnings never move, and "reduce motion" leaves only a brief fade.

import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

export const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// Anything that tells someone to act, or holds such a message, appears at once.
const STILL = '.note.call, .note.watch, [role="alert"], .error-box, [data-still]';
const isStill = (el) => el.matches(STILL) || Boolean(el.querySelector(STILL));
const MAX_STAGGERED = 6;
const DONE = { clearProps: 'opacity,transform' };

// A screen usually renders one wrapper; step into it to stagger its sections.
function sectionsOf(root) {
  let el = root;
  while (el.children.length === 1 && el.firstElementChild.children.length > 1) el = el.firstElementChild;
  return [...el.children].filter((c) => !isStill(c) && c.offsetParent !== null);
}

/** Brings a freshly shown screen in: its sections fade up in reading order, then the timeline settles. */
export function enterScreen(root) {
  if (!root) return () => {};
  const items = sectionsOf(root);
  if (!items.length) return () => {};
  const ctx = gsap.context(() => {
    if (reducedMotion()) {
      gsap.fromTo(items, { opacity: 0 }, { opacity: 1, duration: 0.18, ...DONE });
      return;
    }
    const tl = gsap.timeline({ defaults: { ease: 'expo.out' } });
    tl.fromTo(
      items,
      { opacity: 0, y: 14 },
      { opacity: 1, y: 0, duration: 0.55, stagger: (i) => Math.min(i, MAX_STAGGERED) * 0.06, ...DONE },
    );
    // The treatment timeline: weeks pop in left to right, then the side-effect bands draw across.
    const nodes = root.querySelectorAll('.road-week .node');
    const bands = root.querySelectorAll('.road-bands .band');
    if (nodes.length) tl.fromTo(nodes, { scale: 0.4, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.45, ease: 'back.out(2)', stagger: 0.03, ...DONE }, 0.12);
    if (bands.length) tl.fromTo(bands, { scaleX: 0, transformOrigin: '0% 50%' }, { scaleX: 1, duration: 0.6, stagger: 0.07, clearProps: 'transform,transformOrigin' }, 0.22);
  }, root);
  return () => ctx.revert();
}

/**
 * The welcome landing, after Ondine's "Scrolltide": the hero assembles on load,
 * then scroll drives the rest. How-it-works steps light up as they cross the
 * middle of the screen while a rail fills beside them and labels pop onto the
 * arch; the promise darkens word by word. getOrb() lets scroll turn the orb.
 * With reduced motion everything is simply shown, fully lit.
 */
export function landingStory(root, getOrb) {
  if (!root) return () => {};
  const q = gsap.utils.selector(root);
  const steps = q('.rail-step');
  const labels = q('.arch-label');
  const light = (upTo) => {
    steps.forEach((s, i) => s.classList.toggle('on', i <= upTo));
    labels.forEach((l, i) => l.classList.toggle('on', i <= upTo));
  };

  const mm = gsap.matchMedia(root);
  // matchMedia only runs when at least one query matches, so one of motion/reduce always does.
  const queries = { motion: '(prefers-reduced-motion: no-preference)', reduce: '(prefers-reduced-motion: reduce)', wide: '(min-width: 900px)' };
  mm.add(queries, ({ conditions }) => {
    if (conditions.reduce) {
      light(steps.length - 1);
      return;
    }

    // Entrance: words rise behind their masks, the orb settles, pins and the card follow.
    gsap
      .timeline({ defaults: { ease: 'expo.out' } })
      .fromTo(q('.land-top'), { opacity: 0, y: -8 }, { opacity: 1, y: 0, duration: 0.5, ...DONE })
      .fromTo(q('.hero-head .eyebrow'), { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.5, ...DONE }, 0.05)
      .fromTo(q('.hero-title .hero-word > span'), { yPercent: 110 }, { yPercent: 0, duration: 0.7, stagger: 0.045, clearProps: 'transform' }, 0.1)
      .fromTo(q('.orb-wrap'), { opacity: 0, scale: 0.92 }, { opacity: 1, scale: 1, duration: 1.1, ...DONE }, 0.15)
      .fromTo(q('.hero-big .hero-word > span'), { yPercent: 110 }, { yPercent: 0, duration: 0.8, clearProps: 'transform' }, 0.35)
      .fromTo(q('.pin'), { opacity: 0, scale: 0.9 }, { opacity: 1, scale: 1, duration: 0.6, stagger: 0.12, ease: 'back.out(1.8)', ...DONE }, 0.5)
      .fromTo(q('.scan-card'), { opacity: 0, y: 18 }, { opacity: 1, y: 0, duration: 0.7, ...DONE }, 0.55)
      .fromTo(q('.scan-bar > span'), { scaleX: 0 }, { scaleX: 1, duration: 1.1, ease: 'power2.inOut', transformOrigin: '0% 50%', clearProps: 'transform' }, 0.65)
      .from(q('.scan-card dd[data-count]'), { textContent: 0, snap: { textContent: 1 }, duration: 1, ease: 'power1.out' }, 0.7)
      .fromTo(q('[data-rise]'), { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.6, stagger: 0.08, ...DONE }, 0.3);

    // How it works: each step lights as it crosses 60% of the screen height.
    steps.forEach((step, i) =>
      ScrollTrigger.create({ trigger: step, start: 'top 60%', onEnter: () => light(i), onLeaveBack: () => light(i - 1) }),
    );
    gsap.fromTo(q('.rail-fill'), { scaleY: 0 }, { scaleY: 1, ease: 'none', transformOrigin: '50% 0%', scrollTrigger: { trigger: q('.steps-wrap')[0], start: 'top 60%', end: 'bottom 60%', scrub: 0.4 } });

    // The promise: words go from faint to full ink as the paragraph scrolls through.
    gsap.fromTo(q('.statement .sw'), { opacity: 0.16 }, { opacity: 1, stagger: 0.1, ease: 'none', scrollTrigger: { trigger: q('.statement')[0], start: 'top 82%', end: 'bottom 52%', scrub: 0.5 } });

    // Scroll turns the orb a little further.
    ScrollTrigger.create({ trigger: root, start: 'top top', end: 'bottom bottom', onUpdate: (self) => getOrb?.()?.setProgress(self.progress) });

    // On wide screens only (parallax feels jumpy on phones): the hero visual drifts up as you leave it.
    if (conditions.wide) {
      gsap.to(q('.hero-visual'), { yPercent: -6, ease: 'none', scrollTrigger: { trigger: q('.hero')[0], start: 'top top', end: 'bottom top', scrub: true } });
    }
  });
  // Web fonts change line lengths, so measure again once they have loaded.
  document.fonts?.ready.then(() => ScrollTrigger.refresh());
  return () => mm.revert();
}
