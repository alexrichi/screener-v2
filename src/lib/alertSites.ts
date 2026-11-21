/** Alert entry points statically detectable in a Pine source. */
export interface AlertSiteScan {
  /** `alertcondition(..., title = "...")` titles, in source order. */
  conditions: string[];
  /** At least one plain `alert(...)` call. */
  hasAlert: boolean;
  /** `alertcondition` calls without a static title — they cannot be selected. */
  untitled: number;
}

/** Remove `//` and `/* ... *\/` comments while keeping string literals intact. */
function stripComments(source: string): string {
  let out = '';
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    if (ch === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') i += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const quote = ch;
      out += ch;
      i += 1;
      while (i < source.length) {
        const c = source[i];
        out += c;
        i += 1;
        if (c === '\\') {
          if (i < source.length) {
            out += source[i];
            i += 1;
          }
          continue;
        }
        if (c === quote) break;
      }
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

/** Replace string contents with spaces (quotes kept) so keywords inside strings do not match. */
function maskStrings(source: string): string {
  let out = '';
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (ch !== '"' && ch !== "'") {
      out += ch;
      i += 1;
      continue;
    }
    const quote = ch;
    out += quote;
    i += 1;
    while (i < source.length) {
      const c = source[i];
      if (c === '\\') {
        out += '  ';
        i += 2;
        continue;
      }
      if (c === quote) {
        out += quote;
        i += 1;
        break;
      }
      out += ' ';
      i += 1;
    }
  }
  return out;
}

function callStart(source: string, name: string, from: number): number {
  let at = from;
  while (at < source.length) {
    const found = source.indexOf(name, at);
    if (found < 0) return -1;
    const before = found > 0 ? source[found - 1] : '';
    const after = source[found + name.length] ?? '';
    const isWord = /[\w$]/.test(before);
    if (!isWord && before !== '.' && after !== '$' && after !== '_') {
      let cursor = found + name.length;
      while (/\s/.test(source[cursor] ?? '')) cursor += 1;
      if (source[cursor] === '(') return cursor;
    }
    at = found + name.length;
  }
  return -1;
}

/** The text between the opening paren and its matching close, quotes respected. */
function callBody(source: string, open: number): string | null {
  let depth = 0;
  let quote: string | null = null;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    if (quote) {
      if (ch === '\\') i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  return null;
}

/** Split call arguments on top-level commas, quotes respected. */
function splitArgs(body: string): string[] {
  const out: string[] = [];
  let current = '';
  let depth = 0;
  let quote: string | null = null;
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (quote) {
      current += ch;
      if (ch === '\\') {
        current += body[i + 1] ?? '';
        i += 1;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') depth -= 1;
    if (ch === ',' && depth === 0) {
      out.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim().length > 0) out.push(current.trim());
  return out;
}

function literal(arg: string): string | null {
  const trimmed = arg.trim();
  if (trimmed.length < 2) return null;
  if (trimmed[0] !== '"' && trimmed[0] !== "'") return null;
  if (trimmed[trimmed.length - 1] !== trimmed[0]) return null;
  return trimmed.slice(1, -1);
}

function conditionTitle(body: string): string | null {
  const named = /\btitle\s*=\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/.exec(body);
  if (named) return literal(named[1]);
  const args = splitArgs(body);
  return args.length >= 2 ? literal(args[1]) : null;
}

/** Static scan for the alert entry points a rule can select. */
export function scanAlertSites(source: string): AlertSiteScan {
  const clean = stripComments(source);
  const code = maskStrings(clean);
  const conditions: string[] = [];
  let untitled = 0;
  let at = 0;
  while (at < code.length) {
    const open = callStart(code, 'alertcondition', at);
    if (open < 0) break;
    const body = callBody(clean, open);
    if (body === null) break;
    const title = conditionTitle(body);
    if (title) {
      if (!conditions.includes(title)) conditions.push(title);
    } else {
      untitled += 1;
    }
    at = open + body.length + 2;
  }
  return { conditions, hasAlert: callStart(code, 'alert', 0) >= 0, untitled };
}

/** The declared indicator/strategy title, when it is a static string. */
export function scriptTitle(source: string): string | null {
  const clean = stripComments(source);
  const positional = /\b(?:indicator|strategy)\s*\(\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/.exec(clean);
  if (positional) return literal(positional[1]);
  const named = /\b(?:indicator|strategy)\s*\([^)]*\btitle\s*=\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/.exec(clean);
  return named ? literal(named[1]) : null;
}

/** `request.security`/`request.security_lower_tf` need a host series the alert runner does not fetch. */
export function usesRequestSeries(source: string): boolean {
  return /\brequest\s*\./.test(maskStrings(stripComments(source)));
}
