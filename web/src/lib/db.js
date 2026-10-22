// On-device journal (IndexedDB). Photos and results never live on our server.

const DB_NAME = 'ahead';
const VERSION = 1;
let dbPromise;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
        if (!db.objectStoreNames.contains('checkins')) db.createObjectStore('checkins', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('looks')) db.createObjectStore('looks', { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function tx(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    const result = fn(s);
    t.oncomplete = () => resolve(result instanceof IDBRequest ? result.result : result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export const db = {
  get: (key) => tx('kv', 'readonly', (s) => s.get(key)),
  set: (key, value) => tx('kv', 'readwrite', (s) => s.put(value, key)),
  del: (key) => tx('kv', 'readwrite', (s) => s.delete(key)),
  all: (store) => tx(store, 'readonly', (s) => s.getAll()),
  put: (store, value) => tx(store, 'readwrite', (s) => s.put(value)),
  remove: (store, id) => tx(store, 'readwrite', (s) => s.delete(id)),
  async clearAll() {
    for (const store of ['kv', 'checkins', 'looks']) await tx(store, 'readwrite', (s) => s.clear());
  },
  /** Replaces the journal in one transaction, so a failed restore changes nothing. Saved try-on photos are kept. */
  async replaceJournal({ profile, print, list, checkins, looks }) {
    const d = await open();
    return new Promise((resolve, reject) => {
      const t = d.transaction(['kv', 'checkins', 'looks'], 'readwrite');
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error('Restore aborted'));
      try {
        const kv = t.objectStore('kv');
        kv.put(profile, 'profile');
        if (print) kv.put(print, 'print');
        else kv.delete('print');
        kv.put(list, 'list');
        const cs = t.objectStore('checkins');
        cs.clear();
        for (const c of checkins) cs.put(c);
        const ls = t.objectStore('looks');
        ls.clear();
        for (const l of looks) ls.put(l);
      } catch (e) {
        // A synchronous DataError doesn't abort the transaction by itself.
        try {
          t.abort();
        } catch {
          /* already finished */
        }
        reject(e);
      }
    });
  },
};

export const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
