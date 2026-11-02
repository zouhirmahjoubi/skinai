// The welcome page's choreography, with GSAP and ScrollTrigger. The scroll stays the
// browser's own: nothing is hijacked, words arrive as they come into view and never sit
// faint waiting for a scroll, and nothing draws while the page is still. The drawn lines
// sketch themselves in, a small star travels down them as you read, headings rise word
// by word, and three.js gold dust is thrown out by each dissolve (goldDust.js). With
// reduced motion or Less motion each chapter simply shows its own painting.

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
const DUST_TRAVEL = 0.16; // how far the motes rise per screen of scrolling
const START_COLOR = [13, 79, 104, 255]; // the sky of the first painting
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** The small chapter label resolves into its new words, left to right. It is decoration, hidden from screen readers. */
function decode(el, text) {
  const state = { p: 0 };
  gsap.killTweensOf(el);
  gsap.to(state, {
    p: 1,
    duration: 0.45,
    ease: 'none',
    onUpdate: () => {
      const done = Math.floor(state.p * text.length);
      el.textContent = text.slice(0, done) + [...text.slice(done)].map((c) => (c === ' ' ? ' ' : LETTERS[Math.floor(Math.random() * LETTERS.length)])).join('');
    },
    onComplete: () => {
      el.textContent = text;
    },
  });
}

/**
 * The page's story. Scroll position decides everything: which two paintings are on
 * the stage, how far one has broken into the other, how the dust is thrown, and which
 * label and text colour the fixed guides use.
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
  let dust = null;
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
      const first = current === -1;
      current = now;
      if (first || !moving) label.textContent = scenes[now].dataset.label;
      else decode(label, scenes[now].dataset.label);
    }
    root.dataset.tone = atEnd ? 'end' : scenes[now].dataset.tone;
    if (stage && arrived) stage.draw(i, p, read(scenes[i]), scenes[i + 1] ? read(scenes[i + 1]) : 1);
    if (dust && arrived) dust.draw({ travel: (window.scrollY / vh) * DUST_TRAVEL, lift: Math.sin(Math.PI * p) });
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
      dust?.stop();
      dust = null;
      root.classList.remove('staged');
      ScrollTrigger.refresh();
    };
    const arrival = { p: 0 };
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
        // The dust loads on its own, so the painting never waits for it.
        import('./goldDust.js')
          .then(({ startDust }) => {
            if (stopped || !stage) return;
            const wide = window.innerWidth >= 900;
            dust = startDust(q('.dust')[0], { count: wide ? 420 : 180, size: wide ? 3.4 : 3, fine: window.matchMedia('(hover: hover) and (pointer: fine)').matches });
            if (arrived) frame();
          })
          .catch(() => {});
        // Arrival: the first painting gathers out of its own sky, unless the page opened part-way down.
        if (window.scrollY > window.innerHeight * 0.2) {
          arrived = true;
          frame();
          return;
        }
        gsap.to(arrival, {
          p: 1,
          duration: 1.9,
          ease: 'power1.out',
          onUpdate: () => {
            if (stopped || arrived) return;
            stage?.draw(-1, arrival.p);
            dust?.draw({ travel: 0, lift: 1 - arrival.p });
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
  // matchMedia only runs when at least one query matches, so "always" guarantees a run.
  mm.add({ always: 'all', wide: '(min-width: 900px)' }, ({ conditions }) => {
    if (!moving) return;

    // Arrival: the lines draw themselves, words rise behind their masks, and everything follows within a second.
    gsap
      .timeline({ defaults: { ease: 'expo.out' } })
      .fromTo(q('.guide-v'), { scaleY: 0, transformOrigin: 'top' }, { scaleY: 1, duration: 1.2, clearProps: 'transform' }, 0)
      .fromTo(q('.guide-h'), { scaleX: 0, transformOrigin: 'left' }, { scaleX: 1, duration: 1.2, clearProps: 'transform' }, 0.1)
      .fromTo(q('.guide-star'), { scale: 0, rotation: -90 }, { scale: 1, rotation: 0, duration: 0.9, clearProps: 'transform' }, 0.3)
      .fromTo(q('.guide-ticks, .guide-label'), { opacity: 0 }, { opacity: 1, duration: 0.5, clearProps: 'opacity' }, 0.45)
      .fromTo(q('.land-top'), { opacity: 0, y: -8 }, { opacity: 1, y: 0, duration: 0.45, ...DONE }, 0)
      .fromTo(q('.hero-title .hero-word > span'), { yPercent: 112 }, { yPercent: 0, duration: 0.8, stagger: 0.07, clearProps: 'transform' }, 0.05)
      .fromTo(q('.hero [data-rise]'), { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.5, stagger: 0.06, ...DONE }, 0.25);

    // A small star travels down the drawn line as you read.
    gsap.fromTo(q('.guide-mark'), { y: 0 }, { y: () => window.innerHeight - 14, ease: 'none', scrollTrigger: { trigger: root, start: 'top top', end: 'bottom bottom', scrub: 0.4, invalidateOnRefresh: true } });

    // Each chapter: the heading rises word by word, its tag wipes open, then its words follow.
    q('.scene:not(.hero) .scene-copy').forEach((copy) => {
      const tl = gsap.timeline({ defaults: { ease: 'expo.out' }, scrollTrigger: { trigger: copy, start: 'top 92%', once: true } });
      tl.fromTo(copy.querySelectorAll('h2 .hero-word > span'), { yPercent: 112 }, { yPercent: 0, duration: 0.8, stagger: 0.05, clearProps: 'transform' }, 0);
      const tag = copy.querySelector('.tag');
      if (tag) tl.fromTo(tag, { clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0% 0 0)', duration: 0.6, clearProps: 'clipPath' }, 0.2);
      const rest = copy.querySelectorAll('.scene-note > span:not(.tag), .cta-row > *');
      if (rest.length) tl.fromTo(rest, { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.6, stagger: 0.06, ...DONE }, 0.3);
    });

    // Words that have been read ease away as soon as they start to move, so they never sit
    // over the next painting or pass behind the fixed label.
    q('.scene:not(.last) .scene-hold > *').forEach((copy) => {
      gsap.fromTo(copy, { opacity: 1 }, { opacity: 0, ease: 'none', immediateRender: false, scrollTrigger: { trigger: copy.closest('.scene'), start: 'bottom 100%', end: 'bottom 66%', scrub: true } });
    });

    // The end of the page: blocks rise in, and on a laptop the real screens pass at slightly different speeds.
    q('.land-end > *').forEach((block) => {
      gsap.fromTo(block, { opacity: 0, y: 22 }, { opacity: 1, y: 0, duration: 0.7, ease: 'expo.out', ...DONE, scrollTrigger: { trigger: block, start: 'top 90%', once: true } });
    });
    if (conditions.wide) {
      q('.screens .phone').forEach((phone, i) => {
        const from = i % 2 ? 26 : -26;
        gsap.fromTo(phone, { y: from }, { y: -from, ease: 'none', scrollTrigger: { trigger: phone, start: 'top bottom', end: 'bottom top', scrub: 0.6 } });
      });
    }
  });
  // Web fonts change line lengths, so measure again once they have loaded.
  document.fonts?.ready.then(() => ScrollTrigger.refresh());

  return () => {
    stopped = true;
    if (raf) cancelAnimationFrame(raf);
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('resize', onScroll);
    stage?.stop();
    dust?.stop();
    mm.revert();
  };
}
