export interface CodeEdit {
  oldStr: string;
  newStr: string;
}

/**
 * Applies ordered patches to the buffer. Each `oldStr` must occur exactly once
 * in the code at the time that patch runs, so a stale read fails loudly instead
 * of rewriting the wrong line.
 */
export function applyEdits(
  source: string,
  edits: CodeEdit[],
): { ok: true; code: string } | { ok: false; error: string } {
  let code = source;
  for (const [index, edit] of edits.entries()) {
    const first = code.indexOf(edit.oldStr);
    if (first === -1) {
      return {
        ok: false,
        error: `Edit #${index + 1}: oldStr was not found. Read the current lines and retry.`,
      };
    }
    if (code.indexOf(edit.oldStr, first + 1) !== -1) {
      return {
        ok: false,
        error: `Edit #${index + 1}: oldStr is not unique. Include more surrounding context.`,
      };
    }
    code = code.slice(0, first) + edit.newStr + code.slice(first + edit.oldStr.length);
  }
  return { ok: true, code };
}
