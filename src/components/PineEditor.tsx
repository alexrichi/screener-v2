import { useCallback, useMemo, useRef } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import {
  closeBrackets,
  closeBracketsKeymap,
  autocompletion,
  completionKeymap,
} from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import {
  bracketMatching,
  foldGutter,
  foldService,
  indentOnInput,
  indentUnit,
} from '@codemirror/language';
import { lintGutter } from '@codemirror/lint';
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
import {
  crosshairCursor,
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  rectangularSelection,
} from '@codemirror/view';
import {
  pineCompletions,
  pineLanguage,
  pineLinter,
  pineThemeExtensions,
} from '@screener/pine-editor';
import { cn } from '../ui/cn';

const indentFold = foldService.of((state, lineStart) => {
  const line = state.doc.lineAt(lineStart);
  if (!line.text.trim()) return null;
  const indent = (line.text.match(/^\s*/)?.[0] ?? '').length;
  let end = line.to;
  for (let number = line.number + 1; number <= state.doc.lines; number += 1) {
    const next = state.doc.line(number);
    if (!next.text.trim()) {
      end = next.to;
      continue;
    }
    const nextIndent = (next.text.match(/^\s*/)?.[0] ?? '').length;
    if (nextIndent <= indent) break;
    end = next.to;
  }
  return end > line.to ? { from: line.to, to: end } : null;
});

interface Props {
  value: string;
  onChange: (value: string) => void;
  onSave?: () => void;
  onRun?: () => void;
  autoFocus?: boolean;
  className?: string;
  placeholder?: string;
}

export function PineEditor({
  value,
  onChange,
  onSave,
  onRun,
  autoFocus,
  className,
  placeholder,
}: Props) {
  const callbacks = useRef({ onChange, onSave, onRun });
  callbacks.current = { onChange, onSave, onRun };

  const handleChange = useCallback((next: string) => {
    callbacks.current.onChange(next);
  }, []);

  const extensions = useMemo(
    () => [
      pineLanguage(),
      ...pineThemeExtensions(),
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightActiveLine(),
      history(),
      drawSelection(),
      dropCursor(),
      rectangularSelection(),
      crosshairCursor(),
      bracketMatching(),
      closeBrackets(),
      indentOnInput(),
      indentUnit.of('    '),
      foldGutter(),
      indentFold,
      highlightSelectionMatches(),
      autocompletion({ override: [pineCompletions] }),
      lintGutter(),
      pineLinter(),
      keymap.of([
        {
          key: 'Mod-s',
          preventDefault: true,
          run: () => {
            callbacks.current.onSave?.();
            return true;
          },
        },
        {
          key: 'Mod-Enter',
          preventDefault: true,
          run: () => {
            callbacks.current.onRun?.();
            return true;
          },
        },
        ...closeBracketsKeymap,
        ...completionKeymap,
        ...defaultKeymap,
        ...searchKeymap,
        ...historyKeymap,
        indentWithTab,
      ]),
      EditorView.lineWrapping,
    ],
    [],
  );

  return (
    <div className={cn('min-h-0 overflow-hidden rounded-md border border-border', className)}>
      <CodeMirror
        value={value}
        onChange={handleChange}
        extensions={extensions}
        theme="none"
        basicSetup={false}
        autoFocus={autoFocus}
        height="100%"
        placeholder={placeholder}
        className="h-full text-[12px]"
      />
    </div>
  );
}
