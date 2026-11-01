import { createRoot } from 'react-dom/client';
import '@fontsource/atkinson-hyperlegible/latin-400.css';
import '@fontsource/atkinson-hyperlegible/latin-700.css';
import '@fontsource/literata/latin-600.css';
import '@fontsource/literata/latin-400-italic.css';
import './styles.css';
import { StoreProvider } from './lib/store.jsx';
import { applyPalette, getPalette } from './lib/palette.js';
import { applyLessMotion } from './lib/reduced.js';
import App from './App.jsx';

// Apply the saved colour theme before the first paint, so it never flashes the default.
applyPalette(getPalette());
applyLessMotion();

// The welcome page is the likely first screen at the home address: start its
// portrait and code early, without making the journal screens wait for them.
if (!window.location.hash || window.location.hash === '#/') {
  const link = document.createElement('link');
  link.rel = 'preload';
  link.as = 'image';
  link.href = '/portrait/portrait.webp';
  link.fetchPriority = 'high';
  document.head.append(link);
  import('./screens/Landing.jsx');
}

createRoot(document.getElementById('root')).render(
  <StoreProvider>
    <App />
  </StoreProvider>,
);
