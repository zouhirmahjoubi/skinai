// The Ask conversation for this visit, kept outside the screen so that leaving
// Ask (to add a portrait, say) doesn't lose the chat or a plan that's running.
// In memory only; it goes when the tab closes or the journal changes.

import { useEffect, useReducer } from 'react';

const listeners = new Set();
const fresh = () => ({ messages: [], plans: {} });
let session = fresh();

export const askSession = () => session;

export function updateAsk(fn) {
  fn(session);
  listeners.forEach((l) => l());
}

export function clearAskSession() {
  session = fresh();
  listeners.forEach((l) => l());
}

export function useAskSession() {
  const [, render] = useReducer((n) => n + 1, 0);
  useEffect(() => {
    listeners.add(render);
    return () => listeners.delete(render);
  }, []);
  return session;
}
