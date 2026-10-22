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

export default function App() {
  const { ready, profile } = useStore();
  const route = useRoute();

  if (!ready) {
    return (
      <main className="app">
        <p className="muted center" style={{ marginTop: '40vh' }}>Opening your journal…</p>
      </main>
    );
  }

  const onboarding = !profile && route.path !== '/settings';
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
