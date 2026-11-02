// The welcome page's choreography, with GSAP and ScrollTrigger. Only the welcome
// page imports this, so the app screens never download GSAP. The scroll stays the
// browser's own: nothing is hijacked, text never sits faint waiting for a scroll,
// and nothing draws while the page is still. With reduced motion or Less motion
// each chapter simply shows its own painting.

import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { reducedMotion } from './reduced.js';
import { startScenes } from './scenes.js';

gsap.registerPlugin(ScrollTrigger);
// Keep to the clock on a slow phone, so the words still arrive within a second.
gsap.ticker.lagSmoothing(0);

const DONE = { clearProps: 'opacity,transform' };
const clamp = (n) => Math.min(1, Math.max(0, n));

// How far up the screen the next chapter has come when its painting has fully formed.
const FORMED_AT = 0.7;
const DRIFT = 0.035; // how far a painting eases in while you read over it
const START_COLOR = [13, 79, 104, 255]; // the sky of the first painting

/**
 * The page's story. Scroll position decides everything: which two paintings are on
 * the stage, how far one has broken into the other, and which label and text colour
 * the fixed guides use.
 */
export function landingStory(root) {
  if (!root) return () => {};
  const q = gsap.utils.selector(root);
  const scenes = q('[data-scene]');
  const label = q('.guide-label')[0];
  const end = q('.land-end')[0];
  const save = navigator.connection?.saveData || (navigator.deviceMemory && navigator.deviceMemory <= 2);
  const moving = !reducedMotion();
  const tall = window.matchMedia('(max-aspect-ratio: 1/1)').matches;

  let stage = null;
  let arrived = false;
  let stopped = false;
  let raf = 0;
  let current = -1;

  // How far through a chapter you've read, for the slow drift on its painting.
  const read = (scene) => {
    const r = scene.getBoundingClientRect();
    return 1 + DRIFT * clamp(-r.top / Math.max(1, r.height));
  };

  const frame = () => {
    raf = 0;
    const vh = window.innerHeight;
    let i = 0;
    let p = 0;
    for (let k = 1; k < scenes.length; k++) {
      const top = scenes[k].getBoundingClientRect().top;
      if (top >= vh) break;
      i = k - 1;
      p = clamp((vh - top) / (vh * FORMED_AT));
    }
    const now = p > 0.5 ? i + 1 : i;
    const atEnd = end.getBoundingClientRect().top < vh * 0.5;
    if (now !== current) {
      current = now;
      label.textContent = scenes[now].dataset.label;
    }
    root.dataset.tone = atEnd ? 'end' : scenes[now].dataset.tone;
    if (stage && arrived) stage.draw(i, p, read(scenes[i]), scenes[i + 1] ? read(scenes[i + 1]) : 1);
  };
  const onScroll = () => {
    if (!raf) raf = requestAnimationFrame(frame);
  };

  // The stage takes over from the separate paintings only once it can really run.
  const canvas = q('.stage canvas')[0];
  if (moving && !save) {
    root.classList.add('staged');
    const unstage = () => {
      stage = null;
      root.classList.remove('staged');
      ScrollTrigger.refresh();
    };
    startScenes(canvas, scenes.map((s) => `/scenes/${s.dataset.scene}-${tall ? 't' : 'w'}.webp`), START_COLOR, unstage)
      .then((s) => {
        if (stopped) {
          s?.stop();
          return;
        }
        if (!s) {
          unstage();
          return;
        }
        stage = s;
        // Arrival: the first painting gathers out of its own sky, unless the page opened part-way down.
        if (window.scrollY > window.innerHeight * 0.2) {
          arrived = true;
          frame();
          return;
        }
        const state = { p: 0 };
        gsap.to(state, {
          p: 1,
          duration: 1.9,
          ease: 'power1.out',
          onUpdate: () => {
            if (!stopped && !arrived) stage?.draw(-1, state.p);
          },
          onComplete: () => {
            arrived = true;
            frame();
          },
        });
      })
      .catch(unstage);
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
  frame();

  const mm = gsap.matchMedia(root);
  mm.add({ always: 'all' }, () => {
    if (!moving) return;

    // Arrival: words rise behind their masks, everything else follows within 0.8 s.
    gsap
      .timeline({ defaults: { ease: 'expo.out' } })
      .fromTo(q('.land-top'), { opacity: 0, y: -8 }, { opacity: 1, y: 0, duration: 0.45, ...DONE })
      .fromTo(q('.hero-title .hero-word > span'), { yPercent: 110 }, { yPercent: 0, duration: 0.7, stagger: 0.07, clearProps: 'transform' }, 0.05)
      .fromTo(q('.hero [data-rise]'), { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.5, stagger: 0.06, ...DONE }, 0.25);

    const rise = (targets, trigger) =>
      gsap.fromTo(targets, { opacity: 0, y: 22 }, { opacity: 1, y: 0, duration: 0.7, ease: 'expo.out', stagger: 0.07, ...DONE, scrollTrigger: { trigger, start: 'top 88%', once: true } });

    q('.scene-copy').forEach((copy) => rise(copy.children, copy));
    q('.land-end > *').forEach((block) => rise(block, block));

    // Words that have been read ease away as soon as they start to move, so they never sit
    // over the next painting or pass behind the fixed label.
    q('.scene:not(.last) .scene-hold > *').forEach((copy) => {
      gsap.fromTo(copy, { opacity: 1 }, { opacity: 0, ease: 'none', immediateRender: false, scrollTrigger: { trigger: copy.closest('.scene'), start: 'bottom 100%', end: 'bottom 66%', scrub: true } });
    });
  });
  // Web fonts change line lengths, so measure again once they have loaded.
  document.fonts?.ready.then(() => ScrollTrigger.refresh());

  return () => {
    stopped = true;
    if (raf) cancelAnimationFrame(raf);
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('resize', onScroll);
    stage?.stop();
    mm.revert();
  };
}
