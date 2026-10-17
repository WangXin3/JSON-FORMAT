import { useEffect, useLayoutEffect, useMemo, useRef, forwardRef, useImperativeHandle } from 'react';
import { EditorState, Compartment, Annotation } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, rectangularSelection, placeholder } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab, undo, isolateHistory } from '@codemirror/commands';
import { bracketMatching, codeFolding, foldGutter, foldEffect, unfoldAll, HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { json } from '@codemirror/lang-json';
import { tags } from '@lezer/highlight';
import type { FoldRange } from '../core/json';
import { minimalTextChange } from '../core/editorSync';

const externalEdit = Annotation.define<boolean>();

const syntax = HighlightStyle.define([
  { tag: tags.propertyName, color: '#53618b' },
  { tag: tags.string, color: '#19856d' },
  { tag: tags.number, color: '#c07c38' },
  { tag: [tags.bool, tags.null], color: '#a064a7' },
  { tag: tags.punctuation, color: '#7d8797' },
]);

const theme = EditorView.theme({
  '&': { height: '100%', fontSize: '13px', backgroundColor: '#ffffff', color: '#344054' },
  '.cm-scroller': { overflow: 'auto', fontFamily: '"Cascadia Code", "JetBrains Mono", Consolas, monospace', lineHeight: '1.9' },
  '.cm-content': { padding: '20px 0', caretColor: '#168568', userSelect: 'text', '-webkit-user-select': 'text' },
  '.cm-line': { padding: '0 18px 0 8px' },
  '.cm-gutters': { backgroundColor: '#fff', color: '#bec5ce', border: 'none', paddingLeft: '12px', paddingRight: '5px' },
  '.cm-lineNumbers .cm-gutterElement': { minWidth: '25px' },
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: '#f7f9fa' },
  '.cm-foldGutter .cm-gutterElement': { cursor: 'pointer', padding: '0 3px' },
  '.cm-foldPlaceholder': { backgroundColor: '#edf5f1', color: '#418672', border: '1px solid #dbeae4', padding: '0 5px', borderRadius: '4px' },
  '&.cm-focused': { outline: 'none' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': { backgroundColor: '#b7dfd1 !important' },
  '.cm-placeholder': { color: '#abb3be' },
  '.cm-panels': { backgroundColor: '#f6f8fa', borderColor: '#e6e9ef' },
  '.cm-search': { fontFamily: 'inherit', padding: '8px' },
});

export type EditorHandle = {
  expand: () => void;
  collapse: () => void;
  focus: () => void;
  undo: () => boolean;
  goTo: (offset: number) => void;
};
type Props = {
  value: string; onChange?: (value: string) => void; readOnly?: boolean;
  showLineNumbers: boolean; label: string; folds?: FoldRange[];
};

export const JsonEditor = forwardRef<EditorHandle, Props>(function JsonEditor(props, ref) {
  const container = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const foldsByStart = useMemo(() => new Map(props.folds?.map((range) => [range.from, range])), [props.folds]);
  const latest = useRef({ ...props, foldsByStart });
  latest.current = { ...props, foldsByStart };
  const numbers = useRef(new Compartment());

  useImperativeHandle(ref, () => ({
    expand() { if (view.current) unfoldAll(view.current); },
    collapse() {
      if (!view.current) return;
      // Worker-generated ranges also cover sections outside the editor's incremental parse viewport.
      const ranges = latest.current.folds ?? [];
      unfoldAll(view.current);
      view.current.dispatch({ effects: ranges.map((range) => foldEffect.of(range)) });
    },
    focus() { view.current?.focus(); },
    undo() { return view.current ? undo(view.current) : false; },
    goTo(offset) {
      if (!view.current) return;
      const position = Math.min(offset, view.current.state.doc.length);
      view.current.dispatch({ selection: { anchor: position }, effects: EditorView.scrollIntoView(position, { y: 'center' }) });
      view.current.focus();
    },
  }), []);

  useEffect(() => {
    if (!container.current) return;
    const editor = new EditorView({
      parent: container.current,
      state: EditorState.create({
        doc: latest.current.value,
        extensions: [
          json(), theme, syntaxHighlighting(syntax), history(), rectangularSelection(), EditorView.lineWrapping,
          bracketMatching(), highlightSelectionMatches(), codeFolding({
            preparePlaceholder: (_state, range) => {
              const info = latest.current.foldsByStart.get(range.from);
              return info?.to === range.to ? info.arrayLength : undefined;
            },
            placeholderDOM: (view, onclick, arrayLength: number | undefined) => {
              const element = view.dom.ownerDocument.createElement('span');
              element.className = 'cm-foldPlaceholder';
              element.textContent = arrayLength === undefined ? '…' : `… ${arrayLength} 项`;
              element.title = arrayLength === undefined ? '点击展开' : `数组长度：${arrayLength}，点击展开`;
              element.setAttribute('role', 'button');
              element.setAttribute('aria-label', arrayLength === undefined ? '展开内容' : `展开数组（${arrayLength} 项）`);
              element.tabIndex = 0;
              element.addEventListener('click', onclick);
              element.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onclick(event); }
              });
              return element;
            },
          }),
          numbers.current.of(latest.current.showLineNumbers ? lineNumbers() : []),
          // Use the native caret/selection for editable text, including character-level mouse drags and IME.
          ...(latest.current.readOnly ? [drawSelection(), foldGutter({ openText: '⌄', closedText: '›' })] : [highlightActiveLine(), highlightActiveLineGutter()]),
          keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
          EditorState.readOnly.of(Boolean(latest.current.readOnly)),
          EditorView.editable.of(!latest.current.readOnly),
          EditorView.contentAttributes.of({ 'aria-label': latest.current.label, spellcheck: 'false', autocorrect: 'off', autocapitalize: 'off' }),
          placeholder(latest.current.readOnly ? '' : '在这里粘贴 JSON，或点击「载入示例」…'),
          EditorView.updateListener.of((update) => {
            if (update.docChanged && !update.transactions.some((transaction) => transaction.annotation(externalEdit))) {
              latest.current.onChange?.(update.state.doc.toString());
            }
          }),
        ],
      }),
    });
    view.current = editor;
    return () => { editor.destroy(); view.current = null; };
  }, []);

  // Synchronize before paint so a delayed prop echo cannot replace newer keystrokes or a mouse selection.
  useLayoutEffect(() => {
    const editor = view.current;
    if (editor) {
      const changes = minimalTextChange(editor.state.doc.toString(), props.value);
      if (changes) editor.dispatch({ changes, annotations: [isolateHistory.of('full'), externalEdit.of(true)] });
    }
  }, [props.value]);

  useEffect(() => {
    view.current?.dispatch({ effects: numbers.current.reconfigure(props.showLineNumbers ? lineNumbers() : []) });
  }, [props.showLineNumbers]);

  return <div className="editor-mount" ref={container} />;
});
