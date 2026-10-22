import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { db } from './db.js';
import { api } from './api.js';
import { compareCheckin } from '../../../core/trends.js';
import { watchNotes } from '../../../core/insights.js';
import { sampleJourney } from '../../../core/sample.js';

const Ctx = createContext(null);
const byDate = (a, b) => (a.date === b.date ? (a.createdAt || '').localeCompare(b.createdAt || '') : a.date < b.date ? -1 : 1);
const newestFirst = (a, b) => (a.createdAt < b.createdAt ? 1 : -1);

// Browsers (Safari especially) may clear site data that isn't marked
// persistent. Asked only after the person has saved something, so the
// permission prompt some browsers show makes sense.
function requestPersistence() {
  try {
    const s = navigator.storage;
    if (s?.persist && s?.persisted) s.persisted().then((p) => (p ? null : s.persist())).catch(() => {});
  } catch {
    /* unsupported */
  }
}

export function StoreProvider({ children }) {
  const [ready, setReady] = useState(false);
  const [profile, setProfile] = useState(null);
  const [checkins, setCheckins] = useState([]);
  const [print, setPrint] = useState(null);
  const [looks, setLooks] = useState([]);
  const [list, setList] = useState([]);
  const [server, setServer] = useState({ mode: 'unknown', accessCodeRequired: false });

  useEffect(() => {
    (async () => {
      try {
        const [p, c, pr, l, li] = await Promise.all([db.get('profile'), db.all('checkins'), db.get('print'), db.all('looks'), db.get('list')]);
        setProfile(p || null);
        setCheckins((c || []).sort(byDate));
        setPrint(pr || null);
        setLooks((l || []).sort(newestFirst));
        setList(Array.isArray(li) ? li : []);
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
    requestPersistence();
  }, []);

  const addCheckin = useCallback(async (c) => {
    await db.put('checkins', c);
    setCheckins((all) => [...all.filter((x) => x.id !== c.id), c].sort(byDate));
  }, []);

  const deleteCheckin = useCallback(async (id) => {
    await db.remove('checkins', id);
    setCheckins((all) => all.filter((x) => x.id !== id));
  }, []);

  const savePrint = useCallback(async (p) => {
    await db.set('print', p);
    setPrint(p);
    requestPersistence();
  }, []);

  const addLook = useCallback(async (l) => {
    await db.put('looks', l);
    setLooks((all) => [l, ...all.filter((x) => x.id !== l.id)]);
  }, []);

  const removeLook = useCallback(async (id) => {
    await db.remove('looks', id);
    setLooks((all) => all.filter((x) => x.id !== id));
  }, []);

  /** "My list": product ids the person plans to buy or use, shown to the care team. */
  const toggleList = useCallback((id) => {
    setList((cur) => {
      const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
      db.set('list', next).catch((e) => console.warn('List not saved', e));
      return next;
    });
  }, []);

  const resetAll = useCallback(async () => {
    await db.clearAll();
    setProfile(null);
    setCheckins([]);
    setPrint(null);
    setLooks([]);
    setList([]);
  }, []);

  const loadSample = useCallback(async () => {
    await db.clearAll();
    const s = sampleJourney();
    // Sam saved an acne gel in week 1; by week 3 the shelf flags it.
    const demoList = ['sg-oat-cream', 'sc-bp-gel'];
    await db.set('profile', s.profile);
    await db.set('print', s.print);
    await db.set('list', demoList);
    for (const c of s.checkins) await db.put('checkins', c);
    setProfile(s.profile);
    setPrint(s.print);
    setCheckins([...s.checkins].sort(byDate));
    setLooks([]);
    setList(demoList);
  }, []);

  /** Restores a journal downloaded from Settings. */
  const importJournal = useCallback(async (data) => {
    if (!data || !data.profile || !Array.isArray(data.checkins)) throw new Error('Not an Ahead journal file');
    await db.clearAll();
    await db.set('profile', data.profile);
    if (data.print) await db.set('print', data.print);
    if (Array.isArray(data.list)) await db.set('list', data.list);
    for (const c of data.checkins) await db.put('checkins', c);
    for (const l of data.looks || []) await db.put('looks', l);
    setProfile(data.profile);
    setPrint(data.print || null);
    setCheckins([...data.checkins].sort(byDate));
    setLooks([...(data.looks || [])].sort(newestFirst));
    setList(Array.isArray(data.list) ? data.list : []);
    requestPersistence();
  }, []);

  const value = useMemo(
    () => ({ ready, profile, checkins, print, looks, list, server, saveProfile, addCheckin, deleteCheckin, savePrint, addLook, removeLook, toggleList, resetAll, loadSample, importJournal }),
    [ready, profile, checkins, print, looks, list, server, saveProfile, addCheckin, deleteCheckin, savePrint, addLook, removeLook, toggleList, resetAll, loadSample, importJournal],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useStore = () => useContext(Ctx);

/**
 * Comparison + watch notes for one check-in (default: the latest, preferring
 * the person's own check-ins over the sample journey).
 */
export function useInsights(checkinId) {
  const { checkins, profile, print } = useStore();
  return useMemo(() => {
    const real = checkins.filter((c) => !c.sample);
    const current = checkinId ? checkins.find((c) => c.id === checkinId) : (real.length ? real : checkins)[(real.length ? real : checkins).length - 1];
    if (!current) return { current: null, comparison: null, notes: [] };
    const comparison = compareCheckin(checkins, current);
    const notes = watchNotes(profile, comparison, new Date(`${current.date}T12:00:00`), { skinHex: print?.colors?.skin_color });
    return { current, comparison, notes };
  }, [checkins, profile, print, checkinId]);
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
