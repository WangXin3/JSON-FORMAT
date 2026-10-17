import { isTauri } from '@tauri-apps/api/core';
import type Database from '@tauri-apps/plugin-sql';
import { byteSize } from './json';

export type Settings = { lineNumbers: boolean; indent: 2 | 4; historyEnabled: boolean };
export const DEFAULT_SETTINGS: Settings = { lineNumbers: true, indent: 2, historyEnabled: true };
export type HistoryItem = { id: string; preview: string; createdAt: number; bytes: number; action: 'format' | 'unescape' };
export type HistoryRecord = HistoryItem & { source: string };
export const HISTORY_LIMIT = 100;
export const HISTORY_BYTES = 50 * 1024 * 1024;

export function retainedHistory(items: HistoryItem[]): HistoryItem[] {
  let total = 0;
  return [...items].sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id)).filter((item, index) => {
    total += item.bytes;
    return index < HISTORY_LIMIT && total <= HISTORY_BYTES;
  });
}

function readSettings(value: unknown): Settings {
  const v = (value && typeof value === 'object' ? value : {}) as Partial<Settings>;
  return {
    lineNumbers: typeof v.lineNumbers === 'boolean' ? v.lineNumbers : true,
    indent: v.indent === 4 ? 4 : 2,
    historyEnabled: typeof v.historyEnabled === 'boolean' ? v.historyEnabled : true,
  };
}

let sql: Promise<Database> | undefined;
async function sqlite() {
  sql ??= (async () => {
    const { default: Database } = await import('@tauri-apps/plugin-sql');
    return Database.load('sqlite:json-format.db');
  })();
  return sql;
}

let browserDb: Promise<IDBDatabase> | undefined;
function indexedDb(): Promise<IDBDatabase> {
  browserDb ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('json-format', 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('history', { keyPath: 'id' });
      request.result.createObjectStore('settings');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('本地数据库正在被其他窗口使用'));
  });
  return browserDb;
}

async function browserRead<T>(store: string, key?: string): Promise<T> {
  const db = await indexedDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const request = key === undefined ? tx.objectStore(store).getAll() : tx.objectStore(store).get(key);
    request.onsuccess = () => resolve(request.result as T);
    request.onerror = () => reject(request.error);
  });
}

async function browserWrite(store: string, action: (store: IDBObjectStore) => void): Promise<void> {
  const db = await indexedDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('本地保存已中断'));
    action(tx.objectStore(store));
  });
}

// Serialize mutations so a fast save/delete sequence cannot undo a later action.
let mutation: Promise<unknown> = Promise.resolve();
function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const next = mutation.then(task, task);
  mutation = next.catch(() => {});
  return next;
}

export async function loadSettings(): Promise<Settings> {
  if (isTauri()) {
    const rows = await (await sqlite()).select<{ value: string }[]>('SELECT value FROM settings WHERE key = $1', ['preferences']);
    return readSettings(rows[0] ? JSON.parse(rows[0].value) : null);
  }
  return readSettings(await browserRead('settings', 'preferences'));
}

export function saveSettings(settings: Settings) {
  return enqueue(async () => {
    if (isTauri()) {
      await (await sqlite()).execute('INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET value = excluded.value', ['preferences', JSON.stringify(settings)]);
    } else {
      await browserWrite('settings', (store) => { store.put(settings, 'preferences'); });
    }
  });
}

export async function listHistory(): Promise<HistoryItem[]> {
  await mutation;
  if (isTauri()) return (await sqlite()).select<HistoryItem[]>(
    'SELECT id, preview, created_at AS createdAt, bytes, action FROM history ORDER BY created_at DESC, id ASC',
  );
  return (await browserRead<HistoryRecord[]>('history')).sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id))
    .map(({ source: _source, ...item }) => item);
}

export async function getHistory(id: string): Promise<HistoryRecord | undefined> {
  await mutation;
  if (isTauri()) return (await (await sqlite()).select<HistoryRecord[]>(
    'SELECT id, preview, source, created_at AS createdAt, bytes, action FROM history WHERE id = $1', [id],
  ))[0];
  return browserRead<HistoryRecord | undefined>('history', id);
}

export function addHistory(source: string, action: HistoryItem['action']) {
  return enqueue(async () => {
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source));
    const id = Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('');
    const record: HistoryRecord = {
      id, source, action, bytes: byteSize(source), createdAt: Date.now(),
      preview: source.replace(/\s+/g, ' ').slice(0, 150),
    };
    if (isTauri()) {
      const db = await sqlite();
      await db.execute('INSERT INTO history (id, source, preview, created_at, bytes, action) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT(id) DO UPDATE SET created_at = excluded.created_at, action = excluded.action',
        [record.id, record.source, record.preview, record.createdAt, record.bytes, record.action]);
      const items = await db.select<HistoryItem[]>('SELECT id, bytes, created_at AS createdAt FROM history ORDER BY created_at DESC');
      const keep = new Set(retainedHistory(items).map((item) => item.id));
      const remove = items.filter((item) => !keep.has(item.id)).map((item) => item.id);
      if (remove.length) await db.execute(`DELETE FROM history WHERE id IN (${remove.map((_, i) => `$${i + 1}`).join(',')})`, remove);
    } else {
      await browserWrite('history', (store) => {
        store.put(record);
        const all = store.getAll();
        all.onsuccess = () => {
          const items = all.result as HistoryRecord[];
          const keep = new Set(retainedHistory(items).map((item) => item.id));
          items.filter((item) => !keep.has(item.id)).forEach((item) => store.delete(item.id));
        };
      });
    }
  });
}

export function deleteHistory(id: string) {
  return enqueue(async () => {
    if (isTauri()) await (await sqlite()).execute('DELETE FROM history WHERE id = $1', [id]);
    else await browserWrite('history', (store) => { store.delete(id); });
  });
}

export function clearHistory() {
  return enqueue(async () => {
    if (isTauri()) await (await sqlite()).execute('DELETE FROM history');
    else await browserWrite('history', (store) => { store.clear(); });
  });
}

export async function copyText(text: string): Promise<void> {
  if (isTauri()) {
    const { writeText } = await import('@tauri-apps/plugin-clipboard-manager');
    await writeText(text);
  } else {
    await navigator.clipboard.writeText(text);
  }
}
