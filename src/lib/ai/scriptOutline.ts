import {
  compile,
  type BaseNode,
  type CallExpression,
  type Expression,
} from '@screener/pine-engine';

export interface OutlineEntry {
  line: number;
  kind: string;
  text: string;
  /** Declaration or call name when the node has one. */
  name?: string;
}

const MAX_TEXT = 120;

const VERSION = /^\/\/@version\s*=/;
const DECLARATION = /^(indicator|strategy|library)\s*\(/;
const TYPE = /^type\s+\w+/;
const METHOD = /^method\s+\w+/;
const FUNCTION = /^[a-zA-Z_]\w*\s*\([^)]*\)\s*=>/;
const SECURITY = /\brequest\.security(_lower_tf)?\s*\(/;
const VAR = /^\s*(var|varip)\s+/;
const ARRAY = /\barray\.(new|push|unshift|pop|shift|get|set|remove|clear|size)\b/;

function calleeName(expr: Expression): string | null {
  if (expr.kind === 'IdentifierExpression') return expr.name;
  if (expr.kind === 'MemberExpression') {
    const object = calleeName(expr.object);
    return object ? `${object}.${expr.property}` : expr.property;
  }
  return null;
}

function callKind(name: string): string | null {
  if (name === 'request.security' || name === 'request.security_lower_tf') return 'security';
  if (name === 'indicator' || name === 'strategy' || name === 'library') return 'declaration';
  if (name === 'plot' || name === 'plotshape' || name === 'plotchar' || name === 'plotarrow' ||
      name === 'plotcandle' || name === 'plotbar' || name === 'hline' || name === 'fill' ||
      name === 'bgcolor' || name === 'barcolor') return 'plot';
  if (name === 'input' || name.startsWith('input.')) return 'input';
  if (name.startsWith('array.')) return 'array';
  return null;
}

/** Walk the AST without following source locations. */
function walk(node: unknown, visit: (node: BaseNode) => void, seen = new Set<object>()): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) walk(item, visit, seen);
    return;
  }
  const record = node as Record<string, unknown>;
  if (seen.has(record)) return;
  seen.add(record);
  if (typeof record.kind === 'string') visit(record as unknown as BaseNode);
  for (const [key, value] of Object.entries(record)) {
    if (key === 'loc') continue;
    if (value && typeof value === 'object') walk(value, visit, seen);
  }
}

function astOutline(
  source: string,
  lines: string[],
): OutlineEntry[] | null {
  const compiled = compile(source);
  if (!compiled.success || !compiled.ast) return null;

  const entries: OutlineEntry[] = [];
  const push = (line: number, kind: string, name?: string): void => {
    entries.push({
      line,
      kind,
      text: (lines[line - 1] ?? '').trim().slice(0, MAX_TEXT),
      ...(name ? { name } : {}),
    });
  };

  const versionLine = lines.findIndex((line) => VERSION.test(line));
  if (versionLine >= 0) push(versionLine + 1, 'version');

  walk(compiled.ast, (node) => {
    switch (node.kind) {
      case 'FunctionDeclaration':
        push(node.loc.line, 'function', (node as { name?: string }).name);
        break;
      case 'TypeDeclaration':
        push(node.loc.line, 'type', (node as { name?: string }).name);
        break;
      case 'MethodDeclaration':
        push(node.loc.line, 'method', (node as { name?: string }).name);
        break;
      case 'EnumDeclaration':
        push(node.loc.line, 'enum', (node as { name?: string }).name);
        break;
      case 'ImportStatement':
        push(node.loc.line, 'import', (node as { alias?: string }).alias);
        break;
      case 'VariableDeclaration': {
        const declaration = node as { modifier?: string | null; name?: string };
        if (declaration.modifier === 'var' || declaration.modifier === 'varip') {
          push(node.loc.line, 'var', declaration.name);
        }
        break;
      }
      case 'CallExpression': {
        const call = node as CallExpression;
        const name = calleeName(call.callee);
        if (!name) break;
        const kind = callKind(name);
        if (kind) push(node.loc.line, kind, name);
        break;
      }
      default:
        break;
    }
  });

  return entries;
}

const PRIORITY: Record<string, number> = {
  version: 0,
  declaration: 1,
  type: 2,
  method: 3,
  enum: 4,
  import: 5,
  function: 6,
  security: 7,
  var: 8,
  array: 9,
  input: 10,
  plot: 11,
};

/** Keep structure visible when a large script has more calls than the cap. */
function selectEntries(entries: OutlineEntry[], limit: number): OutlineEntry[] {
  if (entries.length <= limit) {
    return entries.sort((left, right) => left.line - right.line);
  }
  const selected = [...entries]
    .sort((left, right) =>
      (PRIORITY[left.kind] ?? 99) - (PRIORITY[right.kind] ?? 99) || left.line - right.line,
    )
    .slice(0, limit);
  return selected.sort((left, right) => left.line - right.line);
}

/** Line-map fallback for sources the compiler cannot parse yet. */
function patternOutline(
  lines: string[],
  limit: number,
): { entries: OutlineEntry[]; truncated: boolean } {
  const entries: OutlineEntry[] = [];
  for (let index = 0; index < lines.length && entries.length < limit; index += 1) {
    const text = lines[index]!;
    const variants: Array<[string, RegExp]> = [
      ['version', VERSION],
      ['declaration', DECLARATION],
      ['type', TYPE],
      ['method', METHOD],
      ['function', FUNCTION],
      ['security', SECURITY],
      ['var', VAR],
      ['array', ARRAY],
    ];
    for (const [kind, re] of variants) {
      if (entries.length >= limit) break;
      if (!re.test(text)) continue;
      entries.push({ line: index + 1, kind, text: text.trim().slice(0, MAX_TEXT) });
    }
  }
  return { entries, truncated: entries.length >= limit };
}

/**
 * AST-backed navigation map for scripts too large to send whole. The model
 * reads declarations, calls and security requests with line numbers, then
 * pulls the exact range with `read_lines`. Falls back to the line scanner while
 * a script does not compile, so a broken buffer still gets a map.
 */
export function outlineScript(
  source: string,
  limit = 160,
): { lines: number; entries: OutlineEntry[]; truncated: boolean } {
  const lines = source.split(/\r?\n/);
  const all = astOutline(source, lines);
  if (all) {
    return {
      lines: lines.length,
      entries: selectEntries(all, limit),
      truncated: all.length > limit,
    };
  }
  const fallback = patternOutline(lines, limit);
  return { lines: lines.length, ...fallback };
}
