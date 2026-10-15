import { useEffect, useRef } from 'react';
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, highlightSpecialChars } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { syntaxHighlighting, HighlightStyle, bracketMatching, foldGutter, indentOnInput } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import { defaultKeymap, history, historyKeymap, indentWithTab, undo, redo, toggleComment } from '@codemirror/commands';
import { searchKeymap, highlightSelectionMatches, openSearchPanel } from '@codemirror/search';
import { closeBrackets, closeBracketsKeymap, autocompletion, completionKeymap } from '@codemirror/autocomplete';
import { latex } from 'codemirror-lang-latex';

// The same CodeMirror 6 stack and CSS palette as Aldine's CodePane,
// minus its mandatory WebSocket/Yjs backend dependency.
interface Props {
  path: string;
  jump?: { line: number; tick: number };
  command?: { action: 'undo' | 'redo' | 'search' | 'comment' | 'math'; path: string; tick: number };
  value: string;
  onChange(value: string): void;
  onCompile(): void;
}
const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.tagName, t.macroName, t.function(t.variableName)], color: 'var(--syn-command)' },
  { tag: [t.comment, t.lineComment, t.blockComment], color: 'var(--syn-comment)', fontStyle: 'italic' },
  { tag: [t.string, t.attributeValue], color: 'var(--syn-string)' },
  { tag: [t.number, t.literal, t.escape, t.labelName, t.typeName], color: 'var(--syn-value)' },
  { tag: [t.heading], color: 'var(--text)', fontWeight: '600' },
]);
const theme = EditorView.theme({
  '&': { backgroundColor: 'var(--bg-panel)', color: 'var(--text)' },
  '.cm-cursor': { borderLeftColor: 'var(--text)' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { backgroundColor: 'var(--selection) !important' },
  '.cm-tooltip': { backgroundColor: 'var(--bg-panel)', color: 'var(--text)', border: '1px solid var(--hairline)' },
  '.cm-tooltip-autocomplete ul li[aria-selected]': { backgroundColor: 'var(--accent-fill)', color: 'var(--on-accent)' },
});
export default function OfflineCodePane({ path, value, jump, command, onChange, onCompile }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onCompileRef = useRef(onCompile);
  onChangeRef.current = onChange;
  onCompileRef.current = onCompile;
  useEffect(() => {
    if (!host.current) return;
    const instance = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(), highlightActiveLineGutter(), highlightActiveLine(), highlightSpecialChars(),
          drawSelection(), indentOnInput(), bracketMatching(), foldGutter(),
          latex(), syntaxHighlighting(highlight), theme,
          history(), autocompletion(), closeBrackets(), highlightSelectionMatches(),
          keymap.of([
            { key: 'Mod-s', run: () => { onCompileRef.current(); return true; } },
            ...closeBracketsKeymap, ...completionKeymap, ...searchKeymap, ...historyKeymap,
            indentWithTab, ...defaultKeymap,
          ]),
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({ 'aria-label': path, spellcheck: 'false' }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) onChangeRef.current(update.state.doc.toString());
          }),
        ],
      }),
    });
    view.current = instance;
    return () => { view.current = null; instance.destroy(); };
  }, [path]);
  useEffect(() => {
    const instance = view.current;
    if (!instance || instance.state.doc.toString() === value) return;
    instance.dispatch({ changes: { from: 0, to: instance.state.doc.length, insert: value } });
  }, [value]);
  useEffect(() => {
    const instance = view.current;
    if (!instance || !jump) return;
    const line = instance.state.doc.line(Math.min(instance.state.doc.lines, Math.max(1, jump.line)));
    instance.dispatch({ selection: { anchor: line.from }, effects: EditorView.scrollIntoView(line.from, { y: 'center' }) });
    instance.focus();
  }, [jump]);
  useEffect(() => {
    const instance = view.current;
    if (!instance || !command || command.path !== path) return;
    if (command.action === 'undo') undo(instance);
    else if (command.action === 'redo') redo(instance);
    else if (command.action === 'search') openSearchPanel(instance);
    else if (command.action === 'comment') toggleComment(instance);
    else if (command.action === 'math') {
      const selection = instance.state.selection.main;
      const original = instance.state.sliceDoc(selection.from, selection.to);
      // Insert a well-formed display-math environment and place the caret inside.
      const insertion = '\\[' + '\n' + original + '\n' + '\\]';
      instance.dispatch({
        changes: { from: selection.from, to: selection.to, insert: insertion },
        selection: { anchor: selection.from + 3 }
      });
    }
    instance.focus();
  }, [command, path]);
  return <div ref={host} className="code-pane" data-testid="code-pane" />;
}
