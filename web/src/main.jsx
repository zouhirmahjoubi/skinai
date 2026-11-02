import { createRoot } from 'react-dom/client';
import '@fontsource/atkinson-hyperlegible/latin-400.css';
import '@fontsource/atkinson-hyperlegible/latin-700.css';
import '@fontsource-variable/newsreader/opsz.css';
import '@fontsource-variable/newsreader/opsz-italic.css';
import '@fontsource/dm-mono/latin-500.css';
import './styles.css';
import { StoreProvider } from './lib/store.jsx';
import { applyPalette, getPalette } from './lib/palette.js';
import { applyLessMotion } from './lib/reduced.js';
import App from './App.jsx';
import ErrorBoundary from './ErrorBoundary.jsx';

// Apply the saved colour theme before the first paint, so it never flashes the default.
applyPalette(getPalette());
applyLessMotion();

// The welcome page is the likely first screen at the home address: start its
// first painting and code early, without making the journal screens wait for them.
if (!window.location.hash || window.location.hash === '#/') {
  const link = document.createElement('link');
  link.rel = 'preload';
  link.as = 'image';
  link.href = window.matchMedia('(max-aspect-ratio: 1/1)').matches ? '/scenes/hero-t.webp' : '/scenes/hero-w.webp';
  link.fetchPriority = 'high';
  document.head.append(link);
  import('./screens/Landing.jsx').catch(() => {}); // the screen itself reports a failure
}

createRoot(document.getElementById('root')).render(
  <ErrorBoundary>
    <StoreProvider>
      <App />
    </StoreProvider>
  </ErrorBoundary>,
);
