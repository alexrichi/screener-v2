import { tool } from 'ai';
import { z } from 'zod';
import type { ChartContext, ScriptRunReport } from '../../types';
import { applyEdits } from './edits';
import { outlineScript } from './scriptOutline';

/** Source above this is not sent whole; the model reads it in ranges. */
const INLINE_LIMIT = 40_000;
/** `read_lines` page size. */
const READ_LINES_LIMIT = 400;
const DEFAULT_READ_LINES = 200;

export interface LiveApplyResult {
  /** The on-chart script now runs the editor buffer. */
  ok: boolean;
  /** Charts that took it. */
  charts: number;
  error?: string;
}

export type DraftConflict = 'save' | 'discard' | 'cancel';

export interface NewScriptResult {
  created: boolean;
  needsDecision?: boolean;
  cancelled?: boolean;
  chars?: number;
  draft?: { title: string; chars: number; saved: boolean };
  options?: DraftConflict[];
  hint?: string;
  error?: string;
}

export interface AiToolRuntime {
  getScript: () => string;
  /** Start a fresh buffer, first resolving an unsaved draft with the user. */
  newScript: (input: {
    source: string;
    title?: string;
    conflict?: DraftConflict;
  }) => NewScriptResult;
  /** Replace the editor buffer; the user can still undo and apply from the panel. */
  applyScript: (source: string) => void;
  chartContext: () => ChartContext | null;
  runScript: (source: string, options?: { bar?: number }) => Promise<ScriptRunReport>;
  /** Apply the editor buffer to the active chart in place, keeping its settings. */
  applyLive: () => Promise<LiveApplyResult>;
}

/**
 * Read-only agents get no tool that can rewrite the editor or the chart, so a
 * prompt cannot edit code through this path.
 */
export function toolsForAgent<T extends Record<string, unknown>>(tools: T, readOnly: boolean) {
  if (!readOnly) return tools;
  const {
    apply_live: _applyLive,
    apply_script: _applyScript,
    edit_code: _editCode,
    new_script: _newScript,
    ...rest
  } = tools;
  return rest;
}

/**
 * App tools run in the renderer because that is where the editor and the chart
 * live. Every one of them talks to an existing seam, never to Vela internals.
 */
