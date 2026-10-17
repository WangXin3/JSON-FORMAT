import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { addHistory, clearHistory, DEFAULT_SETTINGS, deleteHistory, getHistory, HISTORY_BYTES, listHistory, loadSettings, retainedHistory, saveSettings, type HistoryItem } from './storage';

describe('history persistence and preferences', () => {
  beforeEach(async () => { await clearHistory(); await saveSettings(DEFAULT_SETTINGS); });

  it('persists the complete source and deduplicates identical input', async () => {
    const source = '{"id":900719925474099312345,"text":"张 三"}';
    await addHistory(source, 'format');
    await addHistory(source, 'unescape');
    const rows = await listHistory();
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe('unescape');
    expect((await getHistory(rows[0].id))?.source).toBe(source);
    expect(rows[0]).not.toHaveProperty('source');
  });

  it('keeps only the newest 100 entries', async () => {
    for (let i = 0; i < 105; i++) await addHistory(`{"id":${i}}`, 'format');
    expect(await listHistory()).toHaveLength(100);
  });

  it('retains only entries within the total byte budget', () => {
    const items = Array.from({ length: 12 }, (_, i) => ({ id: String(i), bytes: HISTORY_BYTES / 5, createdAt: i, preview: '', action: 'format' as const }));
    const retained = retainedHistory(items);
    expect(retained).toHaveLength(5);
    expect(retained.map((i) => i.id)).toEqual(['11', '10', '9', '8', '7']);
  });

  it('serializes save/delete operations and deletes only the requested record', async () => {
    await Promise.all([addHistory('{"a":1}', 'format'), addHistory('{"b":2}', 'format')]);
    const rows = await listHistory();
    await deleteHistory(rows[0].id);
    expect(await getHistory(rows[0].id)).toBeUndefined();
    expect(await listHistory()).toHaveLength(1);
    await clearHistory();
    expect(await listHistory()).toHaveLength(0);
  });

  it('persists all settings across repository reads', async () => {
    expect(await loadSettings()).toEqual(DEFAULT_SETTINGS);
    await saveSettings({ lineNumbers: false, indent: 4, historyEnabled: false });
    expect(await loadSettings()).toEqual({ lineNumbers: false, indent: 4, historyEnabled: false });
  });

  it('sorts tied timestamps deterministically', () => {
    const items: HistoryItem[] = ['b', 'a'].map((id) => ({ id, bytes: 1, createdAt: 1, preview: '', action: 'format' }));
    expect(retainedHistory(items).map((i) => i.id)).toEqual(['a', 'b']);
  });
});
