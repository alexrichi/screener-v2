import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
import {
  lintPineScript,
  pineCompletionOptions,
  tokenizePineLine,
  type PineLintFinding,
  type PineTokenState,
} from '@screener/pine-editor';
import type { ThemeMode } from '../../types';
import { expandHex } from './colors';
import { toPineMarkers } from './markers';
import { registerPineFeatures } from './pineFeatures';

const LANGUAGE_ID = 'pine';
const THEME_ID = 'pine';
const LINT_OWNER = 'pine';
const LINT_DELAY = 400;

/** Pine token names mapped onto Monaco theme scopes. */
const TOKEN_SCOPES: Record<string, string> = {
  keyword: 'keyword',
  bool: 'constant',
  string: 'string',
  number: 'number',
  color: 'number',
  comment: 'comment',
  function: 'function',
  variableName: 'variable',
  namespace: 'namespace',
  constant: 'constant',
  typeName: 'type',
  operator: 'operator',
  punctuation: 'punctuation',
  annotation: 'annotation',
};

interface PineMonacoState extends monaco.languages.IState {
  triple: PineTokenState['triple'];
}

function createPineState(triple: PineTokenState['triple'] = null): PineMonacoState {
  return {
    triple,
    clone: () => createPineState(triple),
    equals: (other) => (other as PineMonacoState).triple === triple,
  };
}

self.MonacoEnvironment = {
  getWorker: () => new EditorWorker(),
};

let registered = false;

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** Chromium serializes `#ffffff` as `#fff`; Monaco token colors need 6/8 digits. */
function color(name: string, fallback: string): string {
  const value = cssVar(name) || fallback;
  return value.startsWith('#') ? `#${expandHex(value)}` : value;
}

/** Token rule colors are hex without the leading `#`. */
function tokenColor(name: string, fallback: string): string {
  const value = expandHex(cssVar(name));
  return value || fallback;
}

/**
 * Register the Pine language once per page. The tokenizer, completions and
 * diagnostics come from `@screener/pine-editor`; this module only maps them
 * onto Monaco.
 */
export function registerPineLanguage(): void {
  if (registered) return;
  registered = true;

  monaco.languages.register({
    id: LANGUAGE_ID,
    extensions: ['.pine'],
    aliases: ['Pine', 'pine'],
  });

  monaco.languages.setLanguageConfiguration(LANGUAGE_ID, {
    comments: { lineComment: '//' },
    brackets: [
      ['(', ')'],
      ['[', ']'],
      ['{', '}'],
    ],
    autoClosingPairs: [
      { open: '(', close: ')' },
      { open: '[', close: ']' },
      { open: '{', close: '}' },
      { open: '"', close: '"', notIn: ['string', 'comment'] },
      { open: "'", close: "'", notIn: ['string', 'comment'] },
    ],
    surroundingPairs: [
      { open: '(', close: ')' },
      { open: '[', close: ']' },
      { open: '{', close: '}' },
      { open: '"', close: '"' },
      { open: "'", close: "'" },
    ],
    wordPattern: /(-?\d*\.\d\w*)|([A-Za-z_][\w.]*)/g,
    folding: {
      offSide: true,
      markers: {
        start: /^\s*\/\/\s*#?region\b/,
        end: /^\s*\/\/\s*#?endregion\b/,
      },
    },
    indentationRules: {
      increaseIndentPattern:
        /^\s*(?:(?:if|for|while|switch|else|once|type|enum)\b.*|.*=>\s*)$/,
      decreaseIndentPattern: /^\s*else\b/,
    },
    onEnterRules: [
      {
        beforeText: /^\s*(?:if|for|while|switch|else|once|type|enum)\b.*$/,
        action: { indentAction: monaco.languages.IndentAction.Indent },
      },
      {
        beforeText: /^\s*.*=>\s*$/,
        action: { indentAction: monaco.languages.IndentAction.Indent },
      },
    ],
  });

  monaco.languages.setTokensProvider(LANGUAGE_ID, {
    getInitialState: () => createPineState(),
    tokenize(line, state) {
      const result = tokenizePineLine(line, {
        triple: (state as PineMonacoState).triple,
      });
      let index = 0;
      const tokens = result.tokens.map((token) => {
        const startIndex = index;
        index += token.text.length;
        return {
          startIndex,
          scopes: token.type ? TOKEN_SCOPES[token.type] ?? '' : '',
        };
      });
      return { tokens, endState: createPineState(result.state.triple) };
    },
  });

  monaco.languages.registerCompletionItemProvider(LANGUAGE_ID, {
    triggerCharacters: ['.'],
    provideCompletionItems: async (model, position) => {
      const word = model.getWordUntilPosition(position);
      const range = new monaco.Range(
        position.lineNumber,
        word.startColumn,
        position.lineNumber,
        word.endColumn,
      );
      const options = await pineCompletionOptions();
      return {
        suggestions: options.map((option) => ({
          label: option.label,
          kind:
            option.type === 'function'
              ? monaco.languages.CompletionItemKind.Function
              : monaco.languages.CompletionItemKind.Keyword,
          detail: option.detail,
          insertText: option.label,
          range,
        })),
      };
    },
  });

  registerPineFeatures();
}

