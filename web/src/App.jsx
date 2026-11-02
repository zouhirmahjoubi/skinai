import { Suspense, lazy, useEffect, useLayoutEffect, useRef } from 'react';
import { AnimatePresence, LazyMotion, MotionConfig, domAnimation } from 'motion/react';
import * as m from 'motion/react-m';
import { useStore, useRoute, go } from './lib/store.jsx';
import { TabBar, Ambient } from './components.jsx';
import { enterScreen } from './lib/enter.js';
import { useLessMotion } from './lib/reduced.js';
import Welcome from './screens/Welcome.jsx';
import Today from './screens/Today.jsx';
import Skin from './screens/Skin.jsx';
import CheckIn from './screens/CheckIn.jsx';
import Result from './screens/Result.jsx';
import Shelf from './screens/Shelf.jsx';
import Look from './screens/Look.jsx';
import Ask from './screens/Ask.jsx';
import Report from './screens/Report.jsx';
import FittingSheet from './screens/FittingSheet.jsx';
import Settings from './screens/Settings.jsx';

// The welcome page brings GSAP and its paintings with it, so it loads on its own.
const Landing = lazy(() => import('./screens/Landing.jsx'));

// The welcome page, reopened after setup: the main button returns to the journal,
// and the sample buttons are left out because loading the sample replaces the journal.
function WelcomeAgain() {
  return (
    <Suspense fallback={null}>
      <Landing returning onStart={() => go('/today')} />
    </Suspense>
  );
}

const SCREENS = {
  '/today': Today,
  '/skin': Skin,
  '/checkin': CheckIn,
  '/result': Result,
  '/shelf': Shelf,
  '/look': Look,
  '/ask': Ask,
  '/report': Report,
  '/fitting': FittingSheet,
  '/settings': Settings,
  // The home address is the welcome page for everyone; the journal lives at #/today.
  '/': WelcomeAgain,
  '/welcome': WelcomeAgain,
};
const WELCOME_PATHS = new Set(['/', '/welcome']);

const TITLES = {
  '/today': 'Today',
  '/skin': 'Skin check-ins',
  '/checkin': 'Check-in',
  '/result': 'Check-in result',
  '/shelf': 'Your gentle shelf',
  '/look': 'Hair & brows',
  '/ask': 'Ask',
  '/report': 'Care-team summary',
  '/fitting': 'Fitting sheet',
  '/settings': 'Settings',
  '/': 'Welcome',
  '/welcome': 'Welcome',
};

// One visit's first screen shouldn't steal focus from the top of the page.
let firstView = true;

/**
 * One screen. The old screen has already faded out by the time this mounts, so
 * this is where the new one opens at the top, staggers in (set before paint, so
 * nothing flashes) and tells screen readers it has changed. The welcome page runs
 * its own sequence.
 */
function ScreenFrame({ landing, children }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    window.scrollTo(0, 0);
    return landing ? undefined : enterScreen(ref.current);
  }, [landing]);
  useEffect(() => {
    if (firstView) {
      firstView = false;
      return;
    }
    const h1 = document.querySelector('main h1');
    if (h1) {
      h1.setAttribute('tabindex', '-1');
      h1.focus({ preventScroll: true });
    }
  }, []);
  return (
    <m.div ref={ref} exit={{ opacity: 0, transition: { duration: 0.12 } }}>
      {children}
    </m.div>
  );
}

export default function App() {
  const { ready, profile } = useStore();
  const route = useRoute();
  const lessMotion = useLessMotion();
  const onboarding = !profile && route.path !== '/settings';
  // The welcome page is a full-width scroll story, so it opens at the top and without the tab bar.
  const landing = onboarding || WELCOME_PATHS.has(route.path);

  useEffect(() => {
    if (ready) document.title = `${onboarding ? 'Welcome' : TITLES[route.path] || 'Today'} · Still Me`;
  }, [ready, onboarding, route.path, route.param]);

  if (!ready) {
    return (
      <>
        <Ambient />
        <main className="app">
          <p className="muted center" style={{ marginTop: '40vh' }}>Opening your journal…</p>
        </main>
      </>
    );
  }

  const Screen = onboarding ? Welcome : SCREENS[route.path] || Today;
  const key = onboarding ? 'welcome' : `${route.path}/${route.param}`;

  return (
    <LazyMotion features={domAnimation} strict>
      <MotionConfig reducedMotion={lessMotion ? 'always' : 'user'}>
        <Ambient />
        <main className="app">
          <AnimatePresence mode="wait" initial={false}>
            <ScreenFrame key={key} landing={landing}>
              <Screen param={route.param} />
            </ScreenFrame>
          </AnimatePresence>
        </main>
        {!landing && <TabBar path={route.path} />}
      </MotionConfig>
    </LazyMotion>
  );
}
