// The welcome page's choreography, with GSAP and ScrollTrigger. Only the welcome
// page imports this, so the app screens never download GSAP. Scroll drives it
// without taking over: nothing is pinned or hijacked, and text never sits faint
// waiting for a scroll. With reduced motion everything is simply there.

import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { reducedMotion } from './reduced.js';

gsap.registerPlugin(ScrollTrigger);

const DONE = { clearProps: 'opacity,transform' };

/** Runs the portrait's gathering: `render` gets 0..1 each frame, then `done` fires. */
export function gather(render, done) {
  const state = { p: 0 };
  const tween = gsap.to(state, { p: 1, duration: 2.1, ease: 'none', onUpdate: () => render(state.p), onComplete: done });
  return () => tween.kill();
}

/**
 * The page's story. On wide screens one phone stays in view and changes screen as
 * each chapter crosses the middle, turning slightly with the scroll. On phones
 * every chapter carries its own screen, which opens as it arrives.
 */
export function landingStory(root) {
  if (!root) return () => {};
  const q = gsap.utils.selector(root);
  const chapters = q('.chapter');
  const screens = q('.phone-screen');
  const show = (i) => screens.forEach((s, n) => s.classList.toggle('on', n === i));
  show(0);

  const mm = gsap.matchMedia(root);
  // matchMedia only runs when at least one query matches, so "always" guarantees a run.
  mm.add({ always: 'all', wide: '(min-width: 900px)' }, ({ conditions }) => {
    // The wide page shows these screens nowhere else, so they change with the scroll whatever the motion setting.
    if (conditions.wide) {
      chapters.forEach((chapter, i) => ScrollTrigger.create({ trigger: chapter, start: 'top 55%', end: 'bottom 55%', onToggle: (self) => self.isActive && show(i) }));
    }
    if (reducedMotion()) return;

    // Arrival: words rise behind their masks, everything else follows within 0.8 s.
    gsap
      .timeline({ defaults: { ease: 'expo.out' } })
      .fromTo(q('.land-top'), { opacity: 0, y: -8 }, { opacity: 1, y: 0, duration: 0.45, ...DONE })
      .fromTo(q('.hero-title .hero-word > span'), { yPercent: 110 }, { yPercent: 0, duration: 0.7, stagger: 0.07, clearProps: 'transform' }, 0.05)
      .fromTo(q('.hero [data-rise]'), { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.5, stagger: 0.06, ...DONE }, 0.25);

    const rise = (targets, trigger, vars = {}) =>
      gsap.fromTo(targets, { opacity: 0, y: 22 }, { opacity: 1, y: 0, duration: 0.7, ease: 'expo.out', stagger: 0.07, ...DONE, ...vars, scrollTrigger: { trigger, start: 'top 84%', once: true } });

    rise(q('.story-head > *'), q('.story-head')[0]);
    rise(q('.final > *'), q('.final')[0]);

    chapters.forEach((chapter) => {
      rise(chapter.querySelectorAll('.chapter-text > *'), chapter);
      if (!conditions.wide) {
        const shot = chapter.querySelector('.chapter-shot');
        gsap.fromTo(shot, { y: 36, opacity: 0, scale: 0.97 }, { y: 0, opacity: 1, scale: 1, duration: 0.8, ease: 'expo.out', ...DONE, scrollTrigger: { trigger: shot, start: 'top 90%', once: true } });
      }
    });

    if (conditions.wide) {
      const story = q('.story-body')[0];
      gsap.fromTo(q('.story-stage .phone'), { rotateY: -6, rotateX: 2 }, { rotateY: 6, rotateX: -2, ease: 'none', scrollTrigger: { trigger: story, start: 'top bottom', end: 'bottom top', scrub: 0.8 } });
      gsap.to(q('.hero-figure'), { yPercent: -5, ease: 'none', scrollTrigger: { trigger: q('.hero')[0], start: 'top top', end: 'bottom top', scrub: true } });
    }
  });
  // Web fonts change line lengths, so measure again once they have loaded.
  document.fonts?.ready.then(() => ScrollTrigger.refresh());
  return () => mm.revert();
}
