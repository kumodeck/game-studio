// A tiny key–value store in IndexedDB for the browser-only demo host.
//
// WHY IndexedDB and not localStorage: assets added from the Library are files
// (Blobs) and can be megabytes; localStorage holds strings only and ~5 MB in
// all. The JSON results go to the same store so one place holds a game's state.
//
// When IndexedDB is not there (some private windows, blocked site data) the
// store falls back to memory: the editor still works, only a reload forgets.
// `persistent` tells the page which one it got.

const DB_NAME = 'kumodeck-game-studio-demo';
const STORE = 'kv';

export interface KvStore {
  get<T = unknown>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  /** Every [key, value] whose key starts with `prefix`. */
  list<T = unknown>(prefix: string): Promise<Array<[string, T]>>;
  readonly persistent: boolean;
}

function memoryStore(): KvStore {
  const m = new Map<string, unknown>();
  return {
    persistent: false,
    async get<T>(k: string) {
      return m.get(k) as T | undefined;
    },
    async set(k, v) {
      m.set(k, v);
    },
    async list<T>(prefix: string) {
      return [...m].filter(([k]) => k.startsWith(prefix)) as Array<[string, T]>;
    },
  };
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export async function openStore(): Promise<KvStore> {
  let db: IDBDatabase;
  try {
    const open = indexedDB.open(DB_NAME, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE);
    db = await req(open);
  } catch {
    return memoryStore();
  }
  const tx = (mode: IDBTransactionMode) => db.transaction(STORE, mode).objectStore(STORE);
  return {
    persistent: true,
    async get<T>(k: string) {
      return (await req(tx('readonly').get(k))) as T | undefined;
    },
    async set(k, v) {
      const s = tx('readwrite');
      await req(s.put(v, k));
    },
    async list<T>(prefix: string) {
      // '￿' closes the range: every key that starts with prefix.
      const range = IDBKeyRange.bound(prefix, prefix + '￿');
      const s = tx('readonly');
      const [keys, values] = await Promise.all([req(s.getAllKeys(range)), req(s.getAll(range))]);
      return keys.map((k, i) => [String(k), values[i] as T]);
    },
  };
}
