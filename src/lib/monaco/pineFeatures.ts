import * as monaco from 'monaco-editor';
import { formatDocument } from '@pine-highlighter/formatter';
import { buildModel, type LineRange } from '@pine-highlighter/document-model';
import { semanticTokens } from '@pine-highlighter/semantic';
import { enclosingCall } from '@pine-highlighter/call-resolver';
import { resolveSymbolAt } from '@pine-highlighter/symbols';
import { tokenize } from '@pine-highlighter/tokenizer';
import type { RefEntry, ReferenceIndex } from '@pine-highlighter/reference';
import { pineCompletionOptions } from '@screener/pine-editor';

const SEMANTIC_LEGEND: monaco.languages.SemanticTokensLegend = {
  tokenTypes: [
    'function',
    'method',
    'type',
    'enum',
    'enumMember',
    'parameter',
    'variable',
    'property',
    'namespace',
  ],
  tokenModifiers: ['declaration'],
};

function analysis(text: string) {
  return { model: buildModel(text), tokens: tokenize(text) };
}

let referencePromise: Promise<ReferenceIndex> | null = null;

/** The full v6 reference is 1.5 MB, so it loads in its own chunk on first hover. */
function loadPineReference(): Promise<ReferenceIndex> {
  referencePromise ??= import('@pine-highlighter/reference').then(({ loadReference }) => loadReference());
  return referencePromise;
}