const MARKER_SEVERITY: Record<PineLintFinding['severity'], monaco.MarkerSeverity> = {
  error: monaco.MarkerSeverity.Error,
  warning: monaco.MarkerSeverity.Warning,
  info: monaco.MarkerSeverity.Info,
};

/**
 * Debounced lint over the same validator and v6 rules the scan uses. Stale
 * results are dropped by version so fast typing cannot overwrite newer markers.
 */
export function schedulePineLint(
  model: monaco.editor.ITextModel,
  delay = LINT_DELAY,
): () => void {
  let timer: number | undefined;
  let version = 0;

  const run = () => {
    const current = ++version;
    const source = model.getValue();
    const lines = source.split(/\r?\n/);
    void lintPineScript(source)
      .then((findings) => {
        if (current !== version || model.isDisposed()) return;
        monaco.editor.setModelMarkers(
          model,
          LINT_OWNER,
          toPineMarkers(findings, lines).map((marker) => ({
            ...marker,
            severity: MARKER_SEVERITY[marker.severity],
          })),
        );
      })
      .catch(() => {
        /* A failed validator must not break typing. */
      });
  };

  const schedule = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(run, delay);
  };

  const subscription = model.onDidChangeContent(schedule);
  schedule();

  return () => {
    subscription.dispose();
    window.clearTimeout(timer);
    version += 1;
  };
}

/**
 * The context menu lives in a shadow root that is a sibling of `.monaco-editor`,
 * so it does not inherit the editor's `--vscode-*` theme variables. Copy the
 * variables the menu uses onto the editor container and let the shadow host
 * inherit them.
 */
const CONTEXT_VIEW_VARS = [
  '--vscode-menu-background',
  '--vscode-menu-foreground',
  '--vscode-menu-selectionBackground',
  '--vscode-menu-selectionForeground',
  '--vscode-menu-selectionBorder',
  '--vscode-menu-separatorBackground',
  '--vscode-menu-border',
  '--vscode-list-hoverBackground',
  '--vscode-list-hoverForeground',
  '--vscode-descriptionForeground',
  '--vscode-disabledForeground',
  '--vscode-editorWidget-background',
  '--vscode-editorWidget-border',
  '--vscode-editorHoverWidget-border',
  '--vscode-focusBorder',
  '--vscode-foreground',
  '--vscode-keybindingLabel-background',
  '--vscode-keybindingLabel-foreground',
  '--vscode-keybindingLabel-border',
  '--vscode-keybindingLabel-bottomBorder',
  '--vscode-widget-shadow',
  '--vscode-shadow-lg',
  '--vscode-strokeThickness',
  '--vscode-cornerRadius-large',
  '--vscode-cornerRadius-medium',
  '--vscode-fontWeight-semiBold',
  '--vscode-codiconFontSize',
];

export function syncContextViewTheme(container: HTMLElement): void {
  const editor = container.querySelector('.monaco-editor');
  if (!editor) return;
  const styles = getComputedStyle(editor);
  for (const name of CONTEXT_VIEW_VARS) {
    let value = styles.getPropertyValue(name).trim();
    if (!value && name === '--vscode-menu-border') {
      value = styles.getPropertyValue('--vscode-editorWidget-border').trim();
    }
    if (value) container.style.setProperty(name, value);
  }
}

