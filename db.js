// db.js — a tiny wrapper around IndexedDB (the browser's built-in database).
// Two "tables" (object stores):
//   kv       – simple key/value settings: programs, maxes, settings, in-progress workout
//   sessions – one record per completed workout
const DB_NAME = 'gymtracker';
const DB_VERSION = 1;
let _db = null;

function openDB() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      if (!db.objectStoreNames.contains('sessions')) {
        const s = db.createObjectStore('sessions', { keyPath: 'id' });
        s.createIndex('date', 'date');
      }
    };
    req.onsuccess = () => { _db = req.result; resolve(_db); };
    req.onerror = () => reject(req.error);
  });
}

// Run one operation inside a transaction and resolve with its result.
function tx(store, mode, fn) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const r = fn(t.objectStore(store));
    t.oncomplete = () => resolve(r && 'result' in r ? r.result : undefined);
    t.onerror = () => reject(t.error);
  }));
}

const DB = {
  get: key => tx('kv', 'readonly', s => s.get(key)),
  set: (key, val) => tx('kv', 'readwrite', s => s.put(val, key)),
  del: key => tx('kv', 'readwrite', s => s.delete(key)),
  allSessions: () => tx('sessions', 'readonly', s => s.getAll()),
  putSession: obj => tx('sessions', 'readwrite', s => s.put(obj)),
  delSession: id => tx('sessions', 'readwrite', s => s.delete(id)),
  clearSessions: () => tx('sessions', 'readwrite', s => s.clear()),
};
