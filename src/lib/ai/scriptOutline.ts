export interface OutlineEntry {
  line: number;
  kind: string;
  text: string;
}

const PATTERNS: Array<{ kind: string; re: RegExp }> = [
  { kind: 'version', re: /^\/\/@version\s*=/ },
  { kind: 'declaration', re: /^(indicator|strategy)\s*\(/ },
  { kind: 'type', re: /^type\s+\w+/ },
  { kind: 'method', re: /^method\s+\w+/ },
  { kind: 'function', re: /^[a-zA-Z_]\w*\s*\([^)]*\)\s*=>/ },
  { kind: 'security', re: /\brequest\.security\s*\(/ },
  { kind: 'var', re: /^\s*(var|varip)\s+/ },
  {
    kind: 'array',
    re: /\barray\.(new|push|unshift|pop|shift|get|set|remove|clear|size)\b/,
  },
];

/**
 * Line map for scripts too large to send whole. The model reads the outline,
 * then pulls the exact range with `read_lines`.
 */
export function outlineScript(
  source: string,
  limit = 160,
): { lines: number; entries: OutlineEntry[]; truncated: boolean } {
  const lines = source.split(/\r?\n/);
  const entries: OutlineEntry[] = [];
  for (let index = 0; index < lines.length && entries.length < limit; index += 1) {
    const text = lines[index];
    for (const { kind, re } of PATTERNS) {
      if (entries.length >= limit) break;
      if (!re.test(text)) continue;
      entries.push({ line: index + 1, kind, text: text.trim().slice(0, 120) });
    }
  }
  return { lines: lines.length, entries, truncated: entries.length >= limit };
}
