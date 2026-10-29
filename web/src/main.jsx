import { createRoot } from 'react-dom/client';
import '@fontsource/atkinson-hyperlegible/latin-400.css';
import '@fontsource/atkinson-hyperlegible/latin-700.css';
import '@fontsource/literata/latin-600.css';
import '@fontsource/literata/latin-400-italic.css';
import './styles.css';
import { StoreProvider } from './lib/store.jsx';
import { applyPalette, getPalette } from './lib/palette.js';
import App from './App.jsx';

// Apply the saved colour theme before the first paint, so it never flashes the default.
applyPalette(getPalette());

createRoot(document.getElementById('root')).render(
  <StoreProvider>
    <App />
  </StoreProvider>,
);