export function createAppTools(runtime: AiToolRuntime) {
  return {
    get_chart_context: tool({
      description:
        'Read the active chart: symbol, timeframe, layout, chart count, on-chart indicators, the applied Pine-panel script (appliedPine) and the visible window. Use this to check what is actually on the chart; the editor buffer may differ.',
      inputSchema: z.object({}),
      execute: async () => runtime.chartContext() ?? { error: 'No chart is open' },
    }),

    get_script: tool({
      description:
        'Read the Pine editor buffer. This is not necessarily the script applied to the chart: check get_chart_context for appliedPine and the on-chart indicators before saying a script is running. Small scripts come whole; large ones come as an engine-AST outline with line numbers so you can pull exact ranges with read_lines. The outline includes declarations, functions, types, inputs, plots and request.security calls with their exact lines. Call this before editing.',
      inputSchema: z.object({}),
      execute: async () => {
        const source = runtime.getScript();
        const outline = outlineScript(source);
        const truncated = source.length > INLINE_LIMIT;
        const chart = runtime.chartContext();
        return {
          scope: 'editor',
          appliedPine: chart?.appliedPine ?? null,
          onChartIndicators: chart?.indicators ?? [],
          chars: source.length,
          lines: outline.lines,
          truncated,
          source: truncated ? null : source,
          outline: outline.entries,
          outlineTruncated: outline.truncated,
          hint: truncated
            ? 'Too large to send whole. Use read_lines(from, to) for the region you need, then edit_code with small patches.'
            : undefined,
        };
      },
    }),

    read_lines: tool({
      description:
        'Read a line range of the open script. Returns raw text without line-number prefixes, so it can be copied into edit_code unchanged.',
      inputSchema: z.object({
        from: z.number().int().min(1).describe('First line, 1-based.'),
        to: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe(`Last line, inclusive. Defaults to ${DEFAULT_READ_LINES} lines.`),
      }),
      execute: async ({ from, to }) => {
        const lines = runtime.getScript().split(/\r?\n/);
        const start = Math.min(Math.max(1, from), Math.max(1, lines.length));
        const end = Math.min(
          Math.max(start, to ?? start + DEFAULT_READ_LINES - 1),
          Math.min(lines.length, start + READ_LINES_LIMIT - 1),
        );
        return {
          from: start,
          to: end,
          total: lines.length,
          text: lines.slice(start - 1, end).join('\n'),
        };
      },
    }),

    edit_code: tool({
      description:
        'Patch the editor with exact replacements instead of re-sending the whole script. Each oldStr must occur exactly once. Use this for any fix in a large script.',
      inputSchema: z.object({
        summary: z.string().describe('One line: what changes and why.'),
        edits: z
          .array(
            z.object({
              oldStr: z.string().min(1).describe('Exact current text, copied from read_lines.'),
              newStr: z.string().describe('Replacement text; empty deletes the block.'),
            }),
          )
          .min(1)
          .max(10),
      }),
      execute: async ({ summary, edits }) => {
        const before = runtime.getScript();
        const result = applyEdits(before, edits);
        if (!result.ok) return { applied: false, reason: result.error };
        runtime.applyScript(result.code);
        return {
          applied: true,
          summary,
          edits: edits.length,
          beforeChars: before.length,
          afterChars: result.code.length,
        };
      },
    }),

    new_script: tool({
      description:
        'Start a NEW Pine indicator or strategy in a fresh editor buffer. Use this instead of apply_script whenever the user asks for a new script. If the editor holds unsaved changes this returns needsDecision with draft {title, chars, saved} and options save/discard/cancel: ask the user which one they want, then call new_script again with the same source and conflict set to their choice. Save keeps the draft in the Library, discard drops it, cancel aborts. After created=true the new source is in the buffer; apply it with apply_live.',
      inputSchema: z.object({
        source: z.string().min(1).describe('Complete Pine v6 source for the new script.'),
        title: z
          .string()
          .optional()
          .describe('Short title if the user named the script; otherwise the declaration supplies it.'),
        conflict: z
          .enum(['save', 'discard', 'cancel'])
          .optional()
          .describe(
            'How to handle the unsaved draft. Omit on the first call; pass the user choice on the next one.',
          ),
      }),
      execute: async ({ source, title, conflict }) =>
        runtime.newScript({ source, title, conflict }),
    }),

    apply_script: tool({
      description:
        'Replace the whole editor buffer with new Pine source. Use only when the user asked to rewrite the current script; to start a new indicator or strategy call new_script so an unsaved draft is never overwritten. Large scripts must be patched with edit_code.',
      inputSchema: z.object({
        source: z.string().min(1).describe('Complete Pine v6 script source.'),
      }),
      execute: async ({ source }) => {
        if (source.length > INLINE_LIMIT) {
          return {
            applied: false,
            reason: `Source is ${source.length} chars. Patches via edit_code avoid the output limit.`,
          };
        }
        runtime.applyScript(source);
        return { applied: true, chars: source.length };
      },
    }),

    run_script: tool({
      description:
        'Run Pine twice and return both full results: on the active chart (the source of truth) and in a disposable worker over the same sidecar bars. The worker uses the same engine, runs in isolation, captures log.info/warning/error lines, and is terminated on timeout, so it never blocks the UI. The worker also returns the top-level variables at the requested zero-based bar (or the last bar). Compare the two when they disagree. The probe removes itself; it does not update the on-chart indicator.',
      inputSchema: z.object({
        source: z
          .string()
          .optional()
          .describe('Pine source to test. Omit to run the script currently in the editor.'),
        bar: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe('Zero-based bar for the worker variable snapshot. Omit for the last bar.'),
      }),
      execute: async ({ source, bar }) =>
        runtime.runScript(source ?? runtime.getScript(), { bar }),
    }),

    apply_live: tool({
      description:
        'Apply the editor buffer to the active chart in place: same indicator, same legend row, same input and prop values, new code. Call this after edit_code to verify the fix on the real chart; on failure the previous code keeps running and the error is returned.',
      inputSchema: z.object({}),
      execute: async () => runtime.applyLive(),
    }),
  };
}

export type AppTools = ReturnType<typeof createAppTools>;
