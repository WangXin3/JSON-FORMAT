import { describe, expect, it } from 'vitest';
import { EditorState, EditorSelection } from '@codemirror/state';
import { minimalTextChange } from './editorSync';

describe('editor synchronization preserves character selections', () => {
  it('does not dispatch a replacement for an echo of local typing', () => {
    expect(minimalTextChange('{"project":1}', '{"project":1}')).toBeUndefined();
  });

  it('keeps a partial key selection when another field is updated', () => {
    const before = '{"project":1,"value":10}';
    const state = EditorState.create({ doc: before, selection: EditorSelection.range(4, 6) });
    const next = state.update({ changes: minimalTextChange(before, '{"project":1,"value":100}') }).state;
    expect(next.sliceDoc(next.selection.main.from, next.selection.main.to)).toBe('oj');
    expect(next.selection.main.anchor).toBe(4);
    expect(next.selection.main.head).toBe(6);
    const replaced = next.update(next.replaceSelection('X')).state;
    expect(replaced.doc.toString()).toBe('{"prXect":1,"value":100}');
  });

  it('retains the insertion point inside a key after an unrelated update', () => {
    const before = '{"project":1}';
    const state = EditorState.create({ doc: before, selection: { anchor: 4 } });
    const next = state.update({ changes: minimalTextChange(before, '{"project":123}') }).state;
    expect(next.selection.main.head).toBe(4);
    expect(next.update(next.replaceSelection('x')).state.doc.toString()).toBe('{"prxoject":123}');
  });

  it.each([
    ['', '{"名称":1}'],
    ['{"名称":1}', ''],
    ['{"名称":1}', '{"新名称":1}'],
    ['{"a":1}', '{\n  "a": 1\n}'],
  ])('applies external text exactly: %s → %s', (before, after) => {
    const state = EditorState.create({ doc: before });
    expect(state.update({ changes: minimalTextChange(before, after) }).state.doc.toString()).toBe(after);
  });
});
