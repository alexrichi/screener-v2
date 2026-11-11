import { useEffect, useRef } from 'react';
import * as monaco from 'monaco-editor';
import { useTheme } from '../ui/theme';
import { cn } from '../ui/cn';
import {
  applyPineTheme,
  registerPineLanguage,
  schedulePineLint,
  syncContextViewTheme,
} from '../lib/monaco/pine';
import { pineDefinitionRange } from '../lib/monaco/pineFeatures';

const FONT_FAMILY =
  "'Geist Mono Variable', 'Geist Mono', ui-monospace, SFMono-Regular, Menlo, monospace";

interface Props {
  value: string;
  onChange: (value: string) => void;
  onSave?: () => void;
  onRun?: () => void;
  onDiscardChanges?: () => void;
  onNewTab?: () => void;
  onOpenScript?: () => void;
  onToggleConsole?: () => void;
  autoFocus?: boolean;
  className?: string;
  placeholder?: string;
}

export function PineEditor({
  value,
  onChange,
  onSave,
  onRun,
  onDiscardChanges,
  onNewTab,
  onOpenScript,
  onToggleConsole,
  autoFocus,
  className,
  placeholder,
}: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const modelRef = useRef<monaco.editor.ITextModel | null>(null);
  const callbacks = useRef({
    onChange,
    onSave,
    onRun,
    onDiscardChanges,
    onNewTab,
    onOpenScript,
    onToggleConsole,
  });
  callbacks.current = {
    onChange,
    onSave,
    onRun,
    onDiscardChanges,
    onNewTab,
    onOpenScript,
    onToggleConsole,
  };
  const { theme } = useTheme();

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    registerPineLanguage();
    applyPineTheme(theme);
    const model = monaco.editor.createModel(value, 'pine');
    const editor = monaco.editor.create(host, {
      model,
      theme: 'pine',
      automaticLayout: true,
      fontFamily: FONT_FAMILY,
      fontSize: 12,
      lineHeight: 19,
      fontLigatures: false,
      wordWrap: 'on',
      wrappingIndent: 'same',
      tabSize: 4,
      insertSpaces: true,
      detectIndentation: false,
      scrollBeyondLastLine: false,
      smoothScrolling: true,
      renderLineHighlight: 'all',
      renderWhitespace: 'none',
      glyphMargin: false,
      folding: true,
      lineNumbers: 'on',
      lineNumbersMinChars: 3,
      lineDecorationsWidth: 8,
      minimap: {
        enabled: true,
        showSlider: 'mouseover',
        renderCharacters: false,
        maxColumn: 80,
      },
      stickyScroll: { enabled: true },
      bracketPairColorization: { enabled: true },
      guides: { bracketPairs: true, indentation: true, highlightActiveBracketPair: true },
      matchBrackets: 'always',
      autoClosingBrackets: 'languageDefined',
      autoIndent: 'full',
      'semanticHighlighting.enabled': true,
      quickSuggestions: { other: true, comments: false, strings: false },
      fixedOverflowWidgets: true,
      padding: { top: 8, bottom: 8 },
      scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
      ariaLabel: 'Pine script',
      placeholder,
    });

    editorRef.current = editor;
    modelRef.current = model;
    syncContextViewTheme(host);

    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
      callbacks.current.onRun?.();
    });
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyP, () => {
      void editor.getAction('editor.action.quickCommand')?.run();
    });
    editor.addAction({
      id: 'pine.save',
      label: 'Save script',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
      contextMenuGroupId: 'p_session',
      contextMenuOrder: 3,
      run: () => callbacks.current.onSave?.(),
    });
    editor.addAction({
      id: 'pine.definition',
      label: 'Go to Definition',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.F12],
      contextMenuGroupId: 'navigation',
      contextMenuOrder: 1,
      run: (instance) => {
        const model = instance.getModel();
        const position = instance.getPosition();
        const range = model && position ? pineDefinitionRange(model, position) : null;
        if (range) {
          instance.setPosition(range.getStartPosition());
          instance.revealPositionInCenter(range.getStartPosition());
          instance.focus();
          return;
        }
        void instance.getAction('editor.action.revealDefinition')?.run();
      },
    });
    editor.addAction({
      id: 'pine.discard',
      label: 'Discard all changes',
      contextMenuGroupId: '1_modification',
      contextMenuOrder: 50,
      run: () => callbacks.current.onDiscardChanges?.(),
    });
    editor.addAction({
      id: 'pine.find',
      label: 'Find/Replace',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyF],
      contextMenuGroupId: '9_cutcopypaste',
      contextMenuOrder: 40,
      run: (instance) => {
        void instance.getAction('editor.action.startFindReplaceAction')?.run();
      },
    });
    editor.addAction({
      id: 'pine.newTab',
      label: 'New tab',
      keybindings: [monaco.KeyMod.Shift | monaco.KeyMod.Alt | monaco.KeyCode.KeyT],
      contextMenuGroupId: 'p_session',
      contextMenuOrder: 1,
      run: () => callbacks.current.onNewTab?.(),
    });
    editor.addAction({
      id: 'pine.openScript',
      label: 'Open script',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyO],
      contextMenuGroupId: 'p_session',
      contextMenuOrder: 2,
      run: () => callbacks.current.onOpenScript?.(),
    });
    editor.addAction({
      id: 'pine.console',
      label: 'Toggle console',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Backquote],
      contextMenuGroupId: 'q_console',
      contextMenuOrder: 1,
      run: () => callbacks.current.onToggleConsole?.(),
    });

    const subscription = model.onDidChangeContent(() => {
      callbacks.current.onChange(model.getValue());
    });
    const stopLint = schedulePineLint(model);

    if (autoFocus) editor.focus();
    let disposed = false;
    // The font may arrive after the editor measured its first frame.
    void document.fonts?.ready.then(() => {
      if (!disposed) editor.layout();
    });

    return () => {
      disposed = true;
      stopLint();
      subscription.dispose();
      editor.dispose();
      model.dispose();
      editorRef.current = null;
      modelRef.current = null;
    };
    // The editor is created once; external value and theme changes are handled
    // by the effects below.
  }, []);

  useEffect(() => {
    const model = modelRef.current;
    if (!model || model.getValue() === value) return;
    // Keep the undo stack and cursor for edits that come from the AI or a preset.
    model.pushEditOperations(
      [],
      [{ range: model.getFullModelRange(), text: value }],
      () => null,
    );
  }, [value]);

  useEffect(() => {
    const host = hostRef.current;
    if (!editorRef.current || !host) return;
    // The theme provider applies the root class in a layout effect, so reading
    // the computed tokens here sees the new palette.
    applyPineTheme(theme);
    syncContextViewTheme(host);
  }, [theme]);

  return (
    <div className={cn('min-h-0 overflow-hidden rounded-md border border-border', className)}>
      <div ref={hostRef} className="h-full w-full" />
    </div>
  );
}
