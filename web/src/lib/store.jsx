import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { db } from './db.js';
import { api } from './api.js';
import { compareCheckin } from '../../../core/trends.js';
import { watchNotes } from '../../../core/insights.js';
import { sampleJourney } from '../../../core/sample.js';

const Ctx = createContext(null);
const byDate = (a, b) => (a.date === b.date ? (a.createdAt || '').localeCompare(b.createdAt || '') : a.date < b.date ? -1 : 1);

export function StoreProvider({ children }) {
  const [ready, setReady] = useState(false);
  const [profile, setProfile] = useState(null);
  const [checkins, setCheckins] = useState([]);
  const [print, setPrint] = useState(null);
  const [looks, setLooks] = useState([]);
  const [server, setServer] = useState({ mode: 'unknown', accessCodeRequired: false });

  useEffect(() => {
    (async () => {
      try {
        const [p, c, pr, l] = await Promise.all([db.get('profile'), db.all('checkins'), db.get('print'), db.all('looks')]);
        setProfile(p || null);
        setCheckins((c || []).sort(byDate));
        setPrint(pr || null);
        setLooks((l || []).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)));
      } catch (err) {
        console.warn('Local storage unavailable', err);
      }
      setReady(true);
    })();
    api.status().then(setServer).catch(() => setServer({ mode: 'offline', accessCodeRequired: false }));
  }, []);

  const saveProfile = useCallback(async (p) => {
    await db.set('profile', p);
    setProfile(p);
  }, []);

  const addCheckin = useCallback(async (c) => {
    await db.put('checkins', c);
    setCheckins((list) => [...list.filter((x) => x.id !== c.id), c].sort(byDate));
  }, []);

  const deleteCheckin = useCallback(async (id) => {
    await db.remove('checkins', id);
    setCheckins((list) => list.filter((x) => x.id !== id));
  }, []);

  const savePrint = useCallback(async (p) => {
    await db.set('print', p);
    setPrint(p);
  }, []);

  const addLook = useCallback(async (l) => {
    await db.put('looks', l);
    setLooks((list) => [l, ...list.filter((x) => x.id !== l.id)]);
  }, []);

  const removeLook = useCallback(async (id) => {
    await db.remove('looks', id);
    setLooks((list) => list.filter((x) => x.id !== id));
  }, []);

  const resetAll = useCallback(async () => {
    await db.clearAll();
    setProfile(null);
    setCheckins([]);
    setPrint(null);
    setLooks([]);
  }, []);

  const loadSample = useCallback(async () => {
    await db.clearAll();
    const s = sampleJourney();
    await db.set('profile', s.profile);
    await db.set('print', s.print);
    for (const c of s.checkins) await db.put('checkins', c);
    setProfile(s.profile);
    setPrint(s.print);
    setCheckins([...s.checkins].sort(byDate));
    setLooks([]);
  }, []);

  const value = useMemo(
    () => ({ ready, profile, checkins, print, looks, server, saveProfile, addCheckin, deleteCheckin, savePrint, addLook, removeLook, resetAll, loadSample }),
    [ready, profile, checkins, print, looks, server, saveProfile, addCheckin, deleteCheckin, savePrint, addLook, removeLook, resetAll, loadSample],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useStore = () => useContext(Ctx);

/** Comparison + watch notes for one check-in (default: the latest). */
export function useInsights(checkinId) {
  const { checkins, profile } = useStore();
  return useMemo(() => {
    const current = checkinId ? checkins.find((c) => c.id === checkinId) : checkins[checkins.length - 1];
    if (!current) return { current: null, comparison: null, notes: [] };
    const comparison = compareCheckin(checkins, current);
    const notes = watchNotes(profile, comparison, new Date(`${current.date}T12:00:00`));
    return { current, comparison, notes };
  }, [checkins, profile, checkinId]);
}

// Minimal hash router: "#/skin/abc" -> { path: '/skin', param: 'abc' }.
export function useRoute() {
  const read = () => {
    const h = window.location.hash.replace(/^#/, '') || '/';
    const [, first = '', second = ''] = h.split('/');
    return { path: `/${first}`, param: decodeURIComponent(second || '') };
  };
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const on = () => {
      setRoute(read());
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

export const go = (path) => {
  window.location.hash = path;
};
