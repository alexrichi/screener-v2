import type { PineLintFinding } from '@screener/pine-editor';

export interface PineMarker {
  code: string;
  severity: PineLintFinding['severity'];
  message: string;
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
}

/**
 * Clamp findings to the document so a stale lint result cannot throw. The
 * validator and the local rules report one-based lines and zero-based columns.
 */
export function toPineMarkers(
  findings: readonly PineLintFinding[],
  lines: readonly string[],
): PineMarker[] {
  if (lines.length === 0) return [];
  return findings.map((finding) => {
    const lineNumber = Math.min(Math.max(finding.line, 1), lines.length);
    const lineLength = lines[lineNumber - 1]?.length ?? 0;
    const startColumn = Math.min(Math.max(finding.column + 1, 1), lineLength + 1);
    const endColumn = Math.min(startColumn + Math.max(finding.length, 1), lineLength + 1);
    return {
      code: finding.code,
      severity: finding.severity,
      message: finding.message,
      startLineNumber: lineNumber,
      startColumn,
      endLineNumber: lineNumber,
      endColumn: Math.max(endColumn, startColumn),
    };
  });
}
