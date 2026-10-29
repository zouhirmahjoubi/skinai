import { useEffect, useLayoutEffect, useRef } from 'react';
import { useStore, useRoute, go } from './lib/store.jsx';
import { TabBar, Ambient } from './components.jsx';
import { enterScreen } from './lib/motion.js';
import Welcome from './screens/Welcome.jsx';
import Today from './screens/Today.jsx';
import Skin from './screens/Skin.jsx';
import CheckIn from './screens/CheckIn.jsx';
import Result from './screens/Result.jsx';
import Shelf from './screens/Shelf.jsx';
import Look from './screens/Look.jsx';
import Report from './screens/Report.jsx';
import FittingSheet from './screens/FittingSheet.jsx';
import Settings from './screens/Settings.jsx';
import Landing from './screens/Landing.jsx';

// The welcome page, reopened after setup: the main button returns to the journal,
// and the sample buttons are left out because loading the sample replaces the journal.
function WelcomeAgain() {
  return <Landing returning onStart={() => go('/today')} />;
}

const SCREENS = {
  '/today': Today,
  '/skin': Skin,
  '/checkin': CheckIn,
  '/result': Result,
  '/shelf': Shelf,
  '/look': Look,
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
  '/report': 'Care-team summary',
  '/fitting': 'Fitting sheet',
  '/settings': 'Settings',
  '/': 'Welcome',
  '/welcome': 'Welcome',
};

export default function App() {
  const { ready, profile } = useStore();
  const route = useRoute();
  const onboarding = !profile && route.path !== '/settings';
  // The welcome page is a full-width scroll story, so it opens at the top and without the tab bar.
  const landing = onboarding || WELCOME_PATHS.has(route.path);
  const firstView = useRef(true);
  const mainRef = useRef(null);

  // Each screen arrives with a short staggered fade-up, set before paint so nothing flashes.
  // The welcome page runs its own sequence.
  useLayoutEffect(() => {
    if (!ready) return;
    if (landing) {
      if (WELCOME_PATHS.has(route.path)) window.scrollTo(0, 0);
      return;
    }
    return enterScreen(mainRef.current);
  }, [ready, landing, route.path, route.param]);

  // Name each screen and move focus to its heading, so screen readers hear the change.
  useEffect(() => {
    if (!ready) return;
    document.title = `${onboarding ? 'Welcome' : TITLES[route.path] || 'Today'} · Ahead`;
    if (firstView.current) {
      firstView.current = false;
      return;
    }
    const h1 = document.querySelector('main h1');
    if (h1) {
      h1.setAttribute('tabindex', '-1');
      h1.focus({ preventScroll: true });
    }
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

  return (
    <>
      <Ambient />
      <main className="app" ref={mainRef}>
        <Screen param={route.param} />
      </main>
      {!landing && <TabBar path={route.path} />}
    </>
  );
}
