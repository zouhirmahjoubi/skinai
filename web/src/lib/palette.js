// Colour themes: Fresco (the default, from the welcome page's paintings), Lotus,
// Orchard Market and Cream. The tokens live in styles.css under
// :root[data-palette]; this only remembers the choice in this browser and sets
// the attribute. Status colours never change with the theme.

import { useEffect, useState } from 'react';

export const PALETTES = [
  { id: 'fresco', name: 'Fresco', swatches: ['#f5eee0', '#0f4c63', '#d4ae5c'] },
  { id: 'lotus', name: 'Lotus', swatches: ['#e8dcc6', '#1f3b2e', '#cbb3e8'] },
  { id: 'orchard', name: 'Orchard Market', swatches: ['#f9ead7', '#bfe23a', '#e10600'] },
  { id: 'cream', name: 'Cream', swatches: ['#c9a0a7', '#3a0f34', '#c75a3a'] },
];

// A new key, so a theme picked while testing the old design doesn't hide the new default.
const KEY = 'still-me-palette';
const valid = (id) => PALETTES.some((p) => p.id === id);

export function getPalette() {
  try {
    const id = localStorage.getItem(KEY);
    return valid(id) ? id : 'fresco';
  } catch {
    return 'fresco';
  }
}

/** Sets the theme on <html> and tells the background shader to re-read its colours. */
export function applyPalette(id) {
  const root = document.documentElement;
  if (id === 'fresco' || !valid(id)) delete root.dataset.palette;
  else root.dataset.palette = id;
  window.dispatchEvent(new Event('palettechange'));
}

export function setPalette(id) {
  try {
    localStorage.setItem(KEY, id);
  } catch {
    // Private mode or blocked storage: the theme still applies for this visit.
  }
  applyPalette(id);
}

export function usePalette() {
  const [palette, setState] = useState(getPalette);
  useEffect(() => {
    const on = () => setState(document.documentElement.dataset.palette || 'fresco');
    window.addEventListener('palettechange', on);
    return () => window.removeEventListener('palettechange', on);
  }, []);
  return [palette, setPalette];
}