/**
 * Define and select the editor theme from the app's `--pine-*` tokens. Called
 * one frame after a theme change so the root class is already applied.
 */
export function applyPineTheme(mode: ThemeMode): void {
  const dark = mode === 'dark';
  const theme: monaco.editor.IStandaloneThemeData = {
    base: dark ? 'vs-dark' : 'vs',
    inherit: true,
    rules: [
      { token: 'keyword', foreground: tokenColor('--pine-keyword', dark ? '7592ff' : '2b45e0') },
      {
        token: 'constant',
        foreground: tokenColor('--pine-atom', dark ? 'c2d6ff' : '1a33b8'),
      },
      { token: 'string', foreground: tokenColor('--pine-string', dark ? '34d399' : '047857') },
      { token: 'number', foreground: tokenColor('--pine-number', dark ? 'f0b90b' : 'b45309') },
      {
        token: 'comment',
        foreground: tokenColor('--pine-comment', dark ? '6b7280' : '94a3b8'),
        fontStyle: 'italic',
      },
      {
        token: 'function',
        foreground: tokenColor('--pine-function', dark ? 'c2d6ff' : '1a33b8'),
      },
      {
        token: 'namespace',
        foreground: tokenColor('--pine-namespace', dark ? '9cb9ff' : '2b45e0'),
      },
      {
        token: 'variable',
        foreground: tokenColor('--pine-variable', dark ? 'f3f4f6' : '0f172a'),
      },
      { token: 'type', foreground: tokenColor('--pine-atom', dark ? 'c2d6ff' : '1a33b8') },
      {
        token: 'operator',
        foreground: tokenColor('--pine-operator', dark ? '9ca3af' : '64748b'),
      },
      {
        token: 'punctuation',
        foreground: tokenColor('--pine-punctuation', dark ? '9ca3af' : '64748b'),
      },
      {
        token: 'annotation',
        foreground: tokenColor('--pine-meta', dark ? '7592ff' : '2b45e0'),
      },
      {
        token: 'parameter',
        foreground: tokenColor('--pine-atom', dark ? 'c2d6ff' : '1a33b8'),
      },
      {
        token: 'property',
        foreground: tokenColor('--pine-property', dark ? 'c2d6ff' : '1a33b8'),
      },
      {
        token: 'enumMember',
        foreground: tokenColor('--pine-atom', dark ? 'c2d6ff' : '1a33b8'),
      },
      {
        token: 'enum',
        foreground: tokenColor('--pine-atom', dark ? 'c2d6ff' : '1a33b8'),
      },
      {
        token: 'method',
        foreground: tokenColor('--pine-function', dark ? 'c2d6ff' : '1a33b8'),
      },
    ],
    colors: {
      'editor.background': color('--pine-bg', dark ? '#030712' : '#ffffff'),
      'editor.foreground': color('--pine-fg', dark ? '#f3f4f6' : '#0f172a'),
      'editorGutter.background': color('--pine-gutter-bg', dark ? '#0b1220' : '#f8fafc'),
      'editorLineNumber.foreground': color('--pine-gutter', dark ? '#64748b' : '#94a3b8'),
      'editorLineNumber.activeForeground': color('--pine-fg', dark ? '#f3f4f6' : '#0f172a'),
      'editor.lineHighlightBackground': color(
        '--pine-active-line',
        dark ? 'rgba(255, 255, 255, 0.03)' : 'rgba(15, 23, 42, 0.035)',
      ),
      'editor.lineHighlightBorder': '#00000000',
      'editor.selectionBackground': color(
        '--pine-selection',
        dark ? 'rgba(70, 95, 255, 0.28)' : 'rgba(70, 95, 255, 0.18)',
      ),
      'editor.inactiveSelectionBackground': color(
        '--pine-selection',
        dark ? 'rgba(70, 95, 255, 0.28)' : 'rgba(70, 95, 255, 0.18)',
      ),
      'editor.selectionHighlightBackground': color(
        '--pine-selection',
        dark ? 'rgba(70, 95, 255, 0.28)' : 'rgba(70, 95, 255, 0.18)',
      ),
      'editorCursor.foreground': color('--pine-caret', dark ? '#465fff' : '#465fff'),
      'editorWidget.background': color('--pine-tooltip-bg', dark ? '#1f2937' : '#f3f4f6'),
      'editorWidget.foreground': color('--pine-fg', dark ? '#f3f4f6' : '#0f172a'),
      'editorWidget.border': color('--pine-tooltip-border', dark ? '#475569' : '#94a3b8'),
      'editorHoverWidget.background': color('--pine-tooltip-bg', dark ? '#1f2937' : '#f3f4f6'),
      'editorHoverWidget.foreground': color('--pine-fg', dark ? '#f3f4f6' : '#0f172a'),
      'editorHoverWidget.border': color('--pine-tooltip-border', dark ? '#475569' : '#94a3b8'),
      'editorHoverWidget.statusBarBackground': color(
        '--pine-tooltip-border',
        dark ? '#475569' : '#94a3b8',
      ),
      'editorHoverWidget.highlightForeground': color('--pine-keyword', dark ? '#7592ff' : '#2b45e0'),
      'editorSuggestWidget.background': color(
        '--pine-tooltip-bg',
        dark ? '#1f2937' : '#f3f4f6',
      ),
      'editorSuggestWidget.border': color(
        '--pine-tooltip-border',
        dark ? '#475569' : '#94a3b8',
      ),
      'editorSuggestWidget.foreground': color('--pine-fg', dark ? '#f3f4f6' : '#0f172a'),
      'editorSuggestWidget.selectedBackground': color(
        '--pine-selection',
        dark ? 'rgba(70, 95, 255, 0.28)' : 'rgba(70, 95, 255, 0.18)',
      ),
      'editorSuggestWidget.highlightForeground': color('--pine-keyword', dark ? '#7592ff' : '#2b45e0'),
      'editorIndentGuide.background1': color('--border', dark ? '#1f2937' : '#e2e8f0'),
      'editorIndentGuide.activeBackground1': color('--muted-foreground', dark ? '#9ca3af' : '#64748b'),
      'editorBracketMatch.background': color(
        '--pine-selection',
        dark ? 'rgba(70, 95, 255, 0.28)' : 'rgba(70, 95, 255, 0.18)',
      ),
      'editorBracketMatch.border': color('--pine-caret', dark ? '#465fff' : '#465fff'),
      'editorError.foreground': color('--pine-invalid', dark ? '#f23645' : '#e11d48'),
      'editorWarning.foreground': color('--pine-number', dark ? '#f0b90b' : '#b45309'),
      'editorInfo.foreground': color('--pine-keyword', dark ? '#7592ff' : '#2b45e0'),
      'textCodeBlock.background': dark
        ? color('--muted', '#111827')
        : color('--accent', '#e2e8f0'),
      'textLink.foreground': color('--pine-keyword', dark ? '#7592ff' : '#2b45e0'),
      'textLink.activeForeground': color('--pine-keyword', dark ? '#7592ff' : '#2b45e0'),
      'editor.findMatchBackground': color(
        '--pine-selection',
        dark ? 'rgba(70, 95, 255, 0.28)' : 'rgba(70, 95, 255, 0.18)',
      ),
      'editor.findMatchHighlightBackground': color(
        '--pine-active-line',
        dark ? 'rgba(255, 255, 255, 0.03)' : 'rgba(15, 23, 42, 0.035)',
      ),
      'scrollbarSlider.background': color('--border', dark ? '#1f2937' : '#e2e8f0'),
      'scrollbarSlider.hoverBackground': color(
        '--muted-foreground',
        dark ? '#9ca3af' : '#64748b',
      ),
      'editorOverviewRuler.border': '#00000000',
    },
  };
  try {
    monaco.editor.defineTheme(THEME_ID, theme);
    monaco.editor.setTheme(THEME_ID);
  } catch (error) {
    console.warn('[pine] editor theme failed', error);
    monaco.editor.setTheme(dark ? 'vs-dark' : 'vs');
  }
}
