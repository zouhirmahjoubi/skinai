import { useEffect, useRef } from 'react';
import { useStore, useRoute } from './lib/store.jsx';
import { TabBar } from './components.jsx';
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
};

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
};

export default function App() {
  const { ready, profile } = useStore();
  const route = useRoute();
  const onboarding = !profile && route.path !== '/settings';
  const firstView = useRef(true);

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
      <main className="app">
        <p className="muted center" style={{ marginTop: '40vh' }}>Opening your journal…</p>
      </main>
    );
  }

  const Screen = onboarding ? Welcome : SCREENS[route.path] || Today;

  return (
    <>
      <main className="app">
        <Screen param={route.param} />
      </main>
      {!onboarding && <TabBar path={route.path} />}
    </>
  );
}