function prose(value: string): string {
  return value
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function entryMarkdown(entry: RefEntry): string {
  const lines: string[] = [];
  const overloads = entry.overloads ?? [];
  if (entry.kind === 'function' && overloads.length > 0) {
    lines.push('```pine');
    for (const overload of overloads.slice(0, 3)) lines.push(overload.syntax);
    if (overloads.length > 3) lines.push(`// ${overloads.length - 3} more overloads`);
    lines.push('```');
  } else {
    const type = entry.type ? `: \`${entry.type}\`` : '';
    lines.push(`**${entry.kind}** \`${entry.name}\`${type}`);
  }

  if (entry.description) lines.push('', prose(entry.description));

  const first = overloads[0];
  if (first?.params.length) {
    lines.push('', '**Parameters**');
    for (const param of first.params.slice(0, 12)) {
      const optional = param.optional ? ' _(optional)_' : '';
      const description = param.description ? ` — ${prose(param.description)}` : '';
      lines.push(`- \`${param.name}\` (${param.type}${optional})${description}`);
    }
  }

  if (first?.returns) {
    const description = first.returns.description
      ? ` — ${prose(first.returns.description)}`
      : '';
    lines.push('', `**Returns** \`${first.returns.type}\`${description}`);
  }

  if (entry.fields.length > 0) {
    lines.push('', '**Fields**');
    for (const field of entry.fields.slice(0, 20)) {
      const description = field.description ? ` — ${prose(field.description)}` : '';
      lines.push(`- \`${field.name}\` (${field.type})${description}`);
    }
  }

  const text = lines.join('\n');
  return text.length > 6000 ? `${text.slice(0, 6000)}…` : text;
}

function namespaceMarkdown(name: string, index: ReferenceIndex): string {
  const members = index.members(name);
  const children = index.childNamespaces(name);
  const lines = [`**namespace** \`${name}\``];
  if (members.length > 0) {
    const names = members
      .slice(0, 20)
      .map((member) => `\`${member.name}\``)
      .join(', ');
    lines.push('', names + (members.length > 20 ? `, … ${members.length - 20} more` : ''));
  }
  if (children.length > 0) {
    const names = children
      .slice(0, 10)
      .map((child) => `\`${child}\``)
      .join(', ');
    lines.push('', `**Namespaces** ${names}${children.length > 10 ? '…' : ''}`);
  }
  return lines.join('\n');
}

function segmentAt(
  text: string,
  offset: number,
): { start: number; end: number; first: boolean; name: string } {
  let start = 0;
  for (let index = 0; index <= text.length; index += 1) {
    if (index === text.length || text[index] === '.') {
      if (offset >= start && offset <= index) {
        return {
          start,
          end: index,
          first: start === 0,
          name: text.slice(start, index),
        };
      }
      start = index + 1;
    }
  }
  return { start: 0, end: text.length, first: true, name: text };
}

function registerHover(): void {
  monaco.languages.registerHoverProvider('pine', {
    provideHover: async (model, position) => {
      const word = model.getWordAtPosition(position);
      const name = word?.word ?? '';
      const offset = word ? position.column - word.startColumn : 0;
      const segment = word ? segmentAt(word.word, offset) : null;
      const range = word
        ? new monaco.Range(
            position.lineNumber,
            word.startColumn + (segment?.start ?? 0),
            position.lineNumber,
            word.startColumn + (segment?.end ?? word.word.length),
          )
        : undefined;
      let index: ReferenceIndex | null = null;
      try {
        index = await loadPineReference();
      } catch {
        index = null;
      }

      if (index && name) {
        const all = index.getAll(name);
        let entry: RefEntry | undefined;

        if (segment && segment.name !== name) {
          const own = index.getAll(segment.name);
          if (segment.first) {
            entry =
              own.find((candidate) => candidate.kind === 'type') ??
              own.find((candidate) => candidate.kind === 'function') ??
              own[0];
          } else {
            const line = model.getLineContent(position.lineNumber);
            const after = line.slice((word?.endColumn ?? position.column) - 1).trimStart();
            const called = after.startsWith('(') || after.startsWith('<');
            entry = called
              ? all.find((candidate) => candidate.kind === 'function') ??
                all.find((candidate) => candidate.kind === 'variable') ??
                all[0]
              : all.find((candidate) => candidate.kind === 'variable') ??
                all.find((candidate) => candidate.kind === 'constant') ??
                all.find((candidate) => candidate.kind === 'type') ??
                all.find((candidate) => candidate.kind === 'function') ??
                all[0];
          }
        } else if (all.length > 0) {
          const line = model.getLineContent(position.lineNumber);
          const after = line.slice((word?.endColumn ?? position.column) - 1).trimStart();
          const typeEntry = all.find((candidate) => candidate.kind === 'type');
          entry =
            typeEntry && after[0] !== '('
              ? typeEntry
              : all.find((candidate) => candidate.kind === 'function') ?? all[0];
        } else {
          const call = enclosingCall(
            tokenize(model.getValue()),
            position.lineNumber - 1,
            position.column - 1,
          );
          if (call) {
            const callEntries = index.getAll(call.name);
            entry =
              callEntries.find((candidate) => candidate.kind === 'function') ?? callEntries[0];
          }
        }

        if (entry) return { range, contents: [{ value: entryMarkdown(entry) }] };

        const namespace = segment?.name ?? name;
        if (namespace) {
          const members = index.members(namespace);
          const children = index.childNamespaces(namespace);
          if (members.length > 0 || children.length > 0) {
            return { range, contents: [{ value: namespaceMarkdown(namespace, index) }] };
          }
        }
      }

      if (!name) return null;
      const options = await pineCompletionOptions();
      const option = options.find((candidate) => candidate.label === name);
      if (!option?.detail) return null;
      return { range, contents: [{ value: `\`\`\`pine\n${option.detail}\n\`\`\`` }] };
    },
  });
}

function encodeSemanticTokens(tokens: ReturnType<typeof semanticTokens>): Uint32Array {
  const typeIndex = new Map(SEMANTIC_LEGEND.tokenTypes.map((type, index) => [type, index]));
  const data: number[] = [];
  let line = 0;
  let start = 0;
  for (const token of tokens) {
    const deltaLine = token.line - line;
    const deltaStart = deltaLine === 0 ? token.startCol - start : token.startCol;
    data.push(
      deltaLine,
      deltaStart,
      token.length,
      typeIndex.get(token.kind) ?? 0,
      token.isDeclaration ? 1 : 0,
    );
    line = token.line;
    start = token.startCol;
  }
  return new Uint32Array(data);
}

function lineRange(lines: readonly string[], start: number, end: number): monaco.Range {
  const first = Math.min(Math.max(start, 0), Math.max(lines.length - 1, 0));
  const last = Math.min(Math.max(end, first), Math.max(lines.length - 1, 0));
  return new monaco.Range(
    first + 1,
    1,
    last + 1,
    (lines[last]?.length ?? 0) + 1,
  );
}

function selectionRange(lines: readonly string[], line: number, column = 0, length?: number): monaco.Range {
  const lineNumber = Math.min(Math.max(line, 0), Math.max(lines.length - 1, 0));
  const text = lines[lineNumber] ?? '';
  const start = Math.min(Math.max(column, 0), text.length);
  const end = Math.min(start + (length ?? text.length - start), text.length);
  return new monaco.Range(lineNumber + 1, start + 1, lineNumber + 1, end + 1);
}

function registerFormatter(): void {
  monaco.languages.registerDocumentFormattingEditProvider('pine', {
    provideDocumentFormattingEdits(model) {
      const text = model.getValue();
      if (!text.trim()) return [];
      try {
        const formatted = formatDocument(text, { useTabs: false });
        if (formatted === text) return [];
        return [{ range: model.getFullModelRange(), text: formatted }];
      } catch {
        return [];
      }
    },
  });
}

/** Definition range for a user symbol, or null for built-ins. */
export function pineDefinitionRange(
  model: monaco.editor.ITextModel,
  position: monaco.Position,
): monaco.Range | null {
  try {
    const text = model.getValue();
    const target = resolveSymbolAt(
      { model: buildModel(text), tokens: tokenize(text) },
      position.lineNumber - 1,
      position.column - 1,
    );
    const declaration = target?.declaration;
    if (!declaration) return null;
    return new monaco.Range(
      declaration.line + 1,
      declaration.startCol + 1,
      declaration.line + 1,
      declaration.endCol + 1,
    );
  } catch {
    return null;
  }
}

function registerSignatureHelp(): void {
  monaco.languages.registerSignatureHelpProvider('pine', {
    signatureHelpTriggerCharacters: ['(', ','],
    signatureHelpRetriggerCharacters: [','],
    provideSignatureHelp: async (model, position) => {
      const call = enclosingCall(
        tokenize(model.getValue()),
        position.lineNumber - 1,
        position.column - 1,
      );
      if (!call) return null;
      const entry = (await pineCompletionOptions()).find((option) => option.label === call.name);
      if (!entry) return null;
      const params = entry.params ?? [];
      const namedIndex = call.namedArg ? params.indexOf(call.namedArg) : -1;
      const active = namedIndex >= 0 ? namedIndex : call.argIndex;
      return {
        value: {
          signatures: [
            {
              label: entry.detail ?? call.name,
              parameters: params.map((name) => ({ label: name })),
            },
          ],
          activeSignature: 0,
          activeParameter:
            params.length > 0 ? Math.min(Math.max(active, 0), params.length - 1) : 0,
        },
        dispose: () => {},
      };
    },
  });
}

function registerSemanticTokens(): void {
  monaco.languages.registerDocumentSemanticTokensProvider('pine', {
    getLegend: () => SEMANTIC_LEGEND,
    provideDocumentSemanticTokens(model) {
      try {
        const source = analysis(model.getValue());
        return {
          data: encodeSemanticTokens(semanticTokens(source)),
          resultId: String(model.getVersionId()),
        };
      } catch {
        return { data: new Uint32Array(0) };
      }
    },
    releaseDocumentSemanticTokens: () => {},
  });
}

function registerDocumentSymbols(): void {
  monaco.languages.registerDocumentSymbolProvider('pine', {
    provideDocumentSymbols(model) {
      const text = model.getValue();
      const lines = text.split(/\r?\n/);
      const doc = buildModel(text);
      const symbols: monaco.languages.DocumentSymbol[] = [];

      for (const fn of doc.functions) {
        symbols.push({
          name: fn.name,
          detail: fn.isMethod ? 'method' : 'function',
          kind: fn.isMethod ? monaco.languages.SymbolKind.Method : monaco.languages.SymbolKind.Function,
          tags: [],
          range: lineRange(lines, fn.range.start, fn.range.end),
          selectionRange: selectionRange(lines, fn.line),
        });
      }

      for (const type of doc.types) {
        symbols.push({
          name: type.name,
          detail: 'type',
          kind: monaco.languages.SymbolKind.Struct,
          tags: [],
          range: lineRange(lines, type.range.start, type.range.end),
          selectionRange: selectionRange(lines, type.line),
          children: type.fields.map((field) => ({
            name: field.name,
            detail: field.type,
            kind: monaco.languages.SymbolKind.Field,
            tags: [],
            range: lineRange(lines, field.line, field.line),
            selectionRange: selectionRange(lines, field.line),
          })),
        });
      }

      for (const enumeration of doc.enums) {
        symbols.push({
          name: enumeration.name,
          detail: 'enum',
          kind: monaco.languages.SymbolKind.Enum,
          tags: [],
          range: lineRange(lines, enumeration.range.start, enumeration.range.end),
          selectionRange: selectionRange(lines, enumeration.line),
          children: enumeration.members.map((member) => ({
            name: member.name,
            detail: member.title ?? '',
            kind: monaco.languages.SymbolKind.EnumMember,
            tags: [],
            range: lineRange(lines, member.line, member.line),
            selectionRange: selectionRange(lines, member.line),
          })),
        });
      }

      for (const variable of doc.variables) {
        if (/^\s/.test(lines[variable.line] ?? '')) continue;
        symbols.push({
          name: variable.name,
          detail: variable.declaredType ?? '',
          kind: monaco.languages.SymbolKind.Variable,
          tags: [],
          range: lineRange(lines, variable.line, variable.line),
          selectionRange: selectionRange(
            lines,
            variable.line,
            variable.column,
            variable.name.length,
          ),
        });
      }

      return symbols.sort(
        (left, right) => left.range.startLineNumber - right.range.startLineNumber,
      );
    },
  });
}

/** Formatter, hover, definition, signature help, semantic tokens and the outline for Pine. */
export function registerPineFeatures(): void {
  registerFormatter();
  registerHover();
  registerSignatureHelp();
  registerSemanticTokens();
  registerDocumentSymbols();
}
